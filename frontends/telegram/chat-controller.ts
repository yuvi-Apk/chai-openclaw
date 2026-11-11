/**
 * One Telegram chat: which mode is open, the session with it, and the turn
 * that is running. It knows the Mode contract and nothing about any
 * particular mode.
 */
import type { Core } from "../../core/compose";
import { errorText } from "../../core/errors";
import {
    grantTools,
    lineText,
    type ImageInput,
    type Mode,
    type ModeCommand,
    type ModeRegistry,
    type ModeSession,
} from "../../core/mode";
import { limitInput } from "../../core/security/limits";
import type { InlineKeyboard, TelegramApi } from "./api/types";
import type { Clock } from "./clock";
import { FRONT_COMMANDS, LOCK_COMMANDS, parseCommand } from "./commands";
import type { TelegramConfig } from "./config";
import { receiveDocument, sendFile, type FileContext, type IncomingDocument } from "./files";
import { TelegramHost } from "./host";
import type { ModelMenuContext } from "./model-settings";
import type { Questions } from "./questions";
import { escapeHtml, linesHtml } from "./view/html";
import { ChatMessenger } from "./view/messenger";

const MAX_INPUT_CHARS = 8000;
/** Mode commands offered as buttons under an answer, when the mode has them. */
const QUICK_COMMANDS = ["/undo", "/new", "/mode"];
/** Marks a button that runs a command, as if the user had typed it. */
export const COMMAND_BUTTON_PREFIX = "c:";

export interface ChatDeps {
    chatId: number;
    core: Core;
    registry: ModeRegistry;
    api: TelegramApi;
    questions: Questions;
    clock: Clock;
    config: TelegramConfig;
}

interface Active {
    mode: Mode;
    session: ModeSession;
    host: TelegramHost;
}

const commandButton = (label: string, command: string) => ({ text: label, callback_data: `${COMMAND_BUTTON_PREFIX}${command}` });

export class ChatController {
    readonly messenger: ChatMessenger;
    private workspace: string;
    private active: Active | undefined;
    private running: AbortController | undefined;
    private showThinking = true;

    constructor(private readonly deps: ChatDeps) {
        this.messenger = new ChatMessenger(deps.api, deps.chatId, () => deps.core.settings.secrets(), deps.core.log, deps.clock);
        this.workspace = deps.config.workspace;
    }

    private get fileContext(): FileContext {
        return { api: this.deps.api, messenger: this.messenger, questions: this.deps.questions, log: this.deps.core.log };
    }

    private modes(): Mode[] {
        return this.deps.registry.list({ includeHidden: this.deps.core.settings.devMode });
    }

    // ---------- incoming ----------

    /** A text message or a command from the user. */
    async onText(raw: string): Promise<void> {
        const { text, truncated } = limitInput(raw, MAX_INPUT_CHARS);
        if (!text) return;
        if (text.startsWith("/")) return this.runCommand(text);
        if (truncated) await this.messenger.send(`◆ Your message was cut to ${MAX_INPUT_CHARS} characters.`);
        if (this.running) return this.steer(text);
        if (!this.active) return this.showMenu("Pick a mode first, then send your message again.");
        await this.runTurn(text);
    }

    /** A photo, with its caption as the message. */
    async onPhoto(caption: string, image: ImageInput): Promise<void> {
        if (this.running) return void (await this.messenger.send("◆ yuvi is busy. Send the photo again when it is done, or /stop."));
        if (!this.active) return this.showMenu("Pick a mode first, then send the photo again.");
        if (!this.active.mode.acceptsImages) {
            return void (await this.messenger.send(`◆ ${escapeHtml(this.active.mode.label)} cannot look at photos yet. Agent and Plan can.`));
        }
        const { text } = limitInput(caption || "Look at this image and tell me what you see.", MAX_INPUT_CHARS);
        await this.runTurn(text, [image]);
    }

    async onDocument(document: IncomingDocument, caption: string): Promise<void> {
        await receiveDocument(this.fileContext, this.workspace, document, caption);
    }

    private async steer(text: string): Promise<void> {
        const session = this.active?.session;
        if (!session?.steer) {
            return void (await this.messenger.send("◆ yuvi is still answering. Wait for it, or send /stop.", { silent: true }));
        }
        session.steer(text);
        await this.messenger.send("› Passed to yuvi; it is used at the next step.", { silent: true });
    }

    // ---------- commands ----------

