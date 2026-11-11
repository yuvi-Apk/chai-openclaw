/**
 * Prints streamed Markdown. Raw Markdown is hard to read, so text is shown
 * one finished block (paragraph, list, code block) at a time, each rendered
 * for the terminal as soon as it is complete.
 */
import { renderTerminalMarkdown } from "./markdown";

/** What follows a blank line when a list goes on (a new item or an indented line). */
const LIST_CONTINUES = /^(\s*([-*+]|\d+[.)])\s|\s{2,}\S)/;
/** Characters needed after a blank line to tell whether a list goes on. */
const LOOKAHEAD_CHARS = 4;

export class StreamPrinter {
    private pending = "";

    /** @param print receives each finished block, already rendered */
    constructor(private readonly print: (rendered: string) => void) {}

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
            this.flush(block);
            this.pending = rest.replace(/^\n+/, "");
            from = 0;
        }
    }

    /** Print whatever is left. Safe to call when nothing is pending. */
    end(): void {
        this.flush(this.pending);
        this.pending = "";
    }

    private flush(block: string): void {
        const rendered = renderTerminalMarkdown(block);
        if (rendered) this.print(rendered);
    }
}
