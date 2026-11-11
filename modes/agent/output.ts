/**
 * Everything the agent reports goes through this class. It turns the
 * agent's activity (model stream parts, tool calls, notes) into the common
 * mode events, so the agent never touches the screen itself.
 */
import { errorText } from "../../core/errors";
import { formatDuration, formatTokens, shorten } from "../../core/format";
import type { Line, ModeHost } from "../../core/mode";
import { redactSecrets } from "../../core/security/redact";
import type { TodoItem, UsageTotals } from "./types";

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

/** One part of the model stream, reduced to the fields that are reported. */
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
            return { verb: "Read", detail: shorten(f("path")), phase: "Exploring" };
        case "list_files":
            return { verb: "List", detail: shorten(f("path") || "."), phase: "Exploring" };
        case "search_files":
            return { verb: "Find files", detail: shorten(f("pattern")), phase: "Exploring" };
        case "grep":
            return {
                verb: "Search",
                detail: `"${shorten(f("pattern"), 50)}"${f("path") ? ` in ${shorten(f("path"), 30)}` : ""}`,
                phase: "Exploring",
            };
        case "find_symbol":
            return { verb: "Find symbol", detail: shorten(f("name")), phase: "Exploring" };
        case "edit_file":
            return { verb: "Edit", detail: shorten(f("path")), phase: "Editing" };
        case "modify_file":
            return { verb: "Rewrite", detail: shorten(f("path")), phase: "Editing" };
        case "create_file":
            return { verb: "Create", detail: shorten(f("path")), phase: "Editing" };
        case "delete_file":
            return { verb: "Delete", detail: shorten(f("path")), phase: "Editing" };
        case "create_folder":
            return { verb: "Create folder", detail: shorten(f("path")), phase: "Editing" };
        case "run_command":
            return { verb: "Run", detail: shorten(f("command"), 90), phase: "Running" };
        case "todo_write":
            return { verb: "Update plan", detail: "", phase: "Planning" };
        case "ask_user":
            return { verb: "Ask", detail: shorten(f("question"), 90), phase: "Thinking" };
        case "remember":
            return { verb: "Remember", detail: shorten(f("fact"), 90), phase: "Thinking" };
        case "task":
            return {
                verb: `Sub-agent (${String(f("type") ?? "explorer")})`,
                detail: shorten(f("description"), 80),
                phase: "Exploring",
            };
        case "list_skills":
            return { verb: "List skills", detail: "", phase: "Exploring" };
        case "read_skill":
            return { verb: "Read skill", detail: shorten(f("path"), 60), phase: "Exploring" };
        default:
            return {
                verb: toolName,
                detail: shorten(JSON.stringify(input ?? {}), 80),
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
            return shorten(head, 100);
        }
        case "todo_write":
        case "ask_user":
            return "";
        case "task":
            return `${lineCount} lines of findings`;
        default:
            return shorten(text.split("\n")[0], 100);
    }
}

/** The plan tool is shown as a plan, not as a tool call. */
const SILENT_TOOLS = new Set(["todo_write"]);
const TOOL_ERROR_MAX_CHARS = 200;

export class AgentOutput {
    private phase: Phase = "Thinking";
    private runStartedAt = 0;
    /** The text of the step that is streaming now; the last one is the final answer. */
    private stepText = "";
    private lastText = "";

    constructor(private readonly host: ModeHost) {}

    // ---------- plain reporting ----------

    line(line: Line): void {
        this.host.emit({ type: "line", line });
    }

    note(text: string): void {
        this.host.emit({ type: "notice", level: "note", text });
    }

    success(text: string): void {
        this.host.emit({ type: "notice", level: "success", text });
    }

    failure(text: string): void {
        this.host.emit({ type: "notice", level: "failure", text });
    }

    /** Report a failure as raw text; the front end words it for the user. */
    error(raw: string): void {
        this.host.emit({ type: "error", message: redactSecrets(raw, this.host.core.settings.secrets()) });
    }

    setPhase(phase: Phase): void {
        this.phase = phase;
        this.host.emit({ type: "status", text: phase });
    }

    showTodos(items: TodoItem[]): void {
        this.host.emit({ type: "todos", items });
    }

    /** A progress line from a sub-agent. */
    subLine(tag: string, text: string): void {
        this.host.emit({ type: "progress", tag, text });
    }

    // ---------- one turn ----------

    startRun(usage: UsageTotals, contextWindow: number): void {
        this.runStartedAt = Date.now();
        this.stepText = "";
        this.lastText = "";
        this.reportUsage(usage, contextWindow);
        this.setPhase("Thinking");
    }

    reportUsage(usage: UsageTotals, contextWindow: number): void {
        this.host.emit({
            type: "usage",
            tokens: usage.inputTokens + usage.outputTokens,
            ...(contextWindow && usage.lastInputTokens
                ? { contextPercent: Math.round((usage.lastInputTokens / contextWindow) * 100) }
                : {}),
        });
    }

    /** Feed one part of the main agent's stream to the front end. */
    handlePart(part: StreamPartLike): void {
        switch (part.type) {
            case "start-step":
                this.host.emit({ type: "step", phase: "start" });
                this.setPhase("Thinking");
                this.stepText = "";
                break;
            case "reasoning-delta":
                this.host.emit({ type: "reasoning", text: part.text ?? "" });
                break;
            case "reasoning-end":
                this.host.emit({ type: "reasoning", text: "", end: true });
                break;
            case "text-delta":
                if (this.phase !== "Writing") this.setPhase("Writing");
                this.stepText += part.text ?? "";
                this.host.emit({ type: "token", text: part.text ?? "" });
                break;
            case "text-end":
                this.host.emit({ type: "token", text: "", end: true });
                break;
            case "tool-call": {
                const d = describeToolCall(part.toolName ?? "", part.input);
                this.setPhase(d.phase);
                this.host.emit({
                    type: "tool",
                    phase: "call",
                    id: part.toolCallId ?? "",
                    title: d.verb,
                    detail: d.detail,
                    ...(SILENT_TOOLS.has(part.toolName ?? "") ? { silent: true } : {}),
                });
                break;
            }
            case "tool-result":
                if (part.preliminary) break;
                this.host.emit({
                    type: "tool",
                    phase: "result",
                    id: part.toolCallId ?? "",
                    summary: summarizeToolResult(part.toolName ?? "", part.output),
                });
                break;
            case "tool-error":
                this.host.emit({
                    type: "tool",
                    phase: "error",
                    id: part.toolCallId ?? "",
                    summary: shorten(errorText(part.error), TOOL_ERROR_MAX_CHARS),
                });
                break;
            case "finish-step":
            case "error":
                // An error is reported once, in plain words, by the brain.
                if (this.stepText.trim()) this.lastText = this.stepText;
                this.host.emit({ type: "step", phase: "end" });
                break;
            default:
                break;
        }
    }

    /** Close the turn: the full reply for front ends that do not stream, then the totals. */
    turnSummary(usage: UsageTotals, turnTokens: number, steps: number): void {
        if (this.lastText.trim()) {
            this.host.emit({ type: "answer", text: this.lastText.trim(), kind: "answer" });
        }
        const parts = [
            `${steps} step${steps === 1 ? "" : "s"}`,
            formatDuration(Date.now() - this.runStartedAt),
            `${formatTokens(turnTokens)} tokens`,
        ];
        if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(4)} session`);
        this.host.emit({ type: "summary", parts });
    }
}
