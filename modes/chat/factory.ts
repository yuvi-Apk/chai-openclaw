/**
 * Builds a ready chat engine from the shared core. The model, the search
 * engine and the page reader come from the core; chat adds its own caches
 * and conversation history.
 */
import { MemoryCache } from "../../core/cache";
import type { Core } from "../../core/compose";
import { MemoryHistory } from "../../core/history";
import { loadChatConfig, type ChatConfig } from "./config";
import { ChatEngine, type ChatDeps } from "./pipeline";

/**
 * Tests and other hosts can pass their own parts in `overrides` (for
 * example a fake model or a database history).
 */
export function createChatEngine(
    core: Core,
    config: ChatConfig = loadChatConfig(core.settings),
    overrides: Partial<ChatDeps> = {},
): ChatEngine {
    const deps: ChatDeps = {
        llm: overrides.llm ?? core.llm,
        search: overrides.search ?? core.search,
        pages: overrides.pages ?? core.pages,
        searchCache: overrides.searchCache ?? new MemoryCache(),
        routeCache: overrides.routeCache ?? new MemoryCache(),
        history: overrides.history ?? new MemoryHistory(config.keepTurns),
    };
    return new ChatEngine(deps, config);
}
