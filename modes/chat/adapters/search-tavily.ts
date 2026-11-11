/**
 * SearchProvider for the Tavily search API. Used when TAVILY_API_KEY is set.
 * More reliable than scraping, and it returns publication dates for news.
 */
import type { SearchProvider } from "../interfaces";
import type { Source } from "../types";

const ENDPOINT = "https://api.tavily.com/search";

interface TavilyResult {
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
}

export class TavilySearch implements SearchProvider {
    readonly name = "tavily";

    constructor(
        private readonly apiKey: string,
        private readonly timeoutMs: number,
    ) {}

    async search(query: string, limit: number, signal?: AbortSignal): Promise<Source[]> {
        const timeout = AbortSignal.timeout(this.timeoutMs);
        const response = await fetch(ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ query, max_results: limit, search_depth: "basic" }),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        // The status is enough to explain a failure; the body could echo the key.
        if (!response.ok) throw new Error(`Search failed (HTTP ${response.status})`);
        const data = (await response.json()) as { results?: TavilyResult[] };
        const results: Source[] = [];
        for (const item of data.results ?? []) {
            if (!item.url || !/^https?:\/\//i.test(item.url)) continue;
            const date = item.published_date ? new Date(item.published_date) : null;
            results.push({
                title: item.title?.trim() || item.url,
                url: item.url,
                snippet: (item.content ?? "").replace(/\s+/g, " ").trim(),
                ...(date && !Number.isNaN(date.getTime()) ? { date: date.toISOString().slice(0, 10) } : {}),
            });
        }
        return results.slice(0, limit);
    }
}
