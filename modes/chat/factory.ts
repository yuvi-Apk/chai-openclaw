/**
 * The one place that turns config into concrete providers. To switch the
 * model provider or the search engine, add an adapter, register it here and
 * change one config value. The pipeline itself never changes.
 */
import { MemoryCache } from "./adapters/cache-memory";
import { MemoryHistory } from "./adapters/history-memory";
import { AiSdkLLMClient } from "./adapters/llm-ai-sdk";
import { SafePageFetcher } from "./adapters/page-fetcher";
import { DuckDuckGoSearch } from "./adapters/search-duckduckgo";
import { TavilySearch } from "./adapters/search-tavily";
import { loadChatConfig, type ChatConfig } from "./config";
import type { LLMClient, SearchProvider } from "./interfaces";
import { ChatEngine, type ChatDeps } from "./pipeline";

const LLM_PROVIDERS: Record<string, (config: ChatConfig) => LLMClient> = {
    openrouter: (config) => new AiSdkLLMClient(config.callTimeoutMs),
};

const SEARCH_PROVIDERS: Record<string, (config: ChatConfig) => SearchProvider> = {
    duckduckgo: (config) => new DuckDuckGoSearch(config.fetchTimeoutMs),
    tavily: (config) => {
        const key = process.env.TAVILY_API_KEY;
        if (!key) throw new Error("YUVI_CHAT_SEARCH is tavily but TAVILY_API_KEY is not set.");
        return new TavilySearch(key, config.fetchTimeoutMs);
    },
    // Use the sturdier engine when a key is there, the free one otherwise.
    auto: (config) =>
        process.env.TAVILY_API_KEY
            ? new TavilySearch(process.env.TAVILY_API_KEY, config.fetchTimeoutMs)
            : new DuckDuckGoSearch(config.fetchTimeoutMs),
};

function pick<T>(kind: string, name: string, registry: Record<string, (config: ChatConfig) => T>, config: ChatConfig): T {
    const build = registry[name.toLowerCase()];
    if (!build) {
        throw new Error(`Unknown ${kind} "${name}". Available: ${Object.keys(registry).join(", ")}.`);
    }
    return build(config);
}

/**
 * Build a ready chat engine. Tests and other front ends can pass their own
 * parts in `overrides` (for example a fake model or a database history).
 */
export function createChatEngine(
    config: ChatConfig = loadChatConfig(),
    overrides: Partial<ChatDeps> = {},
): ChatEngine {
    const deps: ChatDeps = {
        llm: overrides.llm ?? pick("model provider", config.llmProvider, LLM_PROVIDERS, config),
        search: overrides.search ?? pick("search provider", config.searchProvider, SEARCH_PROVIDERS, config),
        pages:
            overrides.pages ??
            new SafePageFetcher({
                timeoutMs: config.fetchTimeoutMs,
                maxBytes: config.maxPageBytes,
                maxChars: config.maxPageChars,
            }),
        searchCache: overrides.searchCache ?? new MemoryCache(),
        routeCache: overrides.routeCache ?? new MemoryCache(),
        history: overrides.history ?? new MemoryHistory(config.keepTurns),
    };
    return new ChatEngine(deps, config);
}
