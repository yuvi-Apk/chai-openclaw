import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

let ready = false;

/** Register the terminal renderer with marked once, on first use. */
function ensureReady() {
    if (ready) return;
    const columns = process.stdout.columns ?? 80;
    marked.use(
        markedTerminal({
            width: Math.min(columns, 120),
            reflowText: true,
            tab: 2,
        }),
    );
    ready = true;
}

/**
 * Render Markdown (e.g. an AI reply) as ANSI-styled text for the terminal.
 * Falls back to the raw text if rendering fails.
 */
export function renderTerminalMarkdown(markdown: string): string {
    if (!markdown?.trim()) return "";
    ensureReady();
    try {
        const out = marked.parse(markdown, { async: false }) as string;
        return out.replace(/\n+$/, "");
    } catch {
        return markdown;
    }
}
