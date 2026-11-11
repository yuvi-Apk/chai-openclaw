/**
 * Plain data shapes passed between the chat pipeline stages.
 * Nothing here depends on a provider, the terminal or any other module.
 */

export interface ChatTurn {
    role: "user" | "assistant";
    content: string;
}

/** One search result, in the shape every search provider must return. */
export interface Source {
    title: string;
    url: string;
    snippet: string;
    /** ISO date (YYYY-MM-DD) when the provider knows it. */
    date?: string;
}

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

/** Tokens and cost of one model call, so spending can be tuned per step. */
export interface StepUsage {
    step: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    ms: number;
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
    usage: StepUsage[];
    /** Search queries answered from the cache instead of the network. */
    cacheHits: number;
    /** Things the user should know: truncated input, search unavailable, and so on. */
    notes: string[];
}
