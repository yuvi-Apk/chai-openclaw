/**
 * Model providers. Each entry turns the settings into a function that builds
 * a model from its id. To support another provider, add one entry here and
 * select it with YUVI_LLM.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { ModelRole, Settings } from "../config";
import { ConfigError } from "../errors";

export type ModelFactory = (modelId: string) => LanguageModel;
export type LLMProviderRegistry = Record<string, (settings: Settings) => ModelFactory>;

export const LLM_PROVIDERS: LLMProviderRegistry = {
    // The key is read on every call, so a key set mid-session works at once.
    openrouter: (settings) => (modelId) => createOpenRouter({ apiKey: settings.apiKey })(modelId),
};

/** Builds models for the configured provider, by exact id or by role. */
export class Models {
    private readonly build: ModelFactory;

    constructor(
        private readonly settings: Settings,
        registry: LLMProviderRegistry = LLM_PROVIDERS,
    ) {
        const provider = registry[settings.llmProvider];
        if (!provider) {
            throw new ConfigError(
                `Unknown model provider "${settings.llmProvider}". Available: ${Object.keys(registry).join(", ")}.`,
            );
        }
        this.build = provider(settings);
    }

    byId(modelId: string): LanguageModel {
        return this.build(modelId);
    }

    forRole(role: ModelRole = "main"): LanguageModel {
        return this.build(this.settings.modelId(role));
    }
}
