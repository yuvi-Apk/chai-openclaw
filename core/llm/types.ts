/**
 * The model interface the rest of the app depends on. A provider is added by
 * writing one adapter for it; callers never see which provider is in use.
 */

export interface ChatTurn {
    role: "user" | "assistant";
    content: string;
}

export interface LLMRequest {
    model: string;
    system?: string;
    messages: ChatTurn[];
    /** Cap on the reply length. Leave out to use the model's own limit. */
    maxTokens?: number;
    /** The caller expects a JSON object back. Adapters may enforce it if they can. */
    jsonMode?: boolean;
    /** A quick internal step: ask the model to think as little as it can. */
    lowEffort?: boolean;
    /** Give up after this long instead of the client's default. */
    timeoutMs?: number;
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
