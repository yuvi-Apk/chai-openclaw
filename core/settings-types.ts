/**
 * The shapes Settings works with. Kept apart from core/config.ts so that file
 * stays about reading and saving values. Import them from "./config".
 */

/** Where a provider's key comes from: .env, the OS vault, the old settings file, or nowhere. */
export type KeySource = "env" | "vault" | "file" | "none";

export type ModelRole = "main" | "fast";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Settings saved for this user, so they work in every project. Keys live in the OS vault. */
export interface UserSettings {
    /** The model provider picked in a menu (a name in LLM_PROFILES). */
    llmProvider?: string;
    /** The reasoning effort picked in a menu: a ReasoningEffort or "off". */
    reasoning?: string;
    /**
     * OpenRouter key and models (the names predate other providers). The key
     * fields are only read from files saved before keys moved to the vault,
     * or when this machine has no vault.
     */
    apiKey?: string;
    model?: string;
    fastModel?: string;
    openaiApiKey?: string;
    openaiModel?: string;
    openaiFastModel?: string;
    geminiApiKey?: string;
    geminiModel?: string;
    geminiFastModel?: string;
    anthropicApiKey?: string;
    anthropicModel?: string;
    anthropicFastModel?: string;
}
