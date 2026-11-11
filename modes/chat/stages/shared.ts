/**
 * Helpers every pipeline stage uses: the metered model client, tolerant JSON
 * reading, and a compact view of the conversation for the cheap steps.
 */
import type { ChatConfig } from "../config";
import { CallBudget, RateLimiter } from "../guardrails";
import type { HistoryStore, LLMClient, LLMRequest, LLMResponse } from "../interfaces";
import type { StepUsage } from "../types";

/** Thrown when too many model calls were made in the last minute. */
export class RateLimitError extends Error {
    constructor() {
        super("Chat rate limit reached: too many model calls in the last minute.");
        this.name = "RateLimitError";
    }
}

/**
 * The model client the stages see. It enforces the per-message budget and
 * the per-minute limit, and records tokens and cost for every step.
 */
export class MeteredLLM {
    readonly usage: StepUsage[] = [];

    constructor(
        private readonly llm: LLMClient,
        readonly budget: CallBudget,
        private readonly limiter: RateLimiter,
    ) {}

    private begin(): number {
        this.budget.startCall(); // throws BudgetError when the message is out of calls
        if (!this.limiter.tryTake()) throw new RateLimitError();
        return Date.now();
    }

    private record(step: string, model: string, response: LLMResponse, startedAt: number): void {
        this.budget.addTokens(response.inputTokens + response.outputTokens);
        this.usage.push({
            step,
            model,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            cost: response.cost,
            ms: Date.now() - startedAt,
        });
    }

    async complete(step: string, request: LLMRequest): Promise<LLMResponse> {
        const startedAt = this.begin();
        const response = await this.llm.complete(request);
        this.record(step, request.model, response, startedAt);
        return response;
    }

    async stream(
        step: string,
        request: LLMRequest,
        onToken: (token: string) => void,
    ): Promise<LLMResponse> {
        const startedAt = this.begin();
        const response = await this.llm.stream(request, onToken);
        this.record(step, request.model, response, startedAt);
        return response;
    }
}

/** What a stage needs besides its own input. */
export interface StageContext {
    llm: MeteredLLM;
    config: ChatConfig;
    signal?: AbortSignal;
}

/**
 * Run a small JSON step. Some models use their whole output allowance on
 * hidden thinking and return nothing; that is worth one more try, as long
 * as a call is still left over for the answer itself.
 */
export async function completeJsonStep(
    step: string,
    request: LLMRequest,
    ctx: StageContext,
): Promise<string> {
    const full: LLMRequest = {
        ...request,
        jsonMode: true,
        lowEffort: true,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
    };
    const first = await ctx.llm.complete(step, full);
    if (first.text.trim() || !ctx.llm.budget.hasRoomForOptional(1)) return first.text;
    return (await ctx.llm.complete(`${step} (retry)`, full)).text;
}

/**
 * Read a JSON object out of a model reply. Models often wrap JSON in a code
 * fence or add a sentence around it, so this takes the outermost {...}.
 */
export function extractJson(text: string): Record<string, unknown> | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
        const value: unknown = JSON.parse(text.slice(start, end + 1));
        return value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/** How much of the conversation the cheap steps see. */
const CONTEXT_TURNS = 4;
const CONTEXT_CHARS_PER_TURN = 300;

/** The last few turns as short text, for the router and planner prompts. */
export function compactContext(history: HistoryStore): string {
    const lines = history
        .turns()
        .slice(-CONTEXT_TURNS)
        .map((turn) => {
            const who = turn.role === "user" ? "User" : "Assistant";
            const text = turn.content.replace(/\s+/g, " ").trim();
            const cut = text.length > CONTEXT_CHARS_PER_TURN;
            return `${who}: ${text.slice(0, CONTEXT_CHARS_PER_TURN)}${cut ? "…" : ""}`;
        });
    const summary = history.summary();
    if (summary) lines.unshift(`Earlier: ${summary}`);
    return lines.join("\n");
}

/** A string field of a parsed reply, or "" when it is missing or not text. */
export function textField(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}
