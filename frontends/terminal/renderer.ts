/**
 * Shows mode events on the terminal. Output is always written as whole
 * lines, and a one-line spinner sits below it, so the screen never looks
 * frozen and lines never tear. It knows nothing about any particular mode.
 */
import chalk from "chalk";
import { formatDuration, formatTokens, shorten } from "../../core/format";
import type { LLMProviderProfile } from "../../core/llm/profiles";
import type { ModeEvent, SourceItem, TodoItem } from "../../core/mode";
import { explainError } from "./errors";
import { StreamPrinter } from "./stream-printer";
import { styled } from "./style";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;
const ERROR_DETAIL_MAX_CHARS = 220;

export class TerminalRenderer {
    private readonly tty = Boolean(process.stdout.isTTY);
    private timer: ReturnType<typeof setInterval> | undefined;
    private frame = 0;
    private running = false;
    private spinnerDrawn = false;
    private suspended = 0;
    private status = "Thinking";
    private runStarted = 0;
    private step = 0;
    private tokens: number | undefined;
    private contextPercent: number | undefined;

    private reasoningBuf = "";
    private reasoningOpen = false;
    private readonly answer = new StreamPrinter((rendered) => this.print("\n" + rendered));

    /** Label of each running tool call, to name results that arrive out of order. */
    private callLabels = new Map<string, string>();
    private lastCallId = "";

    private inputBuf = "";
    private inputAttached = false;
    private promptChain: Promise<unknown> = Promise.resolve();

    /** Called with a message the user typed while a turn was running. */
    onSteer: ((text: string) => void) | undefined;
    /** Called when the user presses Esc or Ctrl+C during a turn. */
    onAbort: (() => void) | undefined;

    /** @param provider names the model provider in error advice */
    constructor(private readonly provider?: LLMProviderProfile) {}

    // ---------- low-level drawing ----------

    private columns(): number {
        return process.stdout.columns ?? 80;
    }

    private clearSpinner(): void {
        if (this.spinnerDrawn) {
            process.stdout.write("\r\x1b[2K");
            this.spinnerDrawn = false;
        }
    }

    private drawSpinner(): void {
        if (!this.tty || !this.running || this.suspended > 0) return;
        const parts = [`${this.status}…`, formatDuration(Date.now() - this.runStarted)];
        if (this.step > 0) parts.push(`step ${this.step}`);
        if (this.tokens !== undefined) parts.push(`${formatTokens(this.tokens)} tok`);
        if (this.contextPercent !== undefined) parts.push(`ctx ${this.contextPercent}%`);
        parts.push("esc to stop");
        let line = `${FRAMES[this.frame % FRAMES.length]} ${parts.join(" · ")}`;
        if (this.inputBuf) line += `  › ${this.inputBuf}`;
        const max = this.columns() - 1;
        if (line.length > max) line = line.slice(0, max - 1) + "…";
        const [glyph, ...rest] = line.split(" ");
        process.stdout.write(`\r\x1b[2K${chalk.cyan(glyph)} ${chalk.dim(rest.join(" "))}`);
        this.spinnerDrawn = true;
    }

    /** Print whole lines above the spinner. */
    print(text = ""): void {
        this.clearSpinner();
        process.stdout.write(text + "\n");
        this.drawSpinner();
    }

    // ---------- turn lifecycle ----------

    startRun(): void {
        this.running = true;
        this.runStarted = Date.now();
        this.step = 0;
        this.tokens = undefined;
        this.contextPercent = undefined;
        this.status = "Thinking";
        if (this.tty) {
            this.timer = setInterval(() => {
                this.frame++;
                this.drawSpinner();
            }, SPINNER_INTERVAL_MS);
        }
        this.attachInput();
        this.drawSpinner();
    }

    endRun(): void {
        this.flushStreams();
        this.running = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.clearSpinner();
        this.detachInput();
        this.inputBuf = "";
    }

    // ---------- keys while a turn runs ----------

