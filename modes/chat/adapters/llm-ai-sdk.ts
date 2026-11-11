/**
 * LLMClient on top of the AI SDK and the OpenRouter setup agent mode already
 * uses. This is the only chat file that talks to a model provider.
 */
import { generateText, streamText, type ModelMessage } from "ai";
import { getModelById, getReasoningOverride } from "../../../ai";
import type { LLMClient, LLMRequest, LLMResponse } from "../interfaces";

/** The SDK retries failed calls with growing pauses; this is how many times. */
const MAX_RETRIES = 2;

interface UsageLike {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
}

function toResponse(text: string, usage: UsageLike | undefined, metadata: unknown): LLMResponse {
    const openrouter = (metadata as Record<string, Record<string, unknown>> | undefined)?.openrouter;
    const cost = (openrouter?.usage as { cost?: number } | undefined)?.cost;
    return {
        text,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cost: typeof cost === "number" ? cost : 0,
    };
}

export class AiSdkLLMClient implements LLMClient {
    constructor(private readonly timeoutMs: number) {}

    // jsonMode is not forwarded: many OpenRouter models reject a forced JSON
    // response format. The prompts ask for JSON and the parsers are tolerant.
    private callOptions(request: LLMRequest) {
        const timeout = AbortSignal.timeout(this.timeoutMs);
        // YUVI_REASONING=off is for models that reject a reasoning option.
        const lowEffort = request.lowEffort && getReasoningOverride() !== "off";
        return {
            ...(lowEffort ? { reasoning: "low" as const } : {}),
            model: getModelById(request.model),
            ...(request.system ? { instructions: request.system } : {}),
            messages: request.messages as ModelMessage[],
            maxOutputTokens: request.maxTokens,
            maxRetries: MAX_RETRIES,
            abortSignal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
        };
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        const result = await generateText(this.callOptions(request));
        return toResponse(result.text, result.usage, result.providerMetadata);
    }

    async stream(request: LLMRequest, onToken: (token: string) => void): Promise<LLMResponse> {
        // The SDK prints stream errors with a stack trace. The front end shows
        // the error once in plain words, so that output is silenced here.
        const consoleError = console.error;
        console.error = () => undefined;
        try {
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
            return toResponse(text, await result.usage, await result.providerMetadata);
        } finally {
            console.error = consoleError;
        }
    }
}
