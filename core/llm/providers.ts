/**
 * Model providers. Each entry turns the settings into a function that builds
 * a model from its id. To support another provider, add one entry here and
 * select it with YUVI_LLM.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { ModelRole, Settings } from "../config";
import { ConfigError } from "../errors";

export type ModelFactory = (modelId: string) => LanguageModel;
export type LLMProviderRegistry = Record<string, (settings: Settings) => ModelFactory>;

export const LLM_PROVIDERS: LLMProviderRegistry = {
    // The key is read on every call, so a key set mid-session works at once.
    openrouter: (settings) => (modelId) => createOpenRouter({ apiKey: settings.apiKey })(modelId),
    openai: (settings) => (modelId) => createOpenAI({ apiKey: settings.apiKey })(modelId),
    gemini: (settings) => (modelId) => createGoogleGenerativeAI({ apiKey: settings.apiKey })(modelId),
    anthropic: (settings) => (modelId) => createAnthropic({ apiKey: settings.apiKey })(modelId),
};

/**
 * Builds models for the configured provider, by exact id or by role. The
 * provider is looked up on every call, so switching it in a menu takes
 * effect at the next model call without a restart.
 */
export class Models {
    constructor(
        private readonly settings: Settings,
        private readonly registry: LLMProviderRegistry = LLM_PROVIDERS,
    ) {
        // Fail at start-up, not at the first message, when the provider is set wrongly.
        this.factory();
    }

    private factory(): ModelFactory {
        const name = this.settings.llmProvider;
        const provider = this.registry[name];
        if (!provider) {
            throw new ConfigError(`Unknown model provider "${name}". Available: ${Object.keys(this.registry).join(", ")}.`);
        }
        return provider(this.settings);
    }

    byId(modelId: string): LanguageModel {
        return this.factory()(modelId);
    }

    forRole(role: ModelRole = "main"): LanguageModel {
        return this.byId(this.settings.modelId(role));
    }
}
