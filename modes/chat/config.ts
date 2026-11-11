/**
 * Every limit, default and model choice of chat mode, in one place.
 * Each value can be overridden with an environment variable.
 */
import { getModelId } from "../../ai";

export interface ChatConfig {
    /** Cheap model for routing, planning, sufficiency checks and summaries. */
    routerModel: () => string;
    /** Stronger model for the final answer. */
    answerModel: () => string;
    /** Which LLM adapter the factory builds. */
    llmProvider: string;
    /** Which search adapter the factory builds: "auto", "duckduckgo" or "tavily". */
    searchProvider: string;

    /** Most searches one question is split into. */
    maxSubQueries: number;
    /** Results kept per search. */
    resultsPerQuery: number;
    /** Most tokens of search evidence sent to the answer model. */
    contextTokenBudget: number;
    /** Longest excerpt kept from one search result. */
    maxSnippetChars: number;
    /** Longest text kept from one fully fetched page. */
    maxPageChars: number;
    /** Most pages opened in full for one question. */
    maxPagesToRead: number;
    /** Extra search rounds after the first one. */
    maxFollowUpRounds: number;

    /** Hard cap on model calls for one message. */
    maxCallsPerMessage: number;
    /** Once a message has used this many tokens, optional steps are skipped. */
    maxTokensPerMessage: number;
    /** Hard cap on searches for one message. */
    maxSearchesPerMessage: number;
    maxSearchesPerMinute: number;
    maxModelCallsPerMinute: number;
    /** Longer messages are cut to this length. */
    maxInputChars: number;

    /** Past turns kept word for word; older ones are folded into a summary. */
    keepTurns: number;
    /** Cache lifetime for news-like searches. */
    newsCacheTtlMs: number;
    /** Cache lifetime for searches on stable topics. */
    stableCacheTtlMs: number;
    routerCacheTtlMs: number;

    /** Output token caps per step. */
    maxOutputTokens: {
        router: number;
        planner: number;
        sufficiency: number;
        answer: number;
        summary: number;
    };

    /** Give up on one model call after this long. */
    callTimeoutMs: number;
    /** Give up on one search or page fetch after this long. */
    fetchTimeoutMs: number;
    /** Stop downloading a page after this many bytes. */
    maxPageBytes: number;
    /** Show routing and token usage after every answer. */
    debug: boolean;
}

/** A whole number from the environment, kept inside [min, max]. */
function envNumber(name: string, fallback: number, min: number, max: number): number {
    const value = Number(process.env[name]);
    if (!Number.isFinite(value) || process.env[name] === undefined || process.env[name] === "") {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(value)));
}

const MINUTE = 60_000;

export function loadChatConfig(): ChatConfig {
    return {
        // Read on every call, so a model changed mid-session takes effect at once.
        routerModel: () => process.env.YUVI_CHAT_ROUTER_MODEL || getModelId("fast"),
        answerModel: () => process.env.YUVI_CHAT_MODEL || getModelId("main"),
        llmProvider: process.env.YUVI_CHAT_LLM || "openrouter",
        searchProvider: process.env.YUVI_CHAT_SEARCH || "auto",

        maxSubQueries: envNumber("YUVI_CHAT_MAX_QUERIES", 3, 1, 5),
        resultsPerQuery: envNumber("YUVI_CHAT_RESULTS", 4, 1, 10),
        contextTokenBudget: envNumber("YUVI_CHAT_CONTEXT_TOKENS", 2500, 500, 20_000),
        maxSnippetChars: 500,
        maxPageChars: 4000,
        maxPagesToRead: 2,
        maxFollowUpRounds: envNumber("YUVI_CHAT_FOLLOWUPS", 1, 0, 1),

        // router + planner + sufficiency + answer, plus one retry when a direct
        // answer asks for a search, plus one spare.
        maxCallsPerMessage: envNumber("YUVI_CHAT_MAX_CALLS", 6, 2, 12),
        maxTokensPerMessage: envNumber("YUVI_CHAT_MAX_TOKENS", 30_000, 2000, 400_000),
        maxSearchesPerMessage: 6,
        maxSearchesPerMinute: 20,
        maxModelCallsPerMinute: 30,
        maxInputChars: 8000,

        keepTurns: envNumber("YUVI_CHAT_KEEP_TURNS", 4, 1, 20),
        newsCacheTtlMs: envNumber("YUVI_CHAT_NEWS_TTL_MIN", 10, 0, 1440) * MINUTE,
        stableCacheTtlMs: envNumber("YUVI_CHAT_STABLE_TTL_MIN", 360, 0, 10_080) * MINUTE,
        routerCacheTtlMs: 60 * MINUTE,

        maxOutputTokens: {
            // The JSON replies are under 100 tokens, but reasoning models count
            // their hidden thinking against the cap (around 300 tokens in
            // tests) and return nothing if it runs out. A cap is a ceiling,
            // not a cost: only tokens actually produced are paid for.
            router: 500,
            planner: 800,
            sufficiency: 600,
            answer: envNumber("YUVI_CHAT_ANSWER_TOKENS", 3000, 200, 16_000),
            summary: 600,
        },

        callTimeoutMs: 90_000,
        fetchTimeoutMs: 10_000,
        maxPageBytes: 600_000,
        debug: /^(1|true|on)$/i.test(process.env.YUVI_CHAT_DEBUG || ""),
    };
}
