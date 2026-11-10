import chalk from "chalk";
import { renderTerminalMarkdown } from "../../terminal-ui/terminal-md";
import type { TodoItem, UsageTotals } from "./types";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export type Phase =
    | "Sizing up the task"
    | "Thinking"
    | "Exploring"
    | "Planning"
    | "Editing"
    | "Running"
    | "Verifying"
    | "Reviewing"
    | "Writing"
    | "Compacting";

/** One part of the model stream, reduced to the fields the UI needs. */
export interface StreamPartLike {
    type: string;
    text?: string;
    toolName?: string;
    toolCallId?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    preliminary?: boolean;
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function short(value: unknown, max = 70): string {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function field(input: unknown, name: string): unknown {
    return input && typeof input === "object"
        ? (input as Record<string, unknown>)[name]
        : undefined;
}

/** Turn a tool call into a short human sentence instead of raw JSON. */
export function describeToolCall(
    toolName: string,
    input: unknown,
): { verb: string; detail: string; phase: Phase } {
    const f = (name: string) => field(input, name);
    switch (toolName) {
        case "read_file":
            return { verb: "Read", detail: short(f("path")), phase: "Exploring" };
        case "list_files":
            return { verb: "List", detail: short(f("path") || "."), phase: "Exploring" };
        case "search_files":
            return { verb: "Find files", detail: short(f("pattern")), phase: "Exploring" };
        case "grep":
            return {
                verb: "Search",
                detail: `"${short(f("pattern"), 50)}"${f("path") ? ` in ${short(f("path"), 30)}` : ""}`,
                phase: "Exploring",
            };
        case "find_symbol":
            return { verb: "Find symbol", detail: short(f("name")), phase: "Exploring" };
        case "edit_file":
            return { verb: "Edit", detail: short(f("path")), phase: "Editing" };
        case "modify_file":
            return { verb: "Rewrite", detail: short(f("path")), phase: "Editing" };
        case "create_file":
            return { verb: "Create", detail: short(f("path")), phase: "Editing" };
        case "delete_file":
            return { verb: "Delete", detail: short(f("path")), phase: "Editing" };
        case "create_folder":
            return { verb: "Create folder", detail: short(f("path")), phase: "Editing" };
        case "run_command":
            return { verb: "Run", detail: short(f("command"), 90), phase: "Running" };
        case "todo_write":
            return { verb: "Update plan", detail: "", phase: "Planning" };
        case "ask_user":
            return { verb: "Ask", detail: short(f("question"), 90), phase: "Thinking" };
        case "remember":
            return { verb: "Remember", detail: short(f("fact"), 90), phase: "Thinking" };
        case "task":
            return {
                verb: `Sub-agent (${String(f("type") ?? "explorer")})`,
                detail: short(f("description"), 80),
                phase: "Exploring",
            };
        case "list_skills":
            return { verb: "List skills", detail: "", phase: "Exploring" };
        case "read_skill":
            return { verb: "Read skill", detail: short(f("path"), 60), phase: "Exploring" };
        default:
            return {
                verb: toolName,
                detail: short(JSON.stringify(input ?? {}), 80),
                phase: "Thinking",
            };
    }
}

/** One short line that says what a tool returned. */
export function summarizeToolResult(toolName: string, output: unknown): string {
    const text = typeof output === "string" ? output : JSON.stringify(output ?? "");
    const lineCount = text ? text.split("\n").length : 0;
    switch (toolName) {
        case "read_file": {
            const window = text.match(/showing lines (\d+-\d+) of (\d+)/);
            if (window) return `lines ${window[1]} of ${window[2]}`;
            return `${lineCount} lines`;
        }
        case "list_files":
        case "search_files":
            return text.startsWith("(") ? text : `${lineCount} entries`;
        case "grep":
            return text.startsWith("(") ? text : `${lineCount} matches`;
        case "run_command": {
            const head = text.split("\n")[0] ?? "";
            return short(head, 100);
        }
        case "todo_write":
        case "ask_user":
            return "";
        case "task":
            return `${lineCount} lines of findings`;
        default:
            return short(text.split("\n")[0], 100);
    }
}

/** Color a unified diff for the terminal. */
export function colorizeDiff(patch: string, maxLines = 120): string {
    const lines = patch
        .split("\n")
        .filter((l) => !l.startsWith("===") && !l.startsWith("Index: ") && l !== "");
    const shown = lines.slice(0, maxLines).map((line) => {
        if (line.startsWith("+++") || line.startsWith("---")) return chalk.bold(line);
        if (line.startsWith("@@")) return chalk.cyan(line);
        if (line.startsWith("+")) return chalk.green(line);
        if (line.startsWith("-")) return chalk.red(line);
        return chalk.dim(line);
    });
    if (lines.length > maxLines) {
        shown.push(chalk.dim(`… ${lines.length - maxLines} more diff lines`));
    }
    return shown.join("\n");
}

/**
 * Everything the agent prints goes through this class. Output is always
 * written as whole lines, and a one-line spinner sits below it, so the screen
 * never looks frozen and lines never tear.
 */
export class AgentUI {
    private readonly tty = Boolean(process.stdout.isTTY);
    private timer: ReturnType<typeof setInterval> | undefined;
    private frame = 0;
    private running = false;
    private spinnerDrawn = false;
    private suspended = 0;
    private phase: Phase = "Thinking";
    private runStarted = 0;
    private step = 0;
    private usage: UsageTotals | undefined;
    private contextWindow = 0;

    private reasoningBuf = "";
    private reasoningOpen = false;
    private textBuf = "";

    /** Label of each running tool call, to name results that arrive out of order. */
    private callLabels = new Map<string, string>();
    private lastCallId = "";

    private inputBuf = "";
    private inputAttached = false;
    private promptChain: Promise<unknown> = Promise.resolve();

    /** Called with a message the user typed while the agent was working. */
    onSteer: ((text: string) => void) | undefined;
    /** Called when the user presses Esc or Ctrl+C during a run. */
    onAbort: (() => void) | undefined;

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
        const parts = [
            `${this.phase}…`,
            formatDuration(Date.now() - this.runStarted),
        ];
        if (this.step > 0) parts.push(`step ${this.step}`);
        if (this.usage) {
            parts.push(
                `${formatTokens(this.usage.inputTokens + this.usage.outputTokens)} tok`,
            );
            if (this.contextWindow && this.usage.lastInputTokens) {
                const pct = Math.round(
                    (this.usage.lastInputTokens / this.contextWindow) * 100,
                );
                parts.push(`ctx ${pct}%`);
            }
        }
        parts.push("esc to stop");
        let line = `${FRAMES[this.frame % FRAMES.length]} ${parts.join(" · ")}`;
        if (this.inputBuf) line += `  › ${this.inputBuf}`;
        const max = this.columns() - 1;
        if (line.length > max) line = line.slice(0, max - 1) + "…";
        const [glyph, ...rest] = line.split(" ");
        process.stdout.write(
            `\r\x1b[2K${chalk.cyan(glyph)} ${chalk.dim(rest.join(" "))}`,
        );
        this.spinnerDrawn = true;
    }

    /** Print whole lines above the spinner. */
    print(text = ""): void {
        this.clearSpinner();
        process.stdout.write(text + "\n");
        this.drawSpinner();
    }

    // ---------- run lifecycle ----------

    startRun(usage: UsageTotals, contextWindow: number): void {
        this.running = true;
        this.runStarted = Date.now();
        this.step = 0;
        this.usage = usage;
        this.contextWindow = contextWindow;
        this.phase = "Thinking";
        if (this.tty) {
            this.timer = setInterval(() => {
                this.frame++;
                this.drawSpinner();
            }, 90);
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

    elapsedMs(): number {
        return Date.now() - this.runStarted;
    }

    setPhase(phase: Phase): void {
        this.phase = phase;
        this.drawSpinner();
    }

    // ---------- typing while the agent works ----------

    private readonly onKey = (chunk: Buffer) => {
        const key = chunk.toString("utf8");
        if (key === "\u001b" || key === "\u0003") {
            this.onAbort?.();
            return;
        }
        if (key.startsWith("\u001b")) return; // arrows and other escape sequences
        if (key === "\r" || key === "\n") {
            const text = this.inputBuf.trim();
            this.inputBuf = "";
            if (text) {
                this.print(chalk.magenta(`  › you (mid-run): ${text}`));
                this.onSteer?.(text);
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
            // no raw mode available: run without mid-run input
        }
    }

    private detachInput(): void {
        if (!this.inputAttached) return;
        process.stdin.off("data", this.onKey);
        try {
            process.stdin.setRawMode(false);
        } catch {
            // ignore
        }
        process.stdin.pause();
        this.inputAttached = false;
    }

    /**
     * Run an interactive prompt (approval, question). Prompts run one at a
     * time, with the spinner and the mid-run input paused.
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

    /** Print finished markdown blocks; keep an unfinished one in the buffer. */
    private flushText(final: boolean): void {
        if (final) {
            if (this.textBuf.trim()) {
                this.print("\n" + renderTerminalMarkdown(this.textBuf));
            }
            this.textBuf = "";
            return;
        }
        // Only cut at a blank line that is outside a code fence.
        let cutAt = -1;
        let inFence = false;
        let pos = 0;
        const lines = this.textBuf.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i]!;
            if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
            pos += line.length + 1;
            if (!inFence && line.trim() === "" && i > 0) cutAt = pos;
        }
        if (cutAt > 0) {
            const block = this.textBuf.slice(0, cutAt);
            this.textBuf = this.textBuf.slice(cutAt);
            if (block.trim()) this.print("\n" + renderTerminalMarkdown(block));
        }
    }

    private flushStreams(): void {
        this.flushReasoning(true);
        this.flushText(true);
    }

    /** Feed one part of the main agent's stream to the screen. */
    handlePart(part: StreamPartLike): void {
        switch (part.type) {
            case "start-step":
                this.step++;
                this.setPhase("Thinking");
                break;
            case "reasoning-delta":
                this.reasoningBuf += part.text ?? "";
                this.flushReasoning(false);
                break;
            case "reasoning-end":
                this.flushReasoning(true);
                break;
            case "text-delta":
                this.flushReasoning(true);
                if (this.phase !== "Writing") this.setPhase("Writing");
                this.textBuf += part.text ?? "";
                this.flushText(false);
                break;
            case "text-end":
                this.flushText(true);
                break;
            case "tool-call": {
                this.flushStreams();
                const d = describeToolCall(part.toolName ?? "", part.input);
                this.setPhase(d.phase);
                if (part.toolName !== "todo_write") {
                    this.print(
                        `${chalk.cyan("●")} ${chalk.bold(d.verb)} ${d.detail}`.trimEnd(),
                    );
                    this.callLabels.set(part.toolCallId ?? "", `${d.verb} ${d.detail}`.trim());
                    this.lastCallId = part.toolCallId ?? "";
                }
                break;
            }
            case "tool-result": {
                if (part.preliminary) break;
                const summary = summarizeToolResult(part.toolName ?? "", part.output);
                if (summary) this.print(chalk.dim(`  ⎿ ${this.resultPrefix(part)}${summary}`));
                break;
            }
            case "tool-error":
                this.print(
                    chalk.red(`  ⎿ ${this.resultPrefix(part)}${short(errorText(part.error), 200)}`),
                );
                break;
            case "finish-step":
                this.flushStreams();
                break;
            case "error":
                // The brain shows the error once, in plain words.
                this.flushStreams();
                break;
            default:
                break;
        }
    }

    /**
     * When calls run in parallel, a result is not printed right under its
     * call. In that case name the call it belongs to.
     */
    private resultPrefix(part: StreamPartLike): string {
        const id = part.toolCallId ?? "";
        const label = this.callLabels.get(id);
        this.callLabels.delete(id);
        const adjacent = id === this.lastCallId;
        this.lastCallId = "";
        return adjacent || !label ? "" : `${label}: `;
    }

    // ---------- structured output ----------

    /** A progress line from a sub-agent, indented under its parent call. */
    subLine(tag: string, text: string): void {
        this.print(chalk.dim(`  ⎿ ${chalk.cyan(tag)} ${text}`));
    }

    note(text: string): void {
        this.print(chalk.yellow(`◆ ${text}`));
    }

    success(text: string): void {
        this.print(chalk.green(`✓ ${text}`));
    }

    /** Show an error in plain words, with what the user can do about it. */
    errorBox(raw: string): void {
        const { problem, fix } = explainError(raw);
        const lines = [
            "",
            chalk.red.bold(`✗ ${problem}`),
            `  ${chalk.bold("What to do:")} ${fix}`,
        ];
        const detail = raw.replace(/\s+/g, " ").trim();
        if (detail && detail !== problem) {
            lines.push(chalk.dim(`  Technical detail: ${short(detail, 220)}`));
        }
        this.print(lines.join("\n"));
    }

    failure(text: string): void {
        this.print(chalk.red(`✗ ${text}`));
    }

    showTodos(todos: TodoItem[]): void {
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

    showDiff(patch: string, maxLines = 120): void {
        if (patch.trim()) this.print(colorizeDiff(patch, maxLines));
    }

    turnSummary(usage: UsageTotals, turnTokens: number, steps: number): void {
        const parts = [
            `${steps} step${steps === 1 ? "" : "s"}`,
            formatDuration(this.elapsedMs()),
            `${formatTokens(turnTokens)} tokens`,
        ];
        if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(4)} session`);
        this.print(chalk.dim(`\n  ${parts.join(" · ")}`));
    }
}

/** Translate a raw provider or network error into plain words and a next step. */
export function explainError(raw: string): { problem: string; fix: string } {
    const t = raw.toLowerCase();
    const has = (...words: string[]) => words.some((w) => t.includes(w));

    if (
        has("no auth credentials", "missing api key", "api key is missing", "missing authentication", "authentication header") ||
        (has("401") && !has("model"))
    ) {
        return {
            problem: "Your OpenRouter key is missing or not accepted.",
            fix: "Type / and choose “Set API key”, then paste a key from https://openrouter.ai/keys",
        };
    }
    if (has("invalid api key", "unauthorized", "user not found")) {
        return {
            problem: "OpenRouter did not accept your API key.",
            fix: "Type / and choose “Set API key” and paste a fresh key from https://openrouter.ai/keys",
        };
    }
    if (has("402", "insufficient credits", "payment required", "more credits")) {
        return {
            problem: "Your OpenRouter account has no credits left for this model.",
            fix: "Add credits at https://openrouter.ai/credits, or type / → “Change AI model” and pick a free one (for example openrouter/free).",
        };
    }
    if (has("429", "rate limit", "rate-limit", "too many requests")) {
        return {
            problem: "The AI service is busy or you hit its rate limit.",
            fix: "Wait a minute and send your message again. Free models have low limits; a paid model is more reliable.",
        };
    }
    if (has("no endpoints found", "tool use", "support tool", "function calling")) {
        return {
            problem: "This AI model cannot use tools, so it cannot work as an agent.",
            fix: "Type / → “Change AI model” and choose a model that supports tool calling.",
        };
    }
    if (has("not a valid model", "model not found", "no such model", "404")) {
        return {
            problem: "The AI model name was not found.",
            fix: "Type / → “Change AI model” and enter a model id from https://openrouter.ai/models",
        };
    }
    if (has("context length", "maximum context", "too many tokens", "context window")) {
        return {
            problem: "The conversation became too long for this model.",
            fix: "Type / → “Free up memory”, or “Start a new conversation”, then try again.",
        };
    }
    if (has("fetch failed", "enotfound", "econnrefused", "econnreset", "network", "socket", "getaddrinfo", "unable to connect")) {
        return {
            problem: "Could not reach the AI service.",
            fix: "Check your internet connection and send your message again.",
        };
    }
    if (has("timeout", "timed out")) {
        return {
            problem: "The AI service took too long to answer.",
            fix: "Send your message again. If it keeps happening, switch model with / → “Change AI model”.",
        };
    }
    if (has("500", "502", "503", "overloaded", "internal server error", "bad gateway", "provider returned error")) {
        return {
            problem: "The AI service had a problem on its side.",
            fix: "Send your message again in a moment, or switch model with / → “Change AI model”.",
        };
    }
    return {
        problem: "Something went wrong while talking to the AI.",
        fix: "Send your message again. If it repeats, type / → “Change AI model”, or start a new conversation.",
    };
}

export function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export { formatTokens, formatDuration };
