/**
 * The words Telegram uses for each kind of failure. The core only says which
 * kind it was; keys are never set from a chat, so the advice points to the PC.
 */
import { classifyError, type ErrorKind } from "../../core/errors";
import { profileFor, type LLMProviderProfile } from "../../core/llm/profiles";

type Wording = Record<ErrorKind, { problem: string; fix: string }>;

/** Drop the scheme: Telegram links a bare host by itself and it reads shorter. */
const bare = (url: string) => url.replace(/^https?:\/\//, "");

/** The wording, naming the model provider in use and linking to its pages. */
function wordingFor(provider: LLMProviderProfile): Wording {
    const { label } = provider;
    return {
        auth_missing: {
            problem: `The ${label} key is missing or not accepted.`,
            fix: "Set the key on your PC (run yuvi in the terminal and choose “Set API key”), then restart the bot.",
        },
        auth_rejected: {
            problem: `${label} did not accept the API key.`,
            fix: "Set a fresh key on your PC, then restart the bot.",
        },
        no_credits: {
            problem: `The ${label} account has no credits left for this model.`,
            fix: `Add credits at ${bare(provider.billingUrl)}, or send /model and pick a cheaper one.`,
        },
        rate_limited: {
            problem: "The AI service is busy or you hit its rate limit.",
            fix: "Wait a minute and send your message again.",
        },
        no_tool_support: {
            problem: "This AI model cannot use tools, so it cannot work as an agent.",
            fix: "Send /model and choose a model that supports tool calling.",
        },
        model_not_found: {
            problem: "The AI model name was not found.",
            fix: `Send /model and enter a model id from ${bare(provider.modelsUrl)}.`,
        },
        context_too_long: {
            problem: "The conversation became too long for this model.",
            fix: "Send /compact or /new, then try again.",
        },
        network: { problem: "Could not reach the AI service.", fix: "Check the PC's internet connection and try again." },
        timeout: { problem: "The AI service took too long to answer.", fix: "Send your message again." },
        provider_down: {
            problem: "The AI service had a problem on its side.",
            fix: "Try again in a moment, or switch model with /model.",
        },
        unknown: { problem: "Something went wrong while talking to the AI.", fix: "Send your message again, or start over with /new." },
    };
}

/** Translate a raw provider or network error into plain words and a next step. */
export function explainError(
    raw: string,
    provider: LLMProviderProfile = profileFor("openrouter"),
): { problem: string; fix: string } {
    return wordingFor(provider)[classifyError(raw)];
}
