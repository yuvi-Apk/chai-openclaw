/**
 * LLMClient on top of the AI SDK. Which provider the models come from is
 * decided by the Models object it is given.
 */
import { generateText, streamText, type ModelMessage } from "ai";
import type { Settings } from "../config";
import type { Logger } from "../log";
import { readCost } from "../usage";
import type { Models } from "./providers";
import { withQuietSdkErrors } from "./quiet-sdk";
import type { LLMClient, LLMRequest, LLMResponse } from "./types";

/** The SDK retries failed calls with growing pauses; this is how many times. */
const MAX_RETRIES = 2;
/** Give up on one model call after this long, unless the request says otherwise. */
export const DEFAULT_CALL_TIMEOUT_MS = 90_000;

interface UsageLike {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
}

function toResponse(text: string, usage: UsageLike | undefined, metadata: unknown): LLMResponse {
    return {
        text,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cost: readCost(metadata),
    };
}

export class AiSdkLLMClient implements LLMClient {
    constructor(
        private readonly models: Models,
        private readonly settings: Settings,
        private readonly log: Logger,
        private readonly timeoutMs = DEFAULT_CALL_TIMEOUT_MS,
    ) {}

    // jsonMode is not forwarded: many OpenRouter models reject a forced JSON
    // response format. The prompts ask for JSON and the parsers are tolerant.
    private callOptions(request: LLMRequest) {
        const timeout = AbortSignal.timeout(request.timeoutMs ?? this.timeoutMs);
        // YUVI_REASONING=off is for models that reject a reasoning option.
        const lowEffort = request.lowEffort && this.settings.reasoning !== "off";
        return {
            ...(lowEffort ? { reasoning: "low" as const } : {}),
            model: this.models.byId(request.model),
            ...(request.system ? { instructions: request.system } : {}),
            messages: request.messages as ModelMessage[],
            ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
            maxRetries: MAX_RETRIES,
            abortSignal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
        };
    }

    private logged(request: LLMRequest, startedAt: number, response: LLMResponse): LLMResponse {
        this.log.event("llm.call", {
            model: request.model,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            cost: response.cost,
            ms: Date.now() - startedAt,
        });
        return response;
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        const startedAt = Date.now();
        const result = await generateText(this.callOptions(request));
        return this.logged(request, startedAt, toResponse(result.text, result.usage, result.providerMetadata));
    }

    async stream(request: LLMRequest, onToken: (token: string) => void): Promise<LLMResponse> {
        const startedAt = Date.now();
        return withQuietSdkErrors(async () => {
            const result = await streamText(this.callOptions(request));
            let text = "";
            for await (const raw of result.stream) {
                const part = raw as { type: string; text?: string; error?: unknown };
                if (part.type === "text-delta" && part.text) {
                    text += part.text;
                    onToken(part.text);
                }
                if (part.type === "error") {
                    throw part.error instanceof Error ? part.error : new Error(String(part.error));
                }
            }
            const response = toResponse(text, await result.usage, await result.providerMetadata);
            return this.logged(request, startedAt, response);
        });
    }
}
