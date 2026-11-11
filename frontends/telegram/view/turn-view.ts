/**
 * What one turn looks like in Telegram. Mode events are folded into two
 * things: an "activity" message that shows the work as it happens (status,
 * thinking, tool calls, plan) and the final answer. This class only builds
 * text; sending it is someone else's job.
 */
import { formatDuration, formatTokens, shorten } from "../../../core/format";
import type { ModeEvent, SourceItem, TodoItem } from "../../../core/mode";
import { explainError } from "../errors";
import { escapeHtml, lineHtml, markdownToHtml } from "./html";

const MAX_ENTRIES = 14;
const ENTRY_MAX_CHARS = 160;
const THINKING_MAX_CHARS = 1200;
const MAX_TODOS = 12;
const TODO_MAX_CHARS = 80;
/** Text the model writes between tool calls stays in the activity when it is this short. */
const INLINE_SAY_MAX_CHARS = 300;
const ERROR_DETAIL_MAX_CHARS = 220;

export interface ActivityOptions {
    showThinking: boolean;
    elapsedMs: number;
    /**
     * Show a closing header instead of the running one: the turn finished,
     * was stopped, or this message is complete and the work goes on below it.
     */
    done?: "finished" | "stopped" | "continued";
}

const short = (text: string, max = ENTRY_MAX_CHARS) => escapeHtml(shorten(text, max));

export class TurnView {
    private status = "Thinking";
    private steps = 0;
    private tokens: number | undefined;
    private contextPercent: number | undefined;
    private thinking = "";
    private entries: string[] = [];
    private hiddenEntries = 0;
    private todos: TodoItem[] = [];
    private text = "";
    private sources: SourceItem[] = [];
    private summary: string[] = [];
    private errors: string[] = [];
    private callLabels = new Map<string, string>();
    private lastCallId = "";

    /** Take in one event. */
    apply(event: ModeEvent): void {
        switch (event.type) {
            case "status":
                this.status = event.text;
                return;
            case "step":
                if (event.phase === "start") this.steps++;
                return;
            case "reasoning":
                this.thinking = (this.thinking + event.text + (event.end ? "\n" : "")).slice(-THINKING_MAX_CHARS * 2);
                return;
            case "token":
                this.text += event.text;
                return;
            case "tool":
                return this.applyTool(event);
            case "progress":
                this.add(`  ⎿ <b>${short(event.tag, 30)}</b> ${short(event.text)}`);
                return;
            case "notice":
                this.add(`${event.level === "success" ? "✓" : event.level === "failure" ? "✗" : "◆"} ${short(event.text, 300)}`);
                return;
            case "line":
                this.add(lineHtml(event.line));
                return;
            case "todos":
                this.todos = event.items;
                return;
            case "sources":
                this.sources = event.items;
                return;
            case "answer":
                // The answer was streamed as tokens already; a question back was not.
                if (event.kind === "clarify" || !this.text.trim()) this.text = event.text;
                return;
            case "usage":
                this.tokens = event.tokens;
                this.contextPercent = event.contextPercent;
                return;
            case "summary":
                this.summary = event.parts;
                return;
            case "error":
                this.errors.push(errorHtml(event.message, event.hint));
                return;
        }
    }

    private applyTool(event: Extract<ModeEvent, { type: "tool" }>): void {
        if (event.phase === "call") {
            // Text written before a tool call is commentary, not the answer.
            const said = this.takeLongSaid();
            if (said) this.add(`💬 <i>${short(said, INLINE_SAY_MAX_CHARS)}</i>`);
            if (!event.silent) {
                this.add(`● <b>${short(event.title, 40)}</b> ${short(event.detail)}`.trimEnd());
                this.callLabels.set(event.id, `${event.title} ${event.detail}`.trim());
                this.lastCallId = event.id;
            }
            return;
        }
        if (!event.summary) return;
        const label = this.callLabels.get(event.id);
        this.callLabels.delete(event.id);
        // With parallel calls a result is not right under its call: name it.
        const prefix = event.id === this.lastCallId || !label ? "" : `${short(label, 50)}: `;
        this.lastCallId = "";
        this.add(`  ⎿ ${event.phase === "error" ? "✗ " : ""}${prefix}${short(event.summary)}`);
    }

