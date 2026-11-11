/**
 * Stage 4: run the searches in parallel and squeeze the results down to a
 * small, de-duplicated list that fits the evidence token budget.
 */
import type { Cache } from "../../../core/cache";
import type { SearchProvider, Source } from "../../../core/search/types";
import { RateLimiter } from "../../../core/security/limits";
import type { ChatConfig } from "../config";
import { looksTimeSensitive } from "./router";

export interface Evidence {
    sources: Source[];
    /** Queries answered from the cache. */
    cacheHits: number;
    /** Queries that failed or were refused by the rate limit. */
    failures: number;
}

export interface SearchDeps {
    search: SearchProvider;
    cache: Cache<Source[]>;
    limiter: RateLimiter;
}

const normaliseQuery = (query: string) => query.toLowerCase().replace(/\s+/g, " ").trim();

/** The same page often appears as http/https, with www, a slash or tracking tags. */
export function normaliseUrl(rawUrl: string): string {
    try {
        const url = new URL(rawUrl);
        url.hash = "";
        for (const key of [...url.searchParams.keys()]) {
            if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(key)) url.searchParams.delete(key);
        }
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        const path = url.pathname.replace(/\/+$/, "");
        const query = url.searchParams.toString();
        return `${host}${path}${query ? `?${query}` : ""}`;
    } catch {
        return rawUrl.trim().toLowerCase();
    }
}

/** How many leading letters must match for two excerpts to count as the same text. */
const SNIPPET_KEY_CHARS = 100;

const snippetKey = (snippet: string) =>
    snippet.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, SNIPPET_KEY_CHARS);

/**
 * Where dates are known, show newer results first. Results without a date
 * keep their place, so the search engine's own ranking is still respected.
 */
function preferRecent(results: Source[]): Source[] {
    const dated = results.filter((r) => r.date).sort((a, b) => (a.date! < b.date! ? 1 : -1));
    let next = 0;
    return results.map((r) => (r.date ? dated[next++]! : r));
}

/**
 * Merge the result lists of several queries. Takes one result from each list
 * in turn, so every sub-question is represented before the budget runs out.
 */
export function mergeResults(lists: Source[][], config: ChatConfig, existing: Source[] = []): Source[] {
    const seenUrls = new Set(existing.map((s) => normaliseUrl(s.url)));
    const seenSnippets = new Set(existing.map((s) => snippetKey(s.snippet)).filter(Boolean));
    let budgetChars =
        config.contextTokenBudget * 4 -
        existing.reduce((sum, s) => sum + s.title.length + s.snippet.length, 0);

    const ordered = lists.map(preferRecent);
    const merged: Source[] = [];
    const longest = Math.max(0, ...ordered.map((list) => list.length));

    for (let rank = 0; rank < longest; rank++) {
        for (const list of ordered) {
            const item = list[rank];
            if (!item) continue;
            const urlKey = normaliseUrl(item.url);
            const textKey = snippetKey(item.snippet);
            if (seenUrls.has(urlKey) || (textKey && seenSnippets.has(textKey))) continue;

            const cut = item.snippet.length > config.maxSnippetChars;
            const snippet = item.snippet.slice(0, config.maxSnippetChars) + (cut ? "…" : "");
            const size = item.title.length + snippet.length;
            if (size > budgetChars) return merged;

            budgetChars -= size;
            seenUrls.add(urlKey);
            if (textKey) seenSnippets.add(textKey);
            merged.push({ ...item, snippet });
        }
    }
    return merged;
}

/** Run every query (cache first), then merge. Sources already held are not repeated. */
export async function gatherEvidence(
    queries: string[],
    deps: SearchDeps,
    config: ChatConfig,
    signal?: AbortSignal,
    existing: Source[] = [],
): Promise<Evidence> {
    let cacheHits = 0;

    const settled = await Promise.allSettled(
        queries.map(async (query) => {
            const key = `${deps.search.name}:${normaliseQuery(query)}`;
            const cached = deps.cache.get(key);
            if (cached) {
                cacheHits++;
                return cached;
            }
            if (!deps.limiter.tryTake()) throw new Error("search rate limit reached");
            const found = await deps.search.search(query, config.resultsPerQuery, signal);
            const results = found.slice(0, config.resultsPerQuery);
            if (results.length) {
                // News goes stale in minutes; reference material stays good for hours.
                const ttl = looksTimeSensitive(query) ? config.newsCacheTtlMs : config.stableCacheTtlMs;
                deps.cache.set(key, results, ttl);
            }
            return results;
        }),
    );
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");

    const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
    return {
        sources: mergeResults(lists, config, existing),
        cacheHits,
        failures: settled.filter((s) => s.status === "rejected").length,
    };
}
