/**
 * Plain data shapes passed between the chat pipeline stages.
 * Nothing here depends on a provider or on the terminal.
 */
import type { Source } from "../../core/search/types";
import type { UsageRecord } from "../../core/usage";

/** A source with the number the answer cites it by, e.g. [2]. */
export interface CitedSource extends Source {
    n: number;
}

export type Complexity = "simple" | "moderate" | "complex";

export interface RouteDecision {
    needsSearch: boolean;
    reason: string;
    complexity: Complexity;
    /** How the decision was made; shown by /debug. */
    via: "rule" | "model" | "cache" | "forced" | "escalated" | "default";
}

export interface SearchPlan {
    /** The user's request rewritten as a clear, complete question. */
    intent: string;
    /** Set when the request is too ambiguous to search: ask this instead. */
    clarify?: string;
    /** A guess the planner made about what the user meant. */
    assumption?: string;
    queries: string[];
}

/** What the pipeline returns for one user message. Front ends only read this. */
export interface ChatResult {
    /** "clarify" means `answer` is a question back to the user. */
    kind: "answer" | "clarify";
    answer: string;
    /** Where the answer came from. */
    origin: "model" | "web";
    sources: CitedSource[];
    route: RouteDecision;
    plan?: SearchPlan;
    usage: UsageRecord[];
    /** Search queries answered from the cache instead of the network. */
    cacheHits: number;
    /** Things the user should know: truncated input, search unavailable, and so on. */
    notes: string[];
}
