/**
 * Search providers. To support another search engine, write an adapter, add
 * one entry here and select it with YUVI_SEARCH.
 */
import type { Settings } from "../config";
import { ConfigError } from "../errors";
import { DuckDuckGoSearch } from "./duckduckgo";
import { TavilySearch } from "./tavily";
import type { SearchProvider } from "./types";

/** Give up on one search or page fetch after this long. */
export const FETCH_TIMEOUT_MS = 10_000;

export type SearchProviderRegistry = Record<string, (settings: Settings) => SearchProvider>;

export const SEARCH_PROVIDERS: SearchProviderRegistry = {
    duckduckgo: () => new DuckDuckGoSearch(FETCH_TIMEOUT_MS),
    tavily: (settings) => {
        if (!settings.tavilyApiKey) {
            throw new ConfigError("The search provider is tavily but TAVILY_API_KEY is not set.");
        }
        return new TavilySearch(settings.tavilyApiKey, FETCH_TIMEOUT_MS);
    },
    // Use the sturdier engine when a key is there, the free one otherwise.
    auto: (settings) =>
        settings.tavilyApiKey
            ? new TavilySearch(settings.tavilyApiKey, FETCH_TIMEOUT_MS)
            : new DuckDuckGoSearch(FETCH_TIMEOUT_MS),
};

export function createSearchProvider(
    settings: Settings,
    registry: SearchProviderRegistry = SEARCH_PROVIDERS,
): SearchProvider {
    const build = registry[settings.searchProvider];
    if (!build) {
        throw new ConfigError(
            `Unknown search provider "${settings.searchProvider}". Available: ${Object.keys(registry).join(", ")}.`,
        );
    }
    return build(settings);
}
