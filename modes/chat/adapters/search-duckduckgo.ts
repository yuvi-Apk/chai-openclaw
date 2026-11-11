/**
 * SearchProvider that reads DuckDuckGo's plain HTML results page.
 * Needs no API key, which makes it the default. It depends on the page
 * layout, so it can break or be rate limited; Tavily is the sturdier choice.
 */
import type { SearchProvider } from "../interfaces";
import type { Source } from "../types";
import { stripTags } from "./html";

const ENDPOINT = "https://html.duckduckgo.com/html/";
const USER_AGENT = "Mozilla/5.0 (compatible; terminal-chat-search/1.0)";

/** Result links go through a redirect that carries the real URL in `uddg`. */
function realUrl(href: string): string | null {
    const absolute = href.startsWith("//") ? `https:${href}` : href;
    try {
        const url = new URL(absolute, ENDPOINT);
        if (url.pathname.endsWith("/y.js")) return null; // an ad
        const target = url.searchParams.get("uddg");
        const final = target ?? url.toString();
        return /^https?:\/\//i.test(final) ? final : null;
    } catch {
        return null;
    }
}

/** Pull title, link and excerpt out of the results page. Exported for tests. */
export function parseDuckDuckGoHtml(html: string, limit: number): Source[] {
    const results: Source[] = [];
    // Each result starts at its title link; the excerpt follows in the same chunk.
    for (const chunk of html.split('class="result__a"').slice(1)) {
        const href = /href="([^"]+)"/.exec(chunk)?.[1];
        const title = />([\s\S]*?)<\/a>/.exec(chunk)?.[1];
        if (!href || !title) continue;
        const url = realUrl(href.replace(/&amp;/g, "&"));
        if (!url) continue;
        const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)?.[1] ?? "";
        results.push({ title: stripTags(title), url, snippet: stripTags(snippet) });
        if (results.length >= limit) break;
    }
    return results;
}

export class DuckDuckGoSearch implements SearchProvider {
    readonly name = "duckduckgo";

    constructor(private readonly timeoutMs: number) {}

    async search(query: string, limit: number, signal?: AbortSignal): Promise<Source[]> {
        const timeout = AbortSignal.timeout(this.timeoutMs);
        const response = await fetch(`${ENDPOINT}?q=${encodeURIComponent(query)}`, {
            headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) throw new Error(`Search failed (HTTP ${response.status})`);
        return parseDuckDuckGoHtml(await response.text(), limit);
    }
}
