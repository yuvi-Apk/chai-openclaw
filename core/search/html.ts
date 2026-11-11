/** Small HTML helpers shared by the search and page adapters. */

const ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function decodeEntities(text: string): string {
    return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
        if (code[0] === "#") {
            const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
        }
        return ENTITIES[code.toLowerCase()] ?? whole;
    });
}

/**
 * For short inline HTML (a title, an excerpt): tags removed, entities decoded.
 * Tags leave no space behind, so "<b>docs</b>." stays "docs.".
 */
export function stripTags(html: string): string {
    return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** The readable text of a whole page: scripts, styles and page furniture removed. */
export function htmlToText(html: string): string {
    const body = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>|<br\s*\/?>/gi, "\n");
    return decodeEntities(body.replace(/<[^>]*>/g, " "))
        .replace(/[ \t\r\f\v]+/g, " ")
        .replace(/\s*\n\s*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
