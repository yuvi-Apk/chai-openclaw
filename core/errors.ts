/**
 * One family of errors for the whole app, plus helpers to turn any thrown
 * value into text and to recognise what kind of provider failure it was.
 * The wording shown to the user belongs to the front end, not here.
 */

export class YuviError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** A setting is missing or wrong (unknown provider, missing key). */
export class ConfigError extends YuviError {}

/** A message went past its hard limit of model calls. */
export class BudgetError extends YuviError {}

/** Too many calls in the last minute. */
export class RateLimitError extends YuviError {
    constructor(message = "Chat rate limit reached: too many model calls in the last minute.") {
        super(message);
    }
}

/** A mode used a tool it did not declare, or a tool refused to run. */
export class ToolError extends YuviError {}

export function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export type ErrorKind =
    | "auth_missing"
    | "auth_rejected"
    | "no_credits"
    | "rate_limited"
    | "no_tool_support"
    | "model_not_found"
    | "context_too_long"
    | "network"
    | "timeout"
    | "provider_down"
    | "unknown";

/** Work out what went wrong from a raw provider or network error message. */
export function classifyError(raw: string): ErrorKind {
    const text = raw.toLowerCase();
    const has = (...words: string[]) => words.some((word) => text.includes(word));

    if (
        has("no auth credentials", "missing api key", "api key is missing", "missing authentication", "authentication header") ||
        (has("401") && !has("model"))
    ) {
        return "auth_missing";
    }
    if (has("invalid api key", "unauthorized", "user not found")) return "auth_rejected";
    if (has("402", "insufficient credits", "payment required", "more credits")) return "no_credits";
    if (has("429", "rate limit", "rate-limit", "too many requests")) return "rate_limited";
    if (has("no endpoints found", "tool use", "support tool", "function calling")) return "no_tool_support";
    if (has("not a valid model", "model not found", "no such model", "404")) return "model_not_found";
    if (has("context length", "maximum context", "too many tokens", "context window")) return "context_too_long";
    if (has("fetch failed", "enotfound", "econnrefused", "econnreset", "network", "socket", "getaddrinfo", "unable to connect")) {
        return "network";
    }
    if (has("timeout", "timed out")) return "timeout";
    if (has("500", "502", "503", "overloaded", "internal server error", "bad gateway", "provider returned error")) {
        return "provider_down";
    }
    return "unknown";
}