    /**
     * Take the text the model wrote before going on to more work. A short
     * remark is kept in the activity log and nothing is returned; a long one
     * is returned, for the caller to send as a message of its own before it
     * applies the tool call that follows.
     */
    takeLongSaid(): string | undefined {
        const said = this.text.trim();
        this.text = "";
        if (!said) return;
        if (said.length > INLINE_SAY_MAX_CHARS) return said;
        this.add(`💬 <i>${escapeHtml(said)}</i>`);
    }

    private add(entry: string): void {
        this.entries.push(entry);
        if (this.entries.length > MAX_ENTRIES) {
            this.entries.shift();
            this.hiddenEntries++;
        }
    }

    /** Begin a fresh activity message: the log so far stays in the old one. */
    startSegment(): void {
        this.entries = [];
        this.hiddenEntries = 0;
        this.thinking = "";
    }

    /** True when there is something worth showing besides the status line. */
    hasActivity(): boolean {
        return this.entries.length > 0 || this.thinking.trim().length > 0 || this.todos.length > 0;
    }

    /** The activity message. */
    activityHtml(options: ActivityOptions): string {
        const parts = [this.headerHtml(options)];
        const thinking = this.thinking.trim();
        if (options.showThinking && thinking) {
            const clipped = thinking.length > THINKING_MAX_CHARS ? "…" + thinking.slice(-THINKING_MAX_CHARS) : thinking;
            parts.push(`<blockquote expandable>✻ <b>Thinking</b>\n${escapeHtml(clipped)}</blockquote>`);
        }
        if (this.entries.length) {
            const earlier = this.hiddenEntries ? [`<i>… ${this.hiddenEntries} earlier steps</i>`] : [];
            parts.push([...earlier, ...this.entries].join("\n"));
        }
        if (this.todos.length) parts.push(this.todosHtml());
        return parts.join("\n\n");
    }

    private headerHtml(options: ActivityOptions): string {
        const facts = [formatDuration(options.elapsedMs)];
        if (this.steps > 0) facts.push(`${this.steps} step${this.steps === 1 ? "" : "s"}`);
        if (this.tokens !== undefined) facts.push(`${formatTokens(this.tokens)} tok`);
        if (this.contextPercent !== undefined) facts.push(`ctx ${this.contextPercent}%`);
        const head =
            options.done === "finished" ? "✓ <b>Done</b>" :
            options.done === "stopped" ? "■ <b>Stopped</b>" :
            options.done === "continued" ? "▸ <b>Steps so far</b>" :
            `⏳ <b>${short(this.status, 60)}…</b>`;
        return `${head} · ${facts.join(" · ")}`;
    }

    private todosHtml(): string {
        const done = this.todos.filter((t) => t.status === "completed").length;
        const lines = this.todos.slice(0, MAX_TODOS).map((todo) => {
            const text = short(todo.content, TODO_MAX_CHARS);
            if (todo.status === "completed") return `☑ <s>${text}</s>`;
            return todo.status === "in_progress" ? `▶ <b>${text}</b>` : `☐ ${text}`;
        });
        if (this.todos.length > MAX_TODOS) lines.push(`<i>… ${this.todos.length - MAX_TODOS} more</i>`);
        return [`📋 <b>Plan (${done}/${this.todos.length})</b>`, ...lines].join("\n");
    }

    /** The closing message of the turn as HTML blocks: answer, sources, errors, cost line. */
    finalBlocks(): string[] {
        const blocks = markdownToHtml(this.text.trim());
        if (this.sources.length) {
            const links = this.sources.map((s) => {
                const date = s.date ? ` · ${escapeHtml(s.date)}` : "";
                return `[${s.n}] <a href="${escapeHtml(s.url).replace(/"/g, "&quot;")}">${short(s.title, 90)}</a>${date}`;
            });
            blocks.push(`<b>Sources</b>\n${links.join("\n")}`);
        }
        blocks.push(...this.errors);
        if (this.summary.length) blocks.push(`<i>${escapeHtml(this.summary.join(" · "))}</i>`);
        return blocks;
    }
}

/** An error in plain words, with what the user can do about it. */
export function errorHtml(raw: string, hint?: string): string {
    const { problem, fix } = explainError(raw);
    const lines = [`✗ <b>${escapeHtml(problem)}</b>`, `<b>What to do:</b> ${escapeHtml(fix)}`];
    const detail = raw.replace(/\s+/g, " ").trim();
    if (detail && detail !== problem) lines.push(`<i>Technical detail: ${short(detail, ERROR_DETAIL_MAX_CHARS)}</i>`);
    if (hint) lines.push(`<i>${escapeHtml(hint)}</i>`);
    return lines.join("\n");
}
