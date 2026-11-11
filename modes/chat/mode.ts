/**
 * Chat mode as a pluggable mode: questions and answers, with a web search
 * when the answer needs fresh facts. It can search and read pages only; it
 * never touches files or runs commands. The thinking is in pipeline.ts.
 */
import { BudgetError, errorText } from "../../core/errors";
import { formatDuration, formatTokens } from "../../core/format";
import type { Line, Mode, ModeCommand, ModeHost, ModeSession, ModeStatus, SourceItem } from "../../core/mode";
import { redactSecrets } from "../../core/security/redact";
import { totalUsage } from "../../core/usage";
import { createChatEngine } from "./factory";
import type { ChatEngine } from "./pipeline";
import type { ChatResult, CitedSource } from "./types";

type Force = "search" | "direct";

const dim = (text: string) => ({ text, tone: "dim" as const });

/** Sources as the front end shows them: number, title, link and date, without the excerpt. */
const sourceItems = (sources: CitedSource[]): SourceItem[] =>
    sources.map(({ n, title, url, date }) => ({ n, title, url, ...(date ? { date } : {}) }));

/** The one-line footer under an answer: where it came from and what it cost. */
function summaryParts(result: ChatResult, elapsedMs: number): string[] {
    const { calls, inputTokens, outputTokens, cost } = totalUsage(result.usage);
    const parts = [
        result.origin === "web"
            ? `from the web · ${result.sources.length} source${result.sources.length === 1 ? "" : "s"}`
            : "from the model",
        `${calls} model call${calls === 1 ? "" : "s"}`,
        `${formatTokens(inputTokens + outputTokens)} tokens`,
    ];
    if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
    parts.push(formatDuration(elapsedMs));
    return parts;
}

/** Routing and per-step usage, shown when /debug is on. */
function debugLines(result: ChatResult): string[] {
    const lines = [
        `route: ${result.route.needsSearch ? "search" : "direct"} (${result.route.via}, ${result.route.complexity}) — ${result.route.reason}`,
    ];
    if (result.plan) {
        lines.push(`intent: ${result.plan.intent}`);
        if (result.plan.assumption) lines.push(`assumption: ${result.plan.assumption}`);
        lines.push(`queries: ${result.plan.queries.join(" | ")}`);
        lines.push(`cache hits: ${result.cacheHits}`);
    }
    for (const u of result.usage) {
        lines.push(
            `${u.step.padEnd(12)} ${u.model}  in ${u.inputTokens}  out ${u.outputTokens}` +
            `${u.cost > 0 ? `  $${u.cost.toFixed(5)}` : ""}  ${u.ms}ms`,
        );
    }
    return lines;
}

class ChatModeSession implements ModeSession {
    private readonly engine: ChatEngine;
    private debug: boolean;
    /** Set by /search or /nosearch: applies to the next message only. */
    private forceNext: Force | undefined;

    constructor(private readonly host: ModeHost) {
        this.engine = createChatEngine(host.core);
        this.debug = this.engine.config.debug;
    }

    async handle(input: string, options: { signal: AbortSignal }): Promise<void> {
        const { host } = this;
        const secrets = host.core.settings.secrets();
        const force = this.forceNext;
        this.forceNext = undefined;
        const startedAt = Date.now();

        try {
            const result = await this.engine.ask(input, {
                ...(force ? { force } : {}),
                signal: options.signal,
                onStatus: (text) => host.emit({ type: "status", text }),
                onToken: (text) => host.emit({ type: "token", text }),
            });
            host.emit({ type: "token", text: "", end: true });
            host.emit({ type: "answer", text: result.answer, kind: result.kind });
            if (result.kind === "answer" && result.sources.length) {
                host.emit({ type: "sources", items: sourceItems(result.sources) });
            }
            for (const note of result.notes) host.emit({ type: "line", line: dim(`\n  Note: ${note}`) });
            host.emit({ type: "summary", parts: summaryParts(result, Date.now() - startedAt) });
            if (this.debug) {
                // Debug text can echo what the user typed or what a page said.
                const lines = debugLines(result).map((line) => `  ${redactSecrets(line, secrets)}`);
                host.emit({ type: "line", line: dim(`\n${lines.join("\n")}`) });
            }
        } catch (error) {
            host.emit({ type: "token", text: "", end: true }); // keep whatever was already written
            if (options.signal.aborted) {
                host.emit({ type: "line", line: dim("  Cancelled.") });
            } else if (error instanceof BudgetError) {
                host.emit({
                    type: "line",
                    line: ["\n", { text: "!", tone: "warn" }, ` ${error.message}\n  `, dim("Ask again, or raise YUVI_CHAT_MAX_CALLS.")],
                });
            } else {
                host.emit({
                    type: "error",
                    message: redactSecrets(errorText(error), secrets),
                    hint: "In chat: /login sets the API key, /model changes the model, /new starts over.",
                });
            }
        }
    }

    status(): ModeStatus {
        const detail = this.forceNext
            ? `next answer: ${this.forceNext === "search" ? "web search" : "no web search"}`
            : "";
        return { label: "Chat", detail, tone: "accent" };
    }

    welcome(): Line[] {
        return [
            "",
            [
                { text: "  yuvi chat", tone: "title" },
                { text: `  ·  ${this.engine.config.answerModel()}`, tone: "dim" },
            ],
            "  Ask me anything. I search the web only when the answer needs fresh information.",
            dim("  Type / to see the commands."),
        ];
    }

    help(): Line[] {
        return [
            { text: "Chat mode", tone: "strong" },
            "Ask anything. yuvi answers from what it knows, and searches the web only",
            "when the answer depends on recent information.",
            "",
            dim("To change files or run commands, use Agent mode from the main menu."),
        ];
    }

    /** /search and /nosearch: with a question they answer it now, without one they arm the next message. */
    private forced(force: Force) {
        return (arg: string) => {
            this.forceNext = force;
            return arg ? { submit: arg } : undefined;
        };
    }

    commands(): ModeCommand[] {
        const { host, engine } = this;
        return [
            {
                name: "/new",
                label: "Start a new conversation",
                hint: "start a new conversation",
                run: () => {
                    engine.reset();
                    this.forceNext = undefined;
                    host.emit({ type: "notice", level: "success", text: "New conversation started." });
                },
            },
            {
                name: "/sources",
                label: "Show sources",
                hint: "show the sources of the last web answer",
                run: () => {
                    if (engine.lastSources.length) host.emit({ type: "sources", items: sourceItems(engine.lastSources) });
                    else host.emit({ type: "notice", level: "note", text: "No web sources yet in this conversation." });
                },
            },
            {
                name: "/search",
                label: "Search the web",
                hint: "search the web for the question you type next",
                takesArg: true,
                run: this.forced("search"),
            },
            {
                name: "/nosearch",
                label: "Answer without the web",
                hint: "answer the question you type next without the web",
                takesArg: true,
                run: this.forced("direct"),
            },
            {
                name: "/debug",
                label: "Show routing details",
                hint: "show or hide routing and token usage",
                run: () => {
                    this.debug = !this.debug;
                    host.emit({
                        type: "notice",
                        level: "note",
                        text: `Routing and token details are now ${this.debug ? "shown" : "hidden"}.`,
                    });
                },
            },
        ];
    }

    async close(): Promise<void> {
        // Nothing is kept between sessions.
    }
}

export const chatMode: Mode = {
    name: "chat",
    label: "Chat",
    description: "ask questions, with web search when needed",
    tools: ["web.search", "web.fetch"],
    commandStyle: "typed",
    placeholder: "Ask a question, then press Enter",
    createSession: (host) => new ChatModeSession(host),
};
