/** How the terminal shows emphasis, diffs and styled lines. */
import chalk from "chalk";
import type { Line, Tone } from "../../core/mode";

const PAINT: Record<Tone, (text: string) => string> = {
    strong: chalk.bold,
    dim: chalk.dim,
    accent: chalk.cyan,
    title: chalk.bold.cyan,
    good: chalk.green,
    warn: chalk.yellow,
    bad: chalk.red,
    info: chalk.blue,
};

export const paint = (tone: Tone, text: string) => PAINT[tone](text);

/** A mode's line with its emphasis turned into terminal colours. */
export function styled(line: Line): string {
    const spans = Array.isArray(line) ? line : [line];
    return spans.map((span) => (typeof span === "string" ? span : paint(span.tone, span.text))).join("");
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