    private readonly onKey = (chunk: Buffer) => {
        const key = chunk.toString("utf8");
        if (key === "\u001b" || key === "\u0003") {
            this.onAbort?.();
            return;
        }
        if (key.startsWith("\u001b")) return; // arrows and other escape sequences
        if (!this.onSteer) return; // this mode takes no messages mid-turn
        if (key === "\r" || key === "\n") {
            const text = this.inputBuf.trim();
            this.inputBuf = "";
            if (text) {
                this.print(chalk.magenta(`  › you (mid-run): ${text}`));
                this.onSteer(text);
            }
            this.drawSpinner();
            return;
        }
        if (key === "\u007f" || key === "\b") {
            this.inputBuf = this.inputBuf.slice(0, -1);
        } else {
            this.inputBuf += key.replace(/[\u0000-\u001f]/g, "");
        }
        this.drawSpinner();
    };

    private attachInput(): void {
        if (this.inputAttached || !process.stdin.isTTY) return;
        try {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on("data", this.onKey);
            this.inputAttached = true;
        } catch {
            // no raw mode available: run without keys during a turn
        }
    }

    private detachInput(): void {
        if (!this.inputAttached) return;
        process.stdin.off("data", this.onKey);
        try {
            process.stdin.setRawMode(false);
        } catch {
            // the terminal is already back to normal
        }
        process.stdin.pause();
        this.inputAttached = false;
    }

    /**
     * Run an interactive prompt (approval, question). Prompts run one at a
     * time, with the spinner and the key listener paused.
     */
    withPrompt<T>(fn: () => Promise<T>): Promise<T> {
        const run = async () => {
            this.flushStreams();
            this.suspended++;
            this.clearSpinner();
            const hadInput = this.inputAttached;
            this.detachInput();
            try {
                return await fn();
            } finally {
                this.suspended--;
                if (hadInput && this.running) this.attachInput();
                this.drawSpinner();
            }
        };
        const next = this.promptChain.then(run, run);
        this.promptChain = next.catch(() => undefined);
        return next;
    }

    // ---------- streamed model output ----------

    private flushReasoning(final: boolean): void {
        const width = Math.max(30, Math.min(this.columns(), 110) - 6);
        while (true) {
            const newline = this.reasoningBuf.indexOf("\n");
            let line: string | undefined;
            if (newline !== -1 && newline <= width) {
                line = this.reasoningBuf.slice(0, newline);
                this.reasoningBuf = this.reasoningBuf.slice(newline + 1);
            } else if (this.reasoningBuf.length > width) {
                let cut = this.reasoningBuf.lastIndexOf(" ", width);
                if (cut < width / 2) cut = width;
                line = this.reasoningBuf.slice(0, cut);
                this.reasoningBuf = this.reasoningBuf.slice(cut).trimStart();
            } else if (final && this.reasoningBuf.trim()) {
                line = this.reasoningBuf;
                this.reasoningBuf = "";
            } else {
                break;
            }
            if (!this.reasoningOpen) {
                if (!line.trim()) continue;
                this.reasoningOpen = true;
                this.print(chalk.dim.italic("  ✻ thinking"));
            }
            if (line.trim()) this.print(chalk.dim(`  │ ${line.trimEnd()}`));
        }
        if (final) {
            this.reasoningBuf = "";
            this.reasoningOpen = false;
        }
    }

    private flushStreams(): void {
        this.flushReasoning(true);
        this.answer.end();
    }

    // ---------- events ----------

