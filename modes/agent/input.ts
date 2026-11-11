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
    /** Workspace files (relative, "/" separated) offered after typing "@". */
    files?: () => string[];
}

const PROMPT = "› ";
const MAX_SUGGESTIONS = 8;

/** The "@query" being typed at the end of the line, or null when there is none. */
function mentionAtEnd(buffer: string): { start: number; query: string } | null {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(buffer);
    if (!m) return null;
    return { start: buffer.length - m[1]!.length, query: m[1]! };
}

/** Files and folders matching a query, best first. Folders end with "/". */
function rankPaths(paths: string[], query: string): string[] {
    const q = query.toLowerCase().replace(/\\/g, "/");
    if (!q) {
        // Nothing typed yet: shallow paths first, so the list starts at the top level.
        return [...paths]
            .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
            .slice(0, MAX_SUGGESTIONS);
    }
    const scored: Array<{ p: string; score: number }> = [];
    for (const p of paths) {
        const lower = p.toLowerCase();
        const base = lower.replace(/\/$/, "").split("/").pop() ?? lower;
        let score: number;
        if (lower.startsWith(q)) score = 0;
        else if (base.startsWith(q)) score = 1;
        else if (base.includes(q)) score = 2;
        else if (lower.includes(q)) score = 3;
        else {
            // Letters in order, e.g. "orch" → modes/agent/orchestrator.ts
            let i = 0;
            for (const ch of lower) if (ch === q[i]) i++;
            if (i < q.length) continue;
            score = 4;
        }
        scored.push({ p, score });
    }
    return scored
        .sort((a, b) => a.score - b.score || a.p.length - b.p.length || a.p.localeCompare(b.p))
        .slice(0, MAX_SUGGESTIONS)
        .map((s) => s.p);
}

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

        // "@" file suggestions.
        let allPaths: string[] | null = null;
        let suggestions: string[] = [];
        let selected = 0;
        let dismissedAt: string | null = null; // buffer value when Esc hid the list

        const loadPaths = (): string[] => {
            if (allPaths) return allPaths;
            const files = options.files?.() ?? [];
            const dirs = new Set<string>();
            for (const f of files) {
                const parts = f.split("/");
                for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") + "/");
            }
            allPaths = [...dirs, ...files];
            return allPaths;
        };

        const updateSuggestions = () => {
            const mention = options.files ? mentionAtEnd(buffer) : null;
            if (!mention || dismissedAt === buffer) {
                suggestions = [];
                selected = 0;
                return;
            }
            dismissedAt = null;
            const next = rankPaths(loadPaths(), mention.query);
            if (next.join("\n") !== suggestions.join("\n")) selected = 0;
            suggestions = next;
        };

        /** Put the chosen path in place of the "@query" being typed. */
        const acceptSuggestion = () => {
            const mention = mentionAtEnd(buffer);
            const choice = suggestions[selected];
            if (!mention || !choice) return;
            // A folder keeps the list open so you can go on into it.
            buffer = buffer.slice(0, mention.start) + choice + (choice.endsWith("/") ? "" : " ");
        };

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

        /** Redraw the footer, the suggestion list under it, then the input line. */
        const redraw = () => {
            updateSuggestions();
            const w = width();
            let s = `\x1b[2B\r\x1b[2K${options.footer(w)}`;
            const mention = options.files ? mentionAtEnd(buffer) : null;
            const rows: string[] = suggestions.map((p, i) => {
                const label = p.length > w - 4 ? "…" + p.slice(p.length - (w - 5)) : p;
                return i === selected ? chalk.cyan(`› ${label}`) : chalk.dim(`  ${label}`);
            });
            if (mention && !suggestions.length && dismissedAt !== buffer) {
                rows.push(chalk.dim("  no matching files"));
            }
            if (rows.length) rows.push(chalk.dim("  ↑↓ choose · tab/enter select · esc close"));
            // "\n" (not cursor-down) so the screen scrolls when the box is at the bottom.
            for (const row of rows) s += `\n\x1b[2K${row}`;
            s += "\x1b[J"; // wipe rows left over from a longer list
            s += `\x1b[${2 + rows.length}A`;
            out.write(s);
            drawInput();
        };

        const drawAll = () => {
            out.write(`\n${rule()}\n\n${rule()}\n${options.footer(width())}`);
            out.write("\x1b[2A");
            redraw();
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
                    redraw();
                } else {
                    close({ kind: "exit" });
                }
                return;
            }
            if (key === "\u0004") return close({ kind: "exit" });
            if (key === "\u001b[Z") {
                options.onCycleMode();
                redraw();
                return;
            }

            // While the "@" file list is open, arrows / Tab / Enter / Esc drive it.
            if (suggestions.length) {
                if (key === "\u001b[A" || key === "\u001b[B") {
                    const n = suggestions.length;
                    selected = (selected + (key === "\u001b[A" ? n - 1 : 1)) % n;
                    redraw();
                    return;
                }
                if (key === "\t" || key === "\r" || key === "\n") {
                    acceptSuggestion();
                    redraw();
                    return;
                }
                if (key === "\u001b") {
                    dismissedAt = buffer;
                    redraw();
                    return;
                }
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
                dismissedAt = buffer; // don't pop the file list up over a recalled message
                redraw();
                return;
            }
            if (key === "\u001b") {
                buffer = "";
                redraw();
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
                redraw();
                return;
            }
            if (key === "\u0015") {
                buffer = "";
                redraw();
                return;
            }
            if (key === "\u0017") {
                buffer = buffer.replace(/\S+\s*$/, "");
                redraw();
                return;
            }

            // "/" on an empty line opens the menu; "?" shows help.
            if (!buffer && key === "/") return close({ kind: "menu" });
            if (!buffer && key === "?") return close({ kind: "message", text: "/help" });

            // Normal typing or a paste (line breaks in a paste become spaces).
            const typed = key.replace(/\r?\n|\r/g, " ").replace(/[\u0000-\u001f]/g, "");
            if (typed) {
                buffer += typed;
                redraw();
            }
        };

        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
        drawAll();
    });
}
