/**
 * The composition root: turns settings into the concrete services every mode
 * shares. Switching a provider means changing a setting and adding one
 * adapter to a registry; nothing that uses a Core changes.
 */
import { Settings } from "./config";
import { createLogger, type Logger } from "./log";
import { AiSdkLLMClient } from "./llm/ai-sdk-client";
import { LLM_PROVIDERS, Models, type LLMProviderRegistry } from "./llm/providers";
import type { LLMClient } from "./llm/types";
import { SafePageFetcher } from "./search/page-fetcher";
import { createSearchProvider, FETCH_TIMEOUT_MS, SEARCH_PROVIDERS, type SearchProviderRegistry } from "./search/providers";
import type { PageFetcher, SearchProvider } from "./search/types";

/** Stop downloading a page after this many bytes. */
const MAX_PAGE_BYTES = 600_000;
/** Longest text kept from one fetched page. */
export const MAX_PAGE_CHARS = 4000;

export interface Core {
    readonly settings: Settings;
    readonly log: Logger;
    /** Models for code that needs the AI SDK directly (the agent's tool loop). */
    readonly models: Models;
    readonly llm: LLMClient;
    readonly search: SearchProvider;
    readonly pages: PageFetcher;
}

export interface CoreOptions {
    log?: Logger;
    /** Ready-made parts, used instead of building them (tests, other hosts). */
    llm?: LLMClient;
    search?: SearchProvider;
    pages?: PageFetcher;
    llmProviders?: LLMProviderRegistry;
    searchProviders?: SearchProviderRegistry;
}

/**
 * Build the shared services. Each one is created on first use, so a search
 * provider that is set up wrongly does not stop a mode that never searches.
 */
export function createCore(settings: Settings = new Settings(), options: CoreOptions = {}): Core {
    const log = options.log ?? createLogger(settings);
    const once = <T>(build: () => T) => {
        let value: T | undefined;
        return () => (value ??= build());
    };

    const models = once(() => new Models(settings, options.llmProviders ?? LLM_PROVIDERS));
    const llm = once(() => options.llm ?? new AiSdkLLMClient(models(), settings, log));
    const search = once(
        () => options.search ?? createSearchProvider(settings, options.searchProviders ?? SEARCH_PROVIDERS),
    );
    const pages = once(
        () =>
            options.pages ??
            new SafePageFetcher({ timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES, maxChars: MAX_PAGE_CHARS }),
    );

    return {
        settings,
        log,
        get models() {
            return models();
        },
        get llm() {
            return llm();
        },
        get search() {
            return search();
        },
        get pages() {
            return pages();
        },
    };
}
