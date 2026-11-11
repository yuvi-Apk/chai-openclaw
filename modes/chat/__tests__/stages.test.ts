import { describe, expect, test } from "bun:test";
import { MemoryCache } from "../adapters/cache-memory";
import { MemoryHistory } from "../adapters/history-memory";
import { parseDuckDuckGoHtml } from "../adapters/search-duckduckgo";
import { parsePlan } from "../stages/planner";
import { parseRouterReply, routeByRules } from "../stages/router";
import { mergeResults, normaliseUrl } from "../stages/searcher";
import { extractJson } from "../stages/shared";
import { parseSufficiency } from "../stages/sufficiency";
import { citedSources } from "../stages/synthesizer";
import { source, testConfig } from "./helpers";

describe("router rules", () => {
    test("stable requests are answered directly", () => {
        for (const q of ["explain recursion", "How does a hash map work?", "write a haiku about tea", "hello", "12 * (3 + 4)"]) {
            expect(routeByRules(q)?.needsSearch).toBe(false);
        }
    });

    test("recent or changing topics are searched", () => {
        const thisYear = new Date().getFullYear();
        for (const q of [
            "what is the latest version of Next.js?",
            "bitcoin price of today",
            `best phones ${thisYear}`,
            "who won the match yesterday",
            "explain quantum computing with sources",
        ]) {
            expect(routeByRules(q)?.needsSearch).toBe(true);
        }
    });

    test("unclear questions are left to the model", () => {
        expect(routeByRules("who is the CEO of Acme Corp")).toBeNull();
        expect(routeByRules("what about the second one?")).toBeNull();
    });

    test("an old year alone does not trigger a search", () => {
        expect(routeByRules("explain the causes of the 2008 financial crisis")?.needsSearch).toBe(false);
    });
});

describe("router reply parsing", () => {
    test("reads plain and fenced JSON", () => {
        expect(parseRouterReply('{"needs_search":true,"reason":"news","complexity":"complex"}')).toMatchObject({
            needsSearch: true,
            complexity: "complex",
            via: "model",
        });
        expect(parseRouterReply('```json\n{"needs_search": false, "reason": "stable"}\n```')).toMatchObject({
            needsSearch: false,
            complexity: "moderate",
        });
    });

    test("rejects replies it cannot trust", () => {
        expect(parseRouterReply("I think you should search.")).toBeNull();
        expect(parseRouterReply('{"needs_search":"yes"}')).toBeNull();
        expect(parseRouterReply('{"needs_search": tru')).toBeNull();
    });
});

describe("planner reply parsing", () => {
    test("keeps intent, assumption and at most the allowed queries", () => {
        const plan = parsePlan(
            'Here you go: {"intent":"Compare A and B","clarify":null,"assumption":"B means B v2","queries":["a specs","b specs","a vs b","extra","A SPECS"]}',
            "a or b?",
            3,
        );
        expect(plan.intent).toBe("Compare A and B");
        expect(plan.assumption).toBe("B means B v2");
        expect(plan.clarify).toBeUndefined();
        expect(plan.queries).toEqual(["a specs", "b specs", "a vs b"]);
    });

    test("passes a clarifying question through", () => {
        const plan = parsePlan('{"intent":"x","clarify":"Which Mercury: planet or element?","queries":[]}', "mercury facts", 3);
        expect(plan.clarify).toBe("Which Mercury: planet or element?");
    });

    test("falls back to the question when the reply is not JSON", () => {
        expect(parsePlan("sorry, no idea", "weather in Paris", 3)).toEqual({
            intent: "weather in Paris",
            queries: ["weather in Paris"],
        });
    });

    test("ignores queries that are not text", () => {
        const plan = parsePlan('{"intent":"q","queries":[1,null,{"a":1},"real query"]}', "q", 3);
        expect(plan.queries).toEqual(["real query"]);
    });
});

describe("sufficiency reply parsing", () => {
    test("an unreadable reply counts as enough", () => {
        expect(parseSufficiency("???", 4, 3, 2).sufficient).toBe(true);
    });

    test("keeps only valid source numbers and caps queries", () => {
        const verdict = parseSufficiency(
            '{"sufficient":false,"missing":"release date","queries":["a","b","c","d"],"read":[2,9,0,2,3,4]}',
            4,
            3,
            2,
        );
        expect(verdict).toEqual({ sufficient: false, missing: "release date", queries: ["a", "b", "c"], read: [2, 3] });
    });
});

describe("JSON extraction", () => {
    test("only objects are accepted", () => {
        expect(extractJson("[1,2]")).toBeNull();
        expect(extractJson('text {"a":1} more')).toEqual({ a: 1 });
    });
});

