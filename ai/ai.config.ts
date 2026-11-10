import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export type ModelRole = 'main' | 'fast';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * The model id for a role.
 * main - planning, editing, reviewing (OPENROUTER_DEFAULT_MODEL)
 * fast - triage, explorer sub-agents, summaries (YUVI_MODEL_FAST, falls back to main)
 */
export function getModelId(role: ModelRole = 'main'): string {
    const main = process.env.OPENROUTER_DEFAULT_MODEL || "openrouter/free";
    if (role === 'fast') return process.env.YUVI_MODEL_FAST || main;
    return main;
}

export function getAgentModel(role: ModelRole = 'main') {
    const provider = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY || "",
    });
    return provider(getModelId(role));
}

/**
 * Reasoning effort from YUVI_REASONING. "off" disables the setting completely
 * (use it for models that reject a reasoning option). Returns undefined when
 * the caller should pick the effort itself.
 */
export function getReasoningOverride(): ReasoningEffort | 'off' | undefined {
    const value = (process.env.YUVI_REASONING || "").toLowerCase();
    if (value === 'off') return 'off';
    const allowed: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    return allowed.find((e) => e === value);
}
