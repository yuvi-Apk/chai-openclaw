import chalk from "chalk";
import { isCancel, text } from "@clack/prompts";

export type InputResult =
    | { kind: "message"; text: string }
    | { kind: "menu" }
    | { kind: "exit" };

export interface InputOptions {
    /** Text of the hint bar under the input box; called again after a mode change. */
    footer: (width: number) => string;
    /** Shift+Tab was pressed. */
    onCycleMode: () => void;
    /** Earlier messages, oldest first, for the Up / Down keys. */
    history: string[];
    placeholder: string;
}

const PROMPT = "› ";

/**
 * The message box: a framed input line with a hint bar under it that always
 * says which mode is active and which keys do what.
 *
 *   ────────────────────────────────────────────
 *   › type here
 *   ────────────────────────────────────────────
 *     ● Ask mode · shift+tab switch mode · / menu
 */
export function readInput(options: InputOptions): Promise<InputResult> {
    const stdin = process.stdin;
    const out = process.stdout;

    // No real terminal (piped input): fall back to a plain prompt.
    if (!stdin.isTTY || !out.isTTY) {
        return text({ message: "You:", placeholder: options.placeholder }).then(
            (value) => {
                if (isCancel(value)) return { kind: "exit" as const };
                const line = String(value ?? "").trim();
                if (line === "/") return { kind: "menu" as const };
                return { kind: "message" as const, text: line };
            },
        );
    }

    return new Promise((resolve) => {
        let buffer = "";
        let historyIndex = options.history.length;
        let draft = "";
        const width = () => Math.max(20, (out.columns ?? 80) - 1);
        const rule = () => chalk.dim("─".repeat(width()));

        /** Redraw only the input line; the cursor stays at the end of the text. */
        const drawInput = () => {
            const room = width() - PROMPT.length - 1;
            out.write("\r\x1b[2K" + chalk.cyan(PROMPT));
            if (!buffer) {
                // Placeholder, then put the cursor back right after the prompt.
                out.write(chalk.dim(options.placeholder.slice(0, room)));
                out.write(`\r\x1b[${PROMPT.length}C`);
                return;
            }
            const visible =
                buffer.length > room ? "…" + buffer.slice(buffer.length - room + 1) : buffer;
            out.write(visible);
        };

        const drawFooter = () => {
            out.write(`\x1b[2B\r\x1b[2K${options.footer(width())}\x1b[2A`);
            drawInput();
        };

        const drawAll = () => {
            out.write(`\n${rule()}\n\n${rule()}\n${options.footer(width())}`);
            out.write("\x1b[2A");
            drawInput();
        };

        const close = (result: InputResult) => {
            stdin.off("data", onData);
            try {
                stdin.setRawMode(false);
            } catch {
                // ignore
            }
            stdin.pause();
            // Remove the box, then leave the message in the transcript.
            out.write("\x1b[1A\r\x1b[J");
            if (result.kind === "message") {
                out.write(`${chalk.cyan("›")} ${chalk.bold(result.text)}\n`);
            }
            resolve(result);
        };

        const onData = (chunk: Buffer) => {
            const key = chunk.toString("utf8");

            if (key === "\u0003") {
                // Ctrl+C: first clears what was typed, then leaves.
                if (buffer) {
                    buffer = "";
                    drawInput();
                } else {
                    close({ kind: "exit" });
                }
                return;
            }
            if (key === "\u0004") return close({ kind: "exit" });
            if (key === "\u001b[Z") {
                options.onCycleMode();
                drawFooter();
                return;
            }
            if (key === "\u001b[A" || key === "\u001b[B") {
                if (!options.history.length) return;
                if (historyIndex === options.history.length) draft = buffer;
                historyIndex += key === "\u001b[A" ? -1 : 1;
                historyIndex = Math.max(0, Math.min(options.history.length, historyIndex));
                buffer =
                    historyIndex === options.history.length
                        ? draft
                        : (options.history[historyIndex] ?? "");
                drawInput();
                return;
            }
            if (key === "\u001b") {
                buffer = "";
                drawInput();
                return;
            }
            if (key.startsWith("\u001b")) return; // other special keys

            if (key === "\r" || key === "\n") {
                const line = buffer.trim();
                if (line) close({ kind: "message", text: line });
                return;
            }
            if (key === "\u007f" || key === "\b") {
                buffer = buffer.slice(0, -1);
                drawInput();
                return;
            }
            if (key === "\u0015") {
                buffer = "";
                drawInput();
                return;
            }
            if (key === "\u0017") {
                buffer = buffer.replace(/\S+\s*$/, "");
                drawInput();
                return;
            }

            // "/" on an empty line opens the menu; "?" shows help.
            if (!buffer && key === "/") return close({ kind: "menu" });
            if (!buffer && key === "?") return close({ kind: "message", text: "/help" });

            // Normal typing or a paste (line breaks in a paste become spaces).
            const typed = key.replace(/\r?\n|\r/g, " ").replace(/[\u0000-\u001f]/g, "");
            if (typed) {
                buffer += typed;
                drawInput();
            }
        };

        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
        drawAll();
    });
}
