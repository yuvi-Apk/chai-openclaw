/**
 * Token and cost tracking, the same for every mode: one record per model
 * call, and totals worked out from the records.
 */

/** Tokens and cost of one model call, so spending can be tuned per step. */
export interface UsageRecord {
    /** What the call was for, e.g. "router", "answer", "triage". */
    step: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** Dollars, when the provider reports it; otherwise 0. */
    cost: number;
    ms: number;
}

export interface UsageTotals {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
}

export function totalUsage(records: UsageRecord[]): UsageTotals {
    return records.reduce<UsageTotals>(
        (sum, record) => ({
            calls: sum.calls + 1,
            inputTokens: sum.inputTokens + record.inputTokens,
            outputTokens: sum.outputTokens + record.outputTokens,
            cost: sum.cost + record.cost,
        }),
        { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    );
}

/** The cost of a call from the provider's metadata (OpenRouter reports it), or 0. */
export function readCost(providerMetadata: unknown): number {
    const openrouter = (providerMetadata as Record<string, Record<string, unknown>> | undefined)?.openrouter;
    const cost = (openrouter?.usage as { cost?: number } | undefined)?.cost;
    return typeof cost === "number" ? cost : 0;
}
