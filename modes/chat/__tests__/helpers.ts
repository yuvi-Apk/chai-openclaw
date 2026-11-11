/** Fakes shared by the chat tests: a scripted model and a canned search engine. */
import { createCore } from "../../../core/compose";
import type { LLMClient } from "../../../core/llm/types";
import { FakeLLM, testSettings } from "../../../core/testing";
import type { PageFetcher, SearchProvider, Source } from "../../../core/search/types";
import { loadChatConfig, type ChatConfig } from "../config";
import { createChatEngine } from "../factory";
import type { ChatDeps } from "../pipeline";

export { FakeLLM, testSettings };

export class FakeSearch implements SearchProvider {
    readonly name = "fake";
    readonly queries: string[] = [];

    constructor(private readonly results: (query: string) => Source[]) {}

    async search(query: string, limit: number): Promise<Source[]> {
        this.queries.push(query);
        return this.results(query).slice(0, limit);
    }
}

export const noPages: PageFetcher = {
    fetchText: async () => {
        throw new Error("pages are not available in tests");
    },
};

export const source = (n: number, snippet = `Fact number ${n} about the topic.`): Source => ({
    title: `Page ${n}`,
    url: `https://example.com/page-${n}`,
    snippet,
});

export function testConfig(overrides: Partial<ChatConfig> = {}): ChatConfig {
    return {
        ...loadChatConfig(testSettings()),
        routerModel: () => "cheap-model",
        answerModel: () => "strong-model",
        ...overrides,
    };
}

export function testEngine(
    llm: LLMClient,
    search: SearchProvider,
    config: Partial<ChatConfig> = {},
    deps: Partial<ChatDeps> = {},
) {
    return createChatEngine(createCore(testSettings()), testConfig(config), { llm, search, pages: noPages, ...deps });
}
