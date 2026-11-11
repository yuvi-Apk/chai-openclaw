/**
 * Runs one session of any mode in the terminal: read a message, hand it to
 * the mode, show the events it emits, repeat. Nothing here depends on which
 * mode is running; it only uses the Mode contract.
 */
import { log, select, isCancel } from "@clack/prompts";
import chalk from "chalk";
import { createCore, type Core } from "../../core/compose";
import { Settings } from "../../core/config";
import { errorText } from "../../core/errors";
import { silenceSdkWarnings } from "../../core/llm/quiet-sdk";
import {
    grantTools,
    type CommandOutcome,
    type Mode,
    type ModeCommand,
    type ModeHost,
    type ModeSession,
} from "../../core/mode";
import { readInput } from "./input";
import { askText, chooseModel, chooseOne, confirmChanges, confirmCommand, setupApiKey } from "./prompts";
import { TerminalRenderer } from "./renderer";
import { paint, styled } from "./style";

const COMMAND_COLUMN = 10;
const KEY_COLUMN = 16;

/** The hint bar under the input box. Hints are dropped from the right when the terminal is narrow. */
function footer(session: ModeSession, typed: boolean, width: number): string {
    const status = session.status();
    const head = `  ● ${status.label}${status.detail ? `: ${status.detail}` : ""}`;
    const hints = typed
        ? ["/ commands", "↑ earlier messages", "ctrl+c leave"]
        : [
            ...(session.cycle ? ["shift+tab switch mode"] : []),
            "/ menu",
            "? help",
            ...(session.files ? ["@file attach"] : []),
            "ctrl+c exit",
        ];
    let plain = head;
    const used: string[] = [];
    for (const hint of hints) {
        if ((plain + " · " + hint).length > width) break;
        plain += " · " + hint;
        used.push(hint);
    }
    const shownHead = head.length > width ? head.slice(0, width - 1) + "…" : head;
    return paint(status.tone, shownHead) + chalk.dim(used.map((h) => ` · ${h}`).join(""));
}

/** Help: the keys this terminal understands, then what the mode says about itself. */
function showHelp(session: ModeSession, typed: boolean, commands: ModeCommand[]): void {
    const key = (name: string, meaning: string) => `${chalk.cyan(name.padEnd(KEY_COLUMN))} ${meaning}`;
    const lines = [
        chalk.bold("How to use yuvi"),
        "",
        key("Type a message", "say what you want in plain words, then press Enter"),
        key("/", typed ? "see and run the commands" : "open the menu (mode, model, undo, new chat, …)"),
        ...(session.cycle ? [key("Shift+Tab", "switch mode")] : []),
        ...(session.files ? [key("@file", "mention a file to attach it, e.g. @src/app.ts")] : []),
        key("Up / Down", "bring back an earlier message"),
        key("Esc", "while yuvi works: stop it. While typing: clear the line"),
        key("Ctrl+C", "while yuvi works: stop it. Otherwise: leave"),
        "",
        ...session.help().map(styled),
    ];
    if (typed) {
        lines.push("", ...commands.map((c) => `${chalk.cyan(c.name.padEnd(COMMAND_COLUMN))} ${c.hint}`));
    }
    log.info(lines.join("\n"));
}

/** Commands every mode gets from the terminal itself: model, key, help, exit. */
function appCommands(
    mode: Mode,
    core: Core,
    renderer: TerminalRenderer,
    help: () => void,
): ModeCommand[] {
    const typed = mode.commandStyle === "typed";
    return [
        {
            name: "/model",
            label: "Change AI model",
            hint: typed ? "change the AI model" : `now: ${core.settings.modelId("main")}`,
            run: async () => {
                const id = await chooseModel(core.settings);
                if (id) renderer.render({ type: "notice", level: "success", text: `Model changed to ${id} and saved for next time.` });
            },
        },
        {
            name: "/key",
            label: "Set API key",
            hint: typed ? `set your ${core.settings.llmProfile.label} key` : `${core.settings.llmProfile.label} key`,
            run: async () => void (await setupApiKey(core.settings)),
        },
        { name: "/help", label: "Help", hint: typed ? "what you can do here" : "keys and modes", run: help },
        { name: "/exit", label: `Exit ${mode.label.toLowerCase()}`, hint: "back to the main menu", run: () => "exit" },
    ];
}