    private async runCommand(text: string): Promise<void> {
        const { name, arg } = parseCommand(text);
        const front = FRONT_COMMANDS.find((command) => command.name === name);
        if (this.running && !front?.whileRunning) {
            return void (await this.messenger.send("◆ yuvi is busy. Send /stop first, or wait until it is done."));
        }
        if (front) return void (await front.run(this, arg));

        const command = this.active?.session.commands().find((c) => c.name === name);
        if (!command) return void (await this.messenger.send(`Unknown command ${escapeHtml(name)}. Send /help to see the commands.`));
        const outcome = await command.run(arg);
        await this.active?.host.settled();
        if (outcome === "exit") return this.showMenu();
        if (outcome && typeof outcome === "object") await this.runTurn(outcome.submit);
    }

    /** Close the open mode and offer the list of modes. */
    async showMenu(note?: string): Promise<void> {
        await this.closeSession();
        const rows = this.modes().map((mode) => [commandButton(mode.label, `/open ${mode.name}`)]);
        const lines = this.modes().map((mode) => `• <b>${escapeHtml(mode.label)}</b>: ${escapeHtml(mode.description)}`);
        const head = note ? escapeHtml(note) : "<b>yuvi</b> is awake. What do you want to do?";
        await this.messenger.send([head, "", ...lines, "", `<i>Project: ${escapeHtml(this.workspace)}</i>`].join("\n"), { keyboard: rows });
    }

    async openMode(name: string): Promise<void> {
        const mode = this.modes().find((m) => m.name === name.trim());
        if (!mode) return this.showMenu("There is no such mode. Pick one:");
        await this.closeSession();
        const { core, questions, clock } = this.deps;
        const host = new TelegramHost({
            core: grantTools(core, mode.name, mode.tools),
            grants: mode.tools,
            workspace: this.workspace,
            messenger: this.messenger,
            questions,
            clock,
        });
        host.showThinking = this.showThinking;
        let session: ModeSession;
        try {
            session = mode.createSession(host);
        } catch (error) {
            return void (await this.messenger.send(`✗ ${escapeHtml(errorText(error))}`));
        }
        this.active = { mode, session, host };
        core.log.event("mode.start", { mode: mode.name, frontend: "telegram" });
        await this.registerCommands(session);
        const status = session.status();
        const state = `● <b>${escapeHtml(status.label)}</b>${status.detail ? ` — ${escapeHtml(status.detail)}` : ""}`;
        await this.messenger.send(`${linesHtml(session.welcome())}\n\n${state}\n<i>/help shows the commands · /menu changes mode</i>`);
    }

    /** Tell Telegram which commands to offer in this chat's "/" list. */
    private async registerCommands(session: ModeSession): Promise<void> {
        const listed = [
            ...session.commands().map((c) => ({ name: c.name, description: c.hint || c.label })),
            ...FRONT_COMMANDS.filter((c) => !c.hidden),
            ...LOCK_COMMANDS,
        ];
        const commands = listed
            .filter((c) => /^\/[a-z0-9_]{1,32}$/.test(c.name))
            .map((c) => ({ command: c.name.slice(1), description: c.description.slice(0, 100) || c.name }));
        await this.deps.api.setCommands(commands, this.deps.chatId).catch(() => undefined);
    }

    private async closeSession(): Promise<void> {
        const active = this.active;
        if (!active) return;
        this.stop();
        this.active = undefined;
        try {
            await active.session.close();
            await active.host.settled();
        } catch (error) {
            this.deps.core.log.event("telegram.close_failed", { mode: active.mode.name });
            await this.messenger.send(`✗ ${escapeHtml(errorText(error))}`);
        }
    }

    /** Stop the running turn. Open questions are answered with "no". */
    stop(): void {
        this.deps.questions.cancelAll(this.deps.chatId);
        this.running?.abort();
    }

    async cancelQuestions(): Promise<void> {
        this.deps.questions.cancelAll(this.deps.chatId);
        await this.messenger.send("Cancelled.", { silent: true });
    }

    async cycle(): Promise<void> {
        const session = this.active?.session;
        if (!session?.cycle) return void (await this.messenger.send("◆ This mode has no sub-modes."));
        session.cycle();
        const status = session.status();
        await this.messenger.send(`● <b>${escapeHtml(status.label)}</b> — ${escapeHtml(status.detail)}`);
    }

    async setThinking(arg: string): Promise<void> {
        const wanted = arg.trim().toLowerCase();
        this.showThinking = wanted === "on" ? true : wanted === "off" ? false : !this.showThinking;
        if (this.active) this.active.host.showThinking = this.showThinking;
        await this.messenger.send(
            this.showThinking
                ? "✻ Thinking is shown, folded, in the activity message. Tap it to read."
                : "✻ Thinking is hidden. You still see each step.",
        );
    }

