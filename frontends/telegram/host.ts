/**
 * What a mode sees of Telegram: the ModeHost of one chat. Events become an
 * activity message that is redrawn while a turn runs, plus a final answer;
 * questions become buttons or a request for a reply.
 */
import type { Core } from "../../core/compose";
import type { Choice, ConfirmReply, ConfirmRequest, ModeEvent, ModeHost, ToolPermission } from "../../core/mode";
import type { InlineKeyboard } from "./api/types";
import type { Clock } from "./clock";
import { confirmChanges, confirmCommand } from "./confirm-view";
import type { Questions } from "./questions";
import { escapeHtml, lineHtml, markdownToHtml } from "./view/html";
import { LiveMessage } from "./view/live-message";
import type { ChatMessenger } from "./view/messenger";
import { errorHtml, TurnView } from "./view/turn-view";

const CHOICE_LABEL_MAX_CHARS = 48;

export interface TelegramHostOptions {
    core: Core;
    grants: readonly ToolPermission[];
    workspace: string;
    messenger: ChatMessenger;
    questions: Questions;
    clock: Clock;
}

interface Turn {
    view: TurnView;
    live: LiveMessage | undefined;
    startedAt: number;
}

export class TelegramHost implements ModeHost {
    readonly core: Core;
    readonly grants: readonly ToolPermission[];
    readonly workspace: string;
    readonly interactive = true;
    /** Show the model's thinking, collapsed, in the activity message. */
    showThinking = true;
    /** Receives what the user wants done instead of changes they refused. */
    instruct: ((text: string) => void) | undefined;

    private readonly messenger: ChatMessenger;
    private readonly questions: Questions;
    private readonly clock: Clock;
    private turn: Turn | undefined;
    /** Keeps messages in the order they were asked for. */
    private outbox: Promise<unknown> = Promise.resolve();
    private idleText = "";

    constructor(options: TelegramHostOptions) {
        this.core = options.core;
        this.grants = options.grants;
        this.workspace = options.workspace;
        this.messenger = options.messenger;
        this.questions = options.questions;
        this.clock = options.clock;
    }

    private enqueue(task: () => Promise<unknown>): Promise<unknown> {
        this.outbox = this.outbox.then(task, task);
        return this.outbox;
    }

    // ---------- events ----------

    emit(event: ModeEvent): void {
        const turn = this.turn;
        if (!turn) return this.emitIdle(event);
        if (event.type === "tool" && event.phase === "call") {
            const said = turn.view.takeLongSaid();
            if (said) {
                this.breakSegment(turn);
                void this.enqueue(() => this.messenger.sendBlocks(markdownToHtml(said), { silent: true }));
            }
        }
        turn.view.apply(event);
        // Answer text is collected for the final message; it does not change the activity.
        if (event.type === "token") return;
        turn.live ??= new LiveMessage(this.messenger, this.clock, this.outbox);
        turn.live.set(this.activityHtml(turn));
    }

    private activityHtml(turn: Turn, done?: "finished" | "stopped" | "continued"): string {
        return turn.view.activityHtml({
            showThinking: this.showThinking,
            elapsedMs: this.clock.now() - turn.startedAt,
            ...(done ? { done } : {}),
        });
    }

    /** Close the current activity message; the next activity appears in a new one below. */
    private breakSegment(turn: Turn, done: "finished" | "stopped" | "continued" = "continued"): Promise<unknown> {
        const live = turn.live;
        turn.live = undefined;
        if (!live) return this.outbox;
        if (!turn.view.hasActivity() && done === "continued") {
            live.discard();
            return this.outbox;
        }
        const html = this.activityHtml(turn, done);
        turn.view.startSegment();
        return this.enqueue(() => live.close(html));
    }

    /** Something a command printed while no turn was running: send it as it comes. */
    private emitIdle(event: ModeEvent): void {
        const html = this.idleHtml(event);
        if (html.length) void this.enqueue(() => this.messenger.sendBlocks(html));
    }

