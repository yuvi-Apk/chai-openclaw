/**
 * What each model provider needs from the settings: which environment
 * variables hold its key and models, where they are saved, and the links a
 * front end shows. Plain data, so adding a provider is one more entry here
 * and one in LLM_PROVIDERS.
 */
import type { UserSettings } from "../config";

/** Settings and links for one model provider. */
export interface LLMProviderProfile {
    /** The name shown to the user, e.g. "OpenAI". */
    label: string;
    keyEnv: string;
    modelEnv: string;
    fastModelEnv: string;
    /** Where the key and models are kept in ~/.yuvi/settings.json. */
    savedKey: keyof UserSettings;
    savedModel: keyof UserSettings;
    savedFastModel: keyof UserSettings;
    defaultModel: string;
    /** A cheaper model for the fast role; the main model when not set. */
    defaultFastModel?: string;
    /** Model ids offered in the model menu, best first; the user can still type any id. */
    suggestedModels: string[];
    keysUrl: string;
    modelsUrl: string;
    billingUrl: string;
}

export const LLM_PROFILES: Record<string, LLMProviderProfile> = {
    openrouter: {
        label: "OpenRouter",
        keyEnv: "OPENROUTER_API_KEY",
        modelEnv: "OPENROUTER_DEFAULT_MODEL",
        fastModelEnv: "YUVI_MODEL_FAST",
        savedKey: "apiKey",
        savedModel: "model",
        savedFastModel: "fastModel",
        defaultModel: "openrouter/free",
        suggestedModels: ["openrouter/free", "anthropic/claude-sonnet-5.5", "openai/gpt-5-mini", "google/gemini-3.8-flash"],
        keysUrl: "https://openrouter.ai/keys",
        modelsUrl: "https://openrouter.ai/models",
        billingUrl: "https://openrouter.ai/credits",
    },
    openai: {
        label: "OpenAI",
        keyEnv: "OPENAI_API_KEY",
        modelEnv: "OPENAI_DEFAULT_MODEL",
        fastModelEnv: "OPENAI_FAST_MODEL",
        savedKey: "openaiApiKey",
        savedModel: "openaiModel",
        savedFastModel: "openaiFastModel",
        // Cheap and able to call tools, which suits a small prepaid balance.
        defaultModel: "gpt-5-mini",
        suggestedModels: ["gpt-5-mini", "gpt-5", "gpt-5-nano"],
        keysUrl: "https://platform.openai.com/api-keys",
        modelsUrl: "https://platform.openai.com/docs/models",
        billingUrl: "https://platform.openai.com/settings/organization/billing",
    },
    gemini: {
        label: "Gemini",
        keyEnv: "GEMINI_API_KEY",
        modelEnv: "GEMINI_DEFAULT_MODEL",
        fastModelEnv: "GEMINI_FAST_MODEL",
        savedKey: "geminiApiKey",
        savedModel: "geminiModel",
        savedFastModel: "geminiFastModel",
        // Stable, cheap and able to call tools; AI Studio has a free tier for it.
        defaultModel: "gemini-3.8-flash",
        suggestedModels: ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-flash-latest"],
        keysUrl: "https://aistudio.google.com/apikey",
        modelsUrl: "https://ai.google.dev/gemini-api/docs/models",
        billingUrl: "https://ai.google.dev/gemini-api/docs/billing",
    },
    anthropic: {
        label: "Claude",
        keyEnv: "ANTHROPIC_API_KEY",
        modelEnv: "ANTHROPIC_DEFAULT_MODEL",
        fastModelEnv: "ANTHROPIC_FAST_MODEL",
        savedKey: "anthropicApiKey",
        savedModel: "anthropicModel",
        savedFastModel: "anthropicFastModel",
        defaultModel: "claude-sonnet-5-5",
        // Triage and summaries do not need Sonnet; Haiku is much cheaper.
        defaultFastModel: "claude-haiku-5-5",
        suggestedModels: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
        keysUrl: "https://platform.claude.com/settings/keys",
        modelsUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
        billingUrl: "https://platform.claude.com/settings/billing",
    },
};

/** Fallback for a provider with no profile (a custom adapter): it shares OpenRouter's settings. */
export const DEFAULT_PROFILE_NAME = "openrouter";

/** The profile for a provider name, or the default one when it has none. */
export function profileFor(provider: string): LLMProviderProfile {
    return LLM_PROFILES[provider] ?? (LLM_PROFILES[DEFAULT_PROFILE_NAME] as LLMProviderProfile);
}