    /** What /provider, /model and /effort need (model-settings.ts). */
    get modelMenu(): ModelMenuContext {
        const { chatId, core, questions } = this.deps;
        return { chatId, settings: core.settings, messenger: this.messenger, questions, log: core.log };
    }

    async chooseProject(): Promise<void> {
        const { projects } = this.deps.config;
        if (!projects.length) {
            return void (await this.messenger.send(
                "◆ No projects are set up. Add <code>YUVI_TELEGRAM_PROJECTS=name=path;name=path</code> to .env on your PC and restart the bot.",
            ));
        }
        const rows = projects.map((project, index) => [{ label: project.name, value: index }]);
        const { keyboard, answer } = this.deps.questions.ask(this.deps.chatId, rows);
        await this.messenger.send(`<b>Which project?</b>\n<i>Now: ${escapeHtml(this.workspace)}</i>`, { keyboard });
        const picked = await answer;
        const project = picked === null ? undefined : projects[picked];
        if (!project) return;
        const modeName = this.active?.mode.name;
        await this.closeSession();
        this.workspace = project.path;
        this.deps.core.log.event("telegram.project", { index: picked });
        await this.messenger.send(`✓ Project: <b>${escapeHtml(project.name)}</b>`);
        if (modeName) await this.openMode(modeName);
        else await this.showMenu();
    }

    async sendFile(arg: string): Promise<void> {
        await sendFile(this.fileContext, this.workspace, arg);
    }

    async refuseKey(): Promise<void> {
        await this.messenger.send(
            "🔑 Keys are never set from Telegram: a key typed here would stay in the chat history. Set it on your PC (run yuvi in the terminal and choose “Set API key”).",
        );
    }

    async showHelp(): Promise<void> {
        const row = (c: { name: string; description: string }) => `${c.name} — ${escapeHtml(c.description)}`;
        const session = this.active?.session;
        const modeCommands = (session?.commands() ?? []).map((c: ModeCommand) => row({ name: c.name, description: c.hint || c.label }));
        const blocks = [
            "<b>How to use yuvi here</b>\nSend a message in plain words. While yuvi works, a new message is passed on as a correction. Send a photo to ask about it, or a file to save it into the project.",
            ...(session ? [escapeHtml(session.help().map(lineText).join("\n"))] : []),
            ...(modeCommands.length ? [`<b>In this mode</b>\n${modeCommands.join("\n")}`] : []),
            `<b>Always</b>\n${[...FRONT_COMMANDS.filter((c) => !c.hidden), ...LOCK_COMMANDS].map(row).join("\n")}`,
        ];
        await this.messenger.sendBlocks(blocks);
    }

    // ---------- a turn ----------

    private quickButtons(session: ModeSession): InlineKeyboard {
        const commands = session.commands().filter((c) => QUICK_COMMANDS.includes(c.name));
        return [commands.map((c) => commandButton(c.label, c.name)), [commandButton("☰ Modes", "/menu")]].filter((row) => row.length);
    }

    /** Hand one message to the mode and show what it does with it. */
    private async runTurn(text: string, images?: ImageInput[]): Promise<void> {
        const active = this.active;
        if (!active) return;
        const { host, session, mode } = active;
        const controller = new AbortController();
        this.running = controller;
        // "Reject + tell yuvi what to do": the instruction becomes the next message,
        // because a mode may end its turn as soon as its changes are refused.
        let followUp: string | undefined;
        host.instruct = (instruction) => {
            followUp = instruction;
        };
        host.beginTurn();
        const startedAt = this.deps.clock.now();
        try {
            await session.handle(text, { signal: controller.signal, ...(images ? { images } : {}) });
        } catch (error) {
            host.emit({ type: "error", message: errorText(error) });
        } finally {
            this.running = undefined;
            await host.endTurn(controller.signal.aborted, this.quickButtons(session));
            this.deps.core.log.event("turn.end", {
                mode: mode.name,
                frontend: "telegram",
                ms: this.deps.clock.now() - startedAt,
                aborted: controller.signal.aborted,
            });
        }
        if (followUp && !controller.signal.aborted && this.active === active) await this.runTurn(followUp);
    }

    /** The bot is shutting down: stop work and let the mode finish up. */
    async shutdown(): Promise<void> {
        await this.closeSession();
    }
}