/** The `/` menu: everything a user can do besides sending a message. */
async function openMenu(commands: ModeCommand[]): Promise<CommandOutcome> {
    const BACK = "__back__";
    const picked = await select({
        message: "Menu",
        options: [
            ...commands.map((c) => ({ value: c.name, label: c.label, hint: c.hint })),
            { value: BACK, label: "Back", hint: "close this menu" },
        ],
    });
    if (isCancel(picked) || picked === BACK) return;
    return commands.find((c) => c.name === picked)?.run("");
}

export async function runModeSession(mode: Mode): Promise<void> {
    // Provider warnings would break the live display; errors are still shown.
    silenceSdkWarnings();

    const typed = mode.commandStyle === "typed";
    const core = createCore(new Settings());
    if (!core.settings.apiKey && process.stdin.isTTY && !(await setupApiKey(core.settings))) {
        log.warn(
            typed
                ? "No key set. You can add it later with /key."
                : "No key set. You can add it later: type / and choose “Set API key”.",
        );
    }

    const renderer = new TerminalRenderer(core.settings.llmProfile);
    const host: ModeHost = {
        core: grantTools(core, mode.name, mode.tools),
        grants: mode.tools,
        workspace: process.cwd(),
        interactive: Boolean(process.stdin.isTTY),
        emit: (event) => renderer.render(event),
        confirm: (request) =>
            renderer.withPrompt(() =>
                request.kind === "changes" ? confirmChanges(request) : confirmCommand(request),
            ),
        choose: (question, choices, initial) => renderer.withPrompt(() => chooseOne(question, choices, initial)),
        ask: (question) => renderer.withPrompt(() => askText(question)),
    };

    core.log.event("mode.start", { mode: mode.name });
    let session: ModeSession;
    try {
        session = mode.createSession(host);
    } catch (error) {
        log.error(errorText(error));
        return;
    }

    const allCommands = () => [
        ...session.commands(),
        ...appCommands(mode, core, renderer, () => showHelp(session, typed, allCommands())),
    ];

    /** Hand one message to the mode and show what it does with it. */
    const runTurn = async (text: string) => {
        const controller = new AbortController();
        renderer.onAbort = () => controller.abort();
        renderer.onSteer = session.steer ? (steer) => session.steer!(steer) : undefined;
        renderer.startRun();
        const startedAt = Date.now();
        try {
            await session.handle(text, { signal: controller.signal });
        } catch (error) {
            renderer.render({ type: "error", message: errorText(error) });
        } finally {
            renderer.endRun();
            core.log.event("turn.end", { mode: mode.name, ms: Date.now() - startedAt, aborted: controller.signal.aborted });
            renderer.onAbort = undefined;
            renderer.onSteer = undefined;
        }
    };

    console.log(session.welcome().map(styled).join("\n"));
    const history: string[] = [];

    while (true) {
        const commands = allCommands();
        const input = await readInput({
            footer: (width) => footer(session, typed, width),
            onCycleMode: () => session.cycle?.(),
            history,
            ...(session.files ? { files: () => session.files!() } : {}),
            ...(typed ? { commands: commands.map(({ name, hint, takesArg }) => ({ name, hint, ...(takesArg ? { takesArg } : {}) })) } : {}),
            placeholder: mode.placeholder ?? "Type your message, then press Enter",
        });

        if (input.kind === "exit") break;
        let outcome: CommandOutcome;
        let line = input.kind === "message" ? input.text : "";

        if (input.kind === "menu") {
            outcome = await openMenu(commands);
        } else if (line === "exit" || line === "quit") {
            break;
        } else if (!typed && line === "help") {
            outcome = showHelp(session, typed, commands);
        } else if (line.startsWith("/")) {
            const [name = "", ...rest] = line.split(/\s+/);
            const command = commands.find((c) => c.name === name);
            if (command) outcome = await command.run(rest.join(" ").trim());
            else if (typed) {
                log.warn(`Unknown command ${name}. Type /help to see the commands.`);
                continue;
            } else outcome = await openMenu(commands);
        } else {
            outcome = { submit: line };
        }

        if (outcome === "exit") break;
        if (outcome && typeof outcome === "object") {
            history.push(line || outcome.submit);
            await runTurn(outcome.submit);
        }
    }

    await session.close();
}