    private idleHtml(event: ModeEvent): string[] {
        switch (event.type) {
            case "notice":
                return [`${event.level === "success" ? "✓" : event.level === "failure" ? "✗" : "◆"} ${escapeHtml(event.text)}`];
            case "line":
                return [lineHtml(event.line)];
            case "error":
                return [errorHtml(event.message, event.hint)];
            case "progress":
                return [`<b>${escapeHtml(event.tag)}</b> ${escapeHtml(event.text)}`];
            case "token": {
                this.idleText += event.text;
                if (!event.end) return [];
                const text = this.idleText;
                this.idleText = "";
                return markdownToHtml(text);
            }
            case "answer":
                return event.kind === "clarify" ? markdownToHtml(event.text) : [];
            default:
                return [];
        }
    }

    // ---------- turn lifecycle ----------

    beginTurn(): void {
        this.turn = { view: new TurnView(), live: undefined, startedAt: this.clock.now() };
        void this.messenger.typing();
    }

    /** Close the activity message and send the answer, with shortcut buttons under it. */
    async endTurn(stopped: boolean, keyboard?: InlineKeyboard): Promise<void> {
        const turn = this.turn;
        if (!turn) return;
        this.turn = undefined;
        const hadActivity = turn.view.hasActivity();
        const blocks = turn.view.finalBlocks();
        if (hadActivity) await this.breakSegment(turn, stopped ? "stopped" : "finished");
        else turn.live?.discard();
        if (!blocks.length) blocks.push(stopped ? "■ Stopped." : "✓ Done.");
        await this.enqueue(() => this.messenger.sendBlocks(blocks, keyboard ? { keyboard } : {}));
    }

    /** Wait until everything asked for so far has been sent. */
    async settled(): Promise<void> {
        await this.outbox;
    }

    // ---------- questions ----------

    /** Before asking something: bring the chat up to date so the question comes last. */
    private async pause(): Promise<void> {
        if (this.turn) await this.breakSegment(this.turn);
        else await this.outbox;
    }

    async confirm(request: ConfirmRequest): Promise<ConfirmReply> {
        await this.pause();
        const context = {
            messenger: this.messenger,
            questions: this.questions,
            ...(this.instruct ? { instruct: this.instruct } : {}),
        };
        const reply = await (request.kind === "changes" ? confirmChanges(context, request) : confirmCommand(context, request));
        this.core.log.event("telegram.confirm", { kind: request.kind, approved: reply.approved.length });
        return reply;
    }

    async choose<T extends string>(question: string, choices: Choice<T>[], initial?: T): Promise<T | null> {
        await this.pause();
        const hints = choices.filter((c) => c.hint).map((c) => `• <b>${escapeHtml(c.label)}</b>: ${escapeHtml(c.hint ?? "")}`);
        const text = [`<b>${escapeHtml(question)}</b>`, ...hints].join("\n");
        const rows = choices.map((choice) => [
            { label: `${choice.value === initial ? "● " : ""}${choice.label}`.slice(0, CHOICE_LABEL_MAX_CHARS), value: choice.value },
        ]);
        const { keyboard, answer } = this.questions.ask(this.messenger.chatId, rows);
        const messageId = await this.messenger.send(text, { keyboard });
        if (!messageId) return null;
        const picked = await answer;
        const label = choices.find((choice) => choice.value === picked)?.label;
        await this.messenger.edit(messageId, `<b>${escapeHtml(question)}</b>\n${label ? `→ ${escapeHtml(label)}` : "⌛ No answer."}`);
        return picked;
    }

    async ask(question: string): Promise<string | null> {
        await this.pause();
        const messageId = await this.messenger.send(`<b>${escapeHtml(question)}</b>\n<i>Send your answer as a message, or /cancel.</i>`);
        if (!messageId) return null;
        const reply = await this.questions.text(this.messenger.chatId);
        return reply?.trim() || null;
    }
}