    /** Show one event from a mode. */
    render(event: ModeEvent): void {
        switch (event.type) {
            case "status":
                this.status = event.text;
                this.drawSpinner();
                break;
            case "step":
                if (event.phase === "start") this.step++;
                else this.flushStreams();
                break;
            case "reasoning":
                this.reasoningBuf += event.text;
                this.flushReasoning(Boolean(event.end));
                break;
            case "token":
                this.flushReasoning(true);
                this.answer.push(event.text);
                if (event.end) this.answer.end();
                break;
            case "tool":
                this.renderTool(event);
                break;
            case "progress":
                this.print(chalk.dim(`  ⎿ ${chalk.cyan(event.tag)} ${event.text}`));
                break;
            case "notice":
                if (event.level === "success") this.print(chalk.green(`✓ ${event.text}`));
                else if (event.level === "failure") this.print(chalk.red(`✗ ${event.text}`));
                else this.print(chalk.yellow(`◆ ${event.text}`));
                break;
            case "line":
                this.print(styled(event.line));
                break;
            case "todos":
                this.showTodos(event.items);
                break;
            case "sources":
                this.showSources(event.items);
                break;
            case "answer":
                // The answer text was streamed already; a question back was not.
                if (event.kind === "clarify") this.print(`${chalk.yellow("?")} ${event.text}`);
                break;
            case "usage":
                this.tokens = event.tokens;
                this.contextPercent = event.contextPercent;
                break;
            case "summary":
                this.print(chalk.dim(`\n  ${event.parts.join(" · ")}`));
                break;
            case "error":
                this.flushStreams();
                this.errorBox(event.message, event.hint);
                break;
        }
    }

    private renderTool(event: Extract<ModeEvent, { type: "tool" }>): void {
        if (event.phase === "call") {
            this.flushStreams();
            if (event.silent) return;
            this.print(`${chalk.cyan("●")} ${chalk.bold(event.title)} ${event.detail}`.trimEnd());
            this.callLabels.set(event.id, `${event.title} ${event.detail}`.trim());
            this.lastCallId = event.id;
            return;
        }
        if (event.phase === "result") {
            if (event.summary) this.print(chalk.dim(`  ⎿ ${this.resultPrefix(event.id)}${event.summary}`));
            return;
        }
        this.print(chalk.red(`  ⎿ ${this.resultPrefix(event.id)}${event.summary}`));
    }

    /**
     * When calls run in parallel, a result is not printed right under its
     * call. In that case name the call it belongs to.
     */
    private resultPrefix(id: string): string {
        const label = this.callLabels.get(id);
        this.callLabels.delete(id);
        const adjacent = id === this.lastCallId;
        this.lastCallId = "";
        return adjacent || !label ? "" : `${label}: `;
    }

    /** Show an error in plain words, with what the user can do about it. */
    private errorBox(raw: string, hint?: string): void {
        const { problem, fix } = explainError(raw, this.provider);
        const lines = ["", chalk.red.bold(`✗ ${problem}`), `  ${chalk.bold("What to do:")} ${fix}`];
        const detail = raw.replace(/\s+/g, " ").trim();
        if (detail && detail !== problem) {
            lines.push(chalk.dim(`  Technical detail: ${shorten(detail, ERROR_DETAIL_MAX_CHARS)}`));
        }
        if (hint) lines.push(chalk.dim(`  ${hint}`));
        this.print(lines.join("\n"));
    }

    private showTodos(todos: TodoItem[]): void {
        const done = todos.filter((t) => t.status === "completed").length;
        const lines = [chalk.bold(`  Plan (${done}/${todos.length})`)];
        for (const t of todos) {
            if (t.status === "completed") {
                lines.push(chalk.green(`  ☑ ${chalk.strikethrough(t.content)}`));
            } else if (t.status === "in_progress") {
                lines.push(chalk.cyan(`  ▶ ${t.content}`));
            } else {
                lines.push(chalk.dim(`  ☐ ${t.content}`));
            }
        }
        this.print(lines.join("\n"));
    }

    private showSources(sources: SourceItem[]): void {
        if (!sources.length) return;
        const lines = sources.map((s) => {
            const date = s.date ? chalk.dim(` · ${s.date}`) : "";
            return `  ${chalk.cyan(`[${s.n}]`)} ${s.title}${date}\n      ${chalk.dim.underline(s.url)}`;
        });
        this.print(`\n${chalk.bold("Sources")}\n${lines.join("\n")}`);
    }
}
