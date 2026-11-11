/**
 * The small interfaces the chat pipeline depends on. Every outside service
 * (model, search engine, web pages, cache, history) sits behind one of these,
 * so it can be swapped by writing one adapter and changing one config value.
 */
import type { ChatTurn, Source } from "./types";

export interface LLMRequest {
    model: string;
    system?: string;
    messages: ChatTurn[];
    maxTokens: number;
    /** The caller expects a JSON object back. Adapters may enforce it if they can. */
    jsonMode?: boolean;
    /** A quick internal step: ask the model to think as little as it can. */
    lowEffort?: boolean;
    signal?: AbortSignal;
}

export interface LLMResponse {
    text: string;
    inputTokens: number;
    outputTokens: number;
    /** Cost in dollars when the provider reports it, otherwise 0. */
    cost: number;
}

export interface LLMClient {
    complete(request: LLMRequest): Promise<LLMResponse>;
    /** Like complete, but hands over each piece of text as it arrives. */
    stream(request: LLMRequest, onToken: (token: string) => void): Promise<LLMResponse>;
}

export interface SearchProvider {
    readonly name: string;
    search(query: string, limit: number, signal?: AbortSignal): Promise<Source[]>;
}

export interface PageFetcher {
    /** The readable text of a web page, already cut to a safe length. */
    fetchText(url: string, signal?: AbortSignal): Promise<string>;
}

export interface Cache<T> {
    get(key: string): T | undefined;
    set(key: string, value: T, ttlMs: number): void;
}

export interface HistoryStore {
    /** The recent turns, oldest first. */
    turns(): ChatTurn[];
    /** A short summary of everything older than the recent turns. */
    summary(): string;
    setSummary(summary: string): void;
    append(turn: ChatTurn): void;
    /** Remove and return the turns that no longer fit in the recent window. */
    takeOverflow(): ChatTurn[];
    clear(): void;
}
