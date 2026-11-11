/**
 * The words the terminal uses for each kind of failure, and what the user
 * can do about it. The core only says which kind of failure it was.
 */
import { classifyError, type ErrorKind } from "../../core/errors";

const WORDING: Record<ErrorKind, { problem: string; fix: string }> = {
    auth_missing: {
        problem: "Your OpenRouter key is missing or not accepted.",
        fix: "Type / and choose “Set API key”, then paste a key from https://openrouter.ai/keys",
    },
    auth_rejected: {
        problem: "OpenRouter did not accept your API key.",
        fix: "Type / and choose “Set API key” and paste a fresh key from https://openrouter.ai/keys",
    },
    no_credits: {
        problem: "Your OpenRouter account has no credits left for this model.",
        fix: "Add credits at https://openrouter.ai/credits, or type / → “Change AI model” and pick a free one (for example openrouter/free).",
    },
    rate_limited: {
        problem: "The AI service is busy or you hit its rate limit.",
        fix: "Wait a minute and send your message again. Free models have low limits; a paid model is more reliable.",
    },
    no_tool_support: {
        problem: "This AI model cannot use tools, so it cannot work as an agent.",
        fix: "Type / → “Change AI model” and choose a model that supports tool calling.",
    },
    model_not_found: {
        problem: "The AI model name was not found.",
        fix: "Type / → “Change AI model” and enter a model id from https://openrouter.ai/models",
    },
    context_too_long: {
        problem: "The conversation became too long for this model.",
        fix: "Type / → “Free up memory”, or “Start a new conversation”, then try again.",
    },
    network: {
        problem: "Could not reach the AI service.",
        fix: "Check your internet connection and send your message again.",
    },
    timeout: {
        problem: "The AI service took too long to answer.",
        fix: "Send your message again. If it keeps happening, switch model with / → “Change AI model”.",
    },
    provider_down: {
        problem: "The AI service had a problem on its side.",
        fix: "Send your message again in a moment, or switch model with / → “Change AI model”.",
    },
    unknown: {
        problem: "Something went wrong while talking to the AI.",
        fix: "Send your message again. If it repeats, type / → “Change AI model”, or start a new conversation.",
    },
};

/** Translate a raw provider or network error into plain words and a next step. */
export function explainError(raw: string): { problem: string; fix: string } {
    return WORDING[classifyError(raw)];
}
