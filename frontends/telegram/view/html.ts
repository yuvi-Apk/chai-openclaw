/**
 * Text for Telegram. Telegram accepts a small set of HTML tags, so model
 * markdown is converted block by block, and long replies are split into
 * messages that each stay under Telegram's size limit.
 */
import { marked, type Token, type Tokens } from "marked";
import { lineText, type Line, type Span, type Tone } from "../../../core/mode";

/** Telegram's limit is 4096 characters; this leaves room for tags. */
export const MESSAGE_MAX_CHARS = 3800;

/** Make text safe to place inside Telegram HTML. */
export function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const escapeAttribute = (text: string) => escapeHtml(text).replace(/"/g, "&quot;");

/** Remove tags and decode the entities escapeHtml writes: the plain-text fallback. */
export function stripHtml(html: string): string {
    return html
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
}

const TONE_TAG: Partial<Record<Tone, string>> = { strong: "b", title: "b", dim: "i", accent: "b" };

function spanHtml(span: Span): string {
    if (typeof span === "string") return escapeHtml(span);
    const tag = TONE_TAG[span.tone];
    const text = escapeHtml(span.text);
    return tag && span.text.trim() ? `<${tag}>${text}</${tag}>` : text;
}

/** A mode's styled line as Telegram HTML. */
export function lineHtml(line: Line): string {
    return (Array.isArray(line) ? line : [line]).map(spanHtml).join("");
}

/** Several lines as one message body, without the blank lines a terminal needs at the edges. */
export function linesHtml(lines: Line[]): string {
    const kept = [...lines];
    while (kept.length && !lineText(kept[0]!).trim()) kept.shift();
    while (kept.length && !lineText(kept[kept.length - 1]!).trim()) kept.pop();
    return kept.map(lineHtml).join("\n");
}

// ---------- markdown → Telegram HTML ----------

const SAFE_LINK = /^(https?:\/\/|tg:\/\/|mailto:)/i;

function inlineHtml(tokens: Token[] | undefined): string {
    return (tokens ?? []).map(inlineToken).join("");
}

function inlineToken(token: Token): string {
    switch (token.type) {
        case "strong":
            return `<b>${inlineHtml(token.tokens)}</b>`;
        case "em":
            return `<i>${inlineHtml(token.tokens)}</i>`;
        case "del":
            return `<s>${inlineHtml(token.tokens)}</s>`;
        case "codespan":
            return `<code>${escapeHtml(token.text)}</code>`;
        case "br":
            return "\n";
        case "link": {
            const label = inlineHtml(token.tokens) || escapeHtml(token.href);
            return SAFE_LINK.test(token.href) ? `<a href="${escapeAttribute(token.href)}">${label}</a>` : label;
        }
        case "image":
            return escapeHtml(token.text || token.href);
        case "text":
            return token.tokens ? inlineHtml(token.tokens) : escapeHtml(token.text);
        default:
            // Raw HTML and anything unknown is shown as written, never as markup.
            return escapeHtml("text" in token ? String(token.text) : token.raw);
    }
}

function listHtml(list: Tokens.List, depth: number): string {
    const first = typeof list.start === "number" ? list.start : 1;
    return list.items
        .map((item, index) => {
            const mark = item.task ? (item.checked ? "☑" : "☐") : list.ordered ? `${first + index}.` : "•";
            const body = item.tokens
                .map((token) => (token.type === "list" ? "\n" + listHtml(token as Tokens.List, depth + 1) : blockHtml(token)))
                .join("")
                .trim()
                // The box is drawn by `mark`; drop the "[x]" marked leaves in the text.
                .replace(item.task ? /^\[[ xX]\]\s*/ : /^$/, "");
            return `${"  ".repeat(depth)}${mark} ${body}`;
        })
        .join("\n");
}

function tableHtml(table: Tokens.Table): string {
    const row = (cells: Tokens.TableCell[]) => cells.map((cell) => stripHtml(inlineHtml(cell.tokens))).join(" | ");
    const lines = [row(table.header), ...table.rows.map(row)];
    return `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
}

function codeHtml(code: Tokens.Code): string {
    const lang = (code.lang ?? "").match(/^[\w+-]+/)?.[0];
    const body = escapeHtml(code.text);
    return lang ? `<pre><code class="language-${lang}">${body}</code></pre>` : `<pre>${body}</pre>`;
}

function blockHtml(token: Token): string {
    switch (token.type) {
        case "heading":
            return `<b>${inlineHtml(token.tokens)}</b>`;
        case "paragraph":
            return inlineHtml(token.tokens);
        case "code":
            return codeHtml(token as Tokens.Code);
        case "blockquote":
            return `<blockquote>${markdownBlocks(token.tokens ?? []).join("\n")}</blockquote>`;
        case "list":
            return listHtml(token as Tokens.List, 0);
        case "table":
            return tableHtml(token as Tokens.Table);
        case "hr":
            return "———";
        case "space":
            return "";
        default:
            return inlineToken(token);
    }
}

function markdownBlocks(tokens: Token[]): string[] {
    return tokens.map(blockHtml).filter((html) => html.trim());
}

/** Convert markdown to Telegram HTML, one string per block (paragraph, list, code block). */
export function markdownToHtml(markdown: string): string[] {
    try {
        return markdownBlocks(marked.lexer(markdown));
    } catch {
        return [escapeHtml(markdown)];
    }
}

// ---------- splitting ----------

/** Cut plain text into pieces, at line ends where possible. */
function splitPlain(text: string, max: number): string[] {
    const pieces: string[] = [];
    let rest = text;
    while (rest.length > max) {
        let cut = rest.lastIndexOf("\n", max);
        if (cut < max / 2) cut = max;
        pieces.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n/, "");
    }
    if (rest) pieces.push(rest);
    return pieces;
}

/** A block too long for one message: code stays code, anything else becomes plain text. */
function splitBlock(block: string, max: number): string[] {
    const isCode = block.startsWith("<pre>");
    const plain = stripHtml(block);
    // Escaping makes text longer; cut smaller pieces so they still fit afterwards.
    const growth = escapeHtml(plain).length / Math.max(1, plain.length);
    const pieceMax = Math.max(1, Math.floor((max - "<pre></pre>".length) / growth));
    return splitPlain(plain, pieceMax).map((piece) =>
        isCode ? `<pre>${escapeHtml(piece)}</pre>` : escapeHtml(piece),
    );
}

/** Pack blocks into as few messages as possible, never cutting through a tag. */
export function packBlocks(blocks: string[], max = MESSAGE_MAX_CHARS): string[] {
    const messages: string[] = [];
    let current = "";
    for (const block of blocks.flatMap((b) => (b.length > max ? splitBlock(b, max) : [b]))) {
        if (current && current.length + block.length + 2 > max) {
            messages.push(current);
            current = "";
        }
        current = current ? `${current}\n\n${block}` : block;
    }
    if (current) messages.push(current);
    return messages;
}
