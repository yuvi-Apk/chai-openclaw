/**
 * The words the terminal uses for each kind of failure, and what the user
 * can do about it. The core only says which kind of failure it was.
 */
import { classifyError, type ErrorKind } from "../../core/errors";
import { profileFor, type LLMProviderProfile } from "../../core/llm/profiles";

type Wording = Record<ErrorKind, { problem: string; fix: string }>;

/** The wording, naming the model provider in use and linking to its pages. */
function wordingFor(provider: LLMProviderProfile): Wording {
    const { label, keysUrl, modelsUrl, billingUrl } = provider;
    return {
        auth_missing: {
            problem: `Your ${label} key is missing or not accepted.`,
            fix: `Type / and choose “Log in / change key”, then paste a key from ${keysUrl}`,
        },
        auth_rejected: {
            problem: `${label} did not accept your API key.`,
            fix: `Type / and choose “Log in / change key” and paste a fresh key from ${keysUrl}`,
        },
        no_credits: {
            problem: `Your ${label} account has no credits left for this model.`,
            fix: `Add credits at ${billingUrl}, or type / → “Change AI model” and pick a cheaper one.`,
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
            fix: `Type / → “Change AI model” and enter a model id from ${modelsUrl}`,
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
}

/** Translate a raw provider or network error into plain words and a next step. */
export function explainError(
    raw: string,
    provider: LLMProviderProfile = profileFor("openrouter"),
): { problem: string; fix: string } {
    return wordingFor(provider)[classifyError(raw)];
}
