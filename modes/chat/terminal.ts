/**
 * The terminal front end of chat mode. It only reads input, shows progress
 * and prints what the pipeline returns; all the thinking is in pipeline.ts.
 * Another front end (Telegram, a web page) would replace just this file.
 */
import chalk from "chalk";
import { isCancel, log, text } from "@clack/prompts";
import { applyUserSettings, saveUserSettings } from "../../ai";
import { renderTerminalMarkdown } from "../../terminal-ui/terminal-md";
import { readInput, type InputCommand } from "../agent/input";
import { setupApiKey } from "../agent/orchestrator";
import { errorText, explainError, formatDuration, formatTokens } from "../agent/ui";
import { createChatEngine } from "./factory";
import { BudgetError, redactSecrets } from "./guardrails";
import type { ChatEngine } from "./pipeline";
import type { ChatResult, CitedSource } from "./types";

const COMMANDS: InputCommand[] = [
    { name: "/new", hint: "start a new conversation" },
    { name: "/sources", hint: "show the sources of the last web answer" },
    { name: "/search", hint: "search the web for the question you type next", takesArg: true },
    { name: "/nosearch", hint: "answer the question you type next without the web", takesArg: true },
    { name: "/debug", hint: "show or hide routing and token usage" },
    { name: "/model", hint: "change the answer model" },
    { name: "/key", hint: "set your OpenRouter key" },
    { name: "/help", hint: "what you can do here" },
    { name: "/exit", hint: "back to the main menu" },
];

const HELP = [
    chalk.bold("Chat mode"),
    "Ask anything. yuvi answers from what it knows, and searches the web only",
    "when the answer depends on recent information.",
    "",
    ...COMMANDS.map((c) => `${chalk.cyan(c.name.padEnd(10))} ${c.hint}`),
    "",
    chalk.dim("Ctrl+C or Esc while yuvi is working cancels that answer."),
    chalk.dim("To change files or run commands, use Agent mode from the main menu."),
].join("\n");

const out = process.stdout;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;

/** One quiet line that says what yuvi is doing, removed when the answer starts. */
class StatusLine {
    private timer: ReturnType<typeof setInterval> | undefined;
    private label = "";
    private frame = 0;

    set(label: string): void {
        this.label = label;
        if (!out.isTTY || this.timer) return;
        this.draw();
        this.timer = setInterval(() => this.draw(), SPINNER_INTERVAL_MS);
    }

    private draw(): void {
        const frame = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length];
        out.write(`\r\x1b[2K${chalk.cyan(frame)} ${chalk.dim(this.label)}`);
    }

    stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = undefined;
        out.write("\r\x1b[2K");
    }
}

/** What follows a blank line when a list goes on (a new item or an indented line). */
const LIST_CONTINUES = /^(\s*([-*+]|\d+[.)])\s|\s{2,}\S)/;
/** Characters needed after a blank line to tell whether a list goes on. */
const LOOKAHEAD_CHARS = 4;

/**
 * Prints the answer while it streams. Raw Markdown is hard to read, so text
 * is shown one finished block (paragraph, list, code block) at a time, each
 * rendered for the terminal as soon as it is complete.
 */
export class AnswerPrinter {
    private pending = "";
    private printed = false;

    constructor(private readonly beforeFirstPrint: () => void) {}