describe("search result merging", () => {
    const config = testConfig();

    test("removes the same page reached by different URLs", () => {
        const lists = [
            [{ title: "A", url: "https://www.example.com/a/?utm_source=x#top", snippet: "first text" }],
            [{ title: "A again", url: "http://example.com/a", snippet: "other text" }],
        ];
        expect(mergeResults(lists, config)).toHaveLength(1);
        expect(normaliseUrl("https://www.example.com/a/?utm_source=x#top")).toBe("example.com/a");
    });

    test("removes near-identical excerpts on different sites", () => {
        const text = "The same press release text copied word for word onto several different news websites today.";
        const lists = [[
            { title: "Site 1", url: "https://one.example/x", snippet: text },
            { title: "Site 2", url: "https://two.example/y", snippet: `${text.toUpperCase()}  ` },
        ]];
        expect(mergeResults(lists, config)).toHaveLength(1);
    });

    test("takes results from every query in turn", () => {
        const merged = mergeResults([[source(1), source(2)], [source(3), source(4)]], config);
        expect(merged.map((s) => s.title)).toEqual(["Page 1", "Page 3", "Page 2", "Page 4"]);
    });

    test("stops at the evidence budget and trims long excerpts", () => {
        const long = "x".repeat(5000);
        const tight = testConfig({ contextTokenBudget: 500, maxSnippetChars: 400 });
        // Different text per source, so they are not removed as duplicates.
        const lists = [Array.from({ length: 10 }, (_, i) => source(i, `${i} ${long}`))];
        const merged = mergeResults(lists, tight);
        const total = merged.reduce((sum, s) => sum + s.title.length + s.snippet.length, 0);
        expect(merged.length).toBeGreaterThan(0);
        expect(merged.length).toBeLessThan(10);
        expect(total).toBeLessThanOrEqual(500 * 4);
        expect(merged[0]!.snippet.length).toBeLessThanOrEqual(401);
    });

    test("newer dated results come first", () => {
        const lists = [[
            { ...source(1), date: "2020-01-01" },
            { ...source(2), date: "2025-06-01" },
        ]];
        expect(mergeResults(lists, config)[0]!.title).toBe("Page 2");
    });
});

describe("citations", () => {
    test("lists only the sources the answer cites, with their numbers", () => {
        const cited = citedSources("Fact [2]. Another [3][2]. Bad number [9].", [source(1), source(2), source(3)]);
        expect(cited.map((s) => s.n)).toEqual([2, 3]);
    });

    test("lists every source when the answer cites none", () => {
        expect(citedSources("No markers here.", [source(1), source(2)])).toHaveLength(2);
    });
});

describe("memory cache", () => {
    test("returns a value until its lifetime ends", () => {
        let now = 1000;
        const cache = new MemoryCache<string>(10, () => now);
        cache.set("k", "v", 500);
        expect(cache.get("k")).toBe("v");
        now = 1499;
        expect(cache.get("k")).toBe("v");
        now = 1500;
        expect(cache.get("k")).toBeUndefined();
    });

    test("a zero lifetime stores nothing", () => {
        const cache = new MemoryCache<string>();
        cache.set("k", "v", 0);
        expect(cache.get("k")).toBeUndefined();
    });

    test("drops the oldest entry when full", () => {
        const cache = new MemoryCache<number>(2);
        cache.set("a", 1, 1000);
        cache.set("b", 2, 1000);
        cache.set("c", 3, 1000);
        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe(2);
        expect(cache.get("c")).toBe(3);
    });
});

describe("history", () => {
    test("keeps the recent turns and hands back the rest", () => {
        const history = new MemoryHistory(1);
        for (const n of [1, 2, 3]) {
            history.append({ role: "user", content: `q${n}` });
            history.append({ role: "assistant", content: `a${n}` });
        }
        expect(history.takeOverflow().map((t) => t.content)).toEqual(["q1", "a1", "q2", "a2"]);
        expect(history.turns().map((t) => t.content)).toEqual(["q3", "a3"]);
        expect(history.takeOverflow()).toEqual([]);
    });
});

describe("DuckDuckGo page parsing", () => {
    test("reads title, real link and excerpt, and skips ads", () => {
        const html = `
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc">Example <b>Docs</b></a>
            <a class="result__snippet" href="x">The &amp; official <b>docs</b>.</a>
            <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">An ad</a>
            <a class="result__snippet" href="x">Buy now</a>`;
        expect(parseDuckDuckGoHtml(html, 5)).toEqual([
            { title: "Example Docs", url: "https://example.com/docs", snippet: "The & official docs." },
        ]);
    });
});
