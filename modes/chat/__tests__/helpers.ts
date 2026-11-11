/** Fakes shared by the chat tests: a scripted model and a canned search engine. */
import { loadChatConfig, type ChatConfig } from "../config";
import { createChatEngine } from "../factory";
import type { LLMClient, LLMRequest, LLMResponse, PageFetcher, SearchProvider } from "../interfaces";
import type { ChatDeps } from "../pipeline";
import type { Source } from "../types";

/** A model that replies with whatever the given function returns, and records every call. */
export class FakeLLM implements LLMClient {
    readonly calls: LLMRequest[] = [];

    constructor(private readonly reply: (request: LLMRequest, callNumber: number) => string) {}

    async complete(request: LLMRequest): Promise<LLMResponse> {
        this.calls.push(request);
        return { text: this.reply(request, this.calls.length), inputTokens: 100, outputTokens: 20, cost: 0 };
    }

    async stream(request: LLMRequest, onToken: (token: string) => void): Promise<LLMResponse> {
        const response = await this.complete(request);
        // Send the text in small pieces, like a real stream.
        for (const piece of response.text.match(/.{1,5}/gs) ?? []) onToken(piece);
        return response;
    }
}

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
        ...loadChatConfig(),
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
    return createChatEngine(testConfig(config), { llm, search, pages: noPages, ...deps });
}