    push(token: string): void {
        this.pending += token;
        let from = 0;
        while (true) {
            const cut = this.pending.indexOf("\n\n", from);
            if (cut === -1) return;
            const block = this.pending.slice(0, cut);
            const rest = this.pending.slice(cut + 2);
            if (rest.length < LOOKAHEAD_CHARS) return;
            // Never split inside a code fence or in the middle of a list.
            const insideFence = (block.match(/```/g)?.length ?? 0) % 2 === 1;
            if (insideFence || LIST_CONTINUES.test(rest)) {
                from = cut + 2;
                continue;
            }
            this.print(block);
            this.pending = rest.replace(/^\n+/, "");
            from = 0;
        }
    }

    end(): void {
        this.print(this.pending);
        this.pending = "";
    }

    private print(block: string): void {
        const rendered = renderTerminalMarkdown(block);
        if (!rendered) return;
        if (!this.printed) this.beforeFirstPrint();
        out.write(`${this.printed ? "\n" : ""}${rendered}\n`);
        this.printed = true;
    }
}

/** While a request runs, Ctrl+C or Esc cancels it instead of closing the app. */
function listenForCancel(onCancel: () => void): () => void {
    const stdin = process.stdin;
    if (!stdin.isTTY) return () => undefined;
    const onData = (chunk: Buffer) => {
        const key = chunk.toString("utf8");
        if (key === "\u0003" || key === "\u001b") onCancel();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    return () => {
        stdin.off("data", onData);
        try {
            stdin.setRawMode(false);
        } catch {
            // the terminal is already back to normal
        }
        stdin.pause();
    };
}

function printSources(sources: CitedSource[]): void {
    if (!sources.length) return;
    const lines = sources.map((s) => {
        const date = s.date ? chalk.dim(` · ${s.date}`) : "";
        return `  ${chalk.cyan(`[${s.n}]`)} ${s.title}${date}\n      ${chalk.dim.underline(s.url)}`;
    });
    out.write(`\n${chalk.bold("Sources")}\n${lines.join("\n")}\n`);
}

/** The one-line footer under an answer: where it came from and what it cost. */
function printSummary(result: ChatResult, elapsedMs: number): void {
    const tokens = result.usage.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0);
    const cost = result.usage.reduce((sum, u) => sum + u.cost, 0);
    const calls = result.usage.length;
    const parts = [
        result.origin === "web"
            ? `from the web · ${result.sources.length} source${result.sources.length === 1 ? "" : "s"}`
            : "from the model",
        `${calls} model call${calls === 1 ? "" : "s"}`,
        `${formatTokens(tokens)} tokens`,
    ];
    if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
    parts.push(formatDuration(elapsedMs));
    out.write(chalk.dim(`\n  ${parts.join(" · ")}\n`));
}

function printDebug(result: ChatResult): void {
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
    // Debug text can echo what the user typed or what a page said.
    out.write(chalk.dim(`\n${lines.map((l) => `  ${redactSecrets(l)}`).join("\n")}\n`));
}

function printError(error: unknown): void {
    if (error instanceof BudgetError) {
        out.write(
            `\n${chalk.yellow("!")} ${error.message}\n  ${chalk.dim("Ask again, or raise YUVI_CHAT_MAX_CALLS.")}\n`,
        );
        return;
    }
    const { problem, fix } = explainError(redactSecrets(errorText(error)));
    out.write(
        `\n${chalk.red("✖")} ${problem}\n  ${fix}\n` +
        chalk.dim("  In chat: /key sets the API key, /model changes the model, /new starts over.\n"),
    );
}

async function changeModel(engine: ChatEngine): Promise<void> {
    const id = await text({
        message: "New answer model id (Esc to keep the current one):",
        placeholder: engine.config.answerModel(),
    });
    if (isCancel(id) || !String(id ?? "").trim()) return;
    saveUserSettings({ model: String(id).trim() });
    log.success(`Answers now come from ${engine.config.answerModel()}.`);
}

/** Send one message through the pipeline and show the result. */
async function answer(
    engine: ChatEngine,
    question: string,
    force: "search" | "direct" | undefined,
    debug: boolean,
): Promise<void> {
    const controller = new AbortController();
    const status = new StatusLine();
    const printer = new AnswerPrinter(() => status.stop());
    const stopListening = listenForCancel(() => controller.abort());
    const startedAt = Date.now();

    out.write("\n");
    try {
        const result = await engine.ask(question, {
            ...(force ? { force } : {}),
            signal: controller.signal,
            onStatus: (label) => status.set(label),
            onToken: (token) => printer.push(token),
        });
        status.stop();

        if (result.kind === "clarify") {
            out.write(`${chalk.yellow("?")} ${result.answer}\n`);
        } else {
            printer.end();
            printSources(result.sources);
        }
        for (const note of result.notes) out.write(chalk.dim(`\n  Note: ${note}\n`));
        printSummary(result, Date.now() - startedAt);
        if (debug) printDebug(result);
    } catch (error) {
        status.stop();
        printer.end(); // keep whatever was already written
        if (controller.signal.aborted) out.write(chalk.dim("  Cancelled.\n"));
        else printError(error);
    } finally {
        stopListening();
    }
}

export async function runChatMode(): Promise<void> {
    // Provider warnings would break the progress line; errors are still shown.
    (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

    applyUserSettings();
    if (!process.env.OPENROUTER_API_KEY && process.stdin.isTTY && !(await setupApiKey())) {
        log.warn("No key set. You can add it later with /key.");
    }

    let engine: ChatEngine;
    try {
        engine = createChatEngine();
    } catch (error) {
        log.error(errorText(error));
        return;
    }

    let debug = engine.config.debug;
    /** Set by /search or /nosearch without a question: applies to the next message. */
    let forceNext: "search" | "direct" | undefined;
    const history: string[] = [];

    console.log(
        [
            "",
            chalk.bold.cyan("  yuvi chat") + chalk.dim(`  ·  ${engine.config.answerModel()}`),
            "  Ask me anything. I search the web only when the answer needs fresh information.",
            chalk.dim("  Type / to see the commands."),
        ].join("\n"),
    );

    while (true) {
        const input = await readInput({
            footer: () =>
                chalk.dim("  ") +
                chalk.cyan("● Chat") +
                chalk.dim(
                    forceNext
                        ? ` · next answer: ${forceNext === "search" ? "web search" : "no web search"}`
                        : " · / commands · ↑ earlier messages · ctrl+c leave",
                ),
            onCycleMode: () => undefined,
            history,
            commands: COMMANDS,
            placeholder: "Ask a question, then press Enter",
        });
        if (input.kind !== "message") break;

        const line = input.text;
        const [command = "", ...rest] = line.split(/\s+/);
        const argument = rest.join(" ").trim();

        if (line === "exit" || line === "quit" || command === "/exit") break;
        if (command === "/help") {
            log.info(HELP);
            continue;
        }
        if (command === "/new") {
            engine.reset();
            forceNext = undefined;
            log.success("New conversation started.");
            continue;
        }
        if (command === "/sources") {
            if (engine.lastSources.length) printSources(engine.lastSources);
            else log.info("No web sources yet in this conversation.");
            continue;
        }
        if (command === "/debug") {
            debug = !debug;
            log.info(`Routing and token details are now ${debug ? "shown" : "hidden"}.`);
            continue;
        }
        if (command === "/key") {
            await setupApiKey();
            continue;
        }
        if (command === "/model") {
            await changeModel(engine);
            continue;
        }

        let question = line;
        let force = forceNext;
        if (command === "/search" || command === "/nosearch") {
            force = command === "/search" ? "search" : "direct";
            if (!argument) {
                forceNext = force;
                continue;
            }
            question = argument;
        } else if (command.startsWith("/")) {
            log.warn(`Unknown command ${command}. Type /help to see the commands.`);
            continue;
        }

        forceNext = undefined;
        history.push(line);
        await answer(engine, question, force, debug);
    }
}
