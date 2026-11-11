import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export type ModelRole = 'main' | 'fast';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Settings saved for this user, so they work in every project. */
export interface UserSettings {
    apiKey?: string;
    model?: string;
    fastModel?: string;
}

const settingsFile = () => path.join(homedir(), ".yuvi", "settings.json");

export function readUserSettings(): UserSettings {
    try {
        return JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as UserSettings;
    } catch {
        return {};
    }
}

/** Save one or more settings to ~/.yuvi/settings.json and apply them now. */
export function saveUserSettings(patch: UserSettings): void {
    const next = { ...readUserSettings(), ...patch };
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
    });
    if (patch.apiKey) process.env.OPENROUTER_API_KEY = patch.apiKey;
    if (patch.model) process.env.OPENROUTER_DEFAULT_MODEL = patch.model;
    if (patch.fastModel) process.env.YUVI_MODEL_FAST = patch.fastModel;
}

/**
 * Fill in anything the environment (.env) does not set from the saved user
 * settings. Values in the environment always win.
 */
export function applyUserSettings(): void {
    const saved = readUserSettings();
    if (!process.env.OPENROUTER_API_KEY && saved.apiKey) {
        process.env.OPENROUTER_API_KEY = saved.apiKey;
    }
    if (!process.env.OPENROUTER_DEFAULT_MODEL && saved.model) {
        process.env.OPENROUTER_DEFAULT_MODEL = saved.model;
    }
    if (!process.env.YUVI_MODEL_FAST && saved.fastModel) {
        process.env.YUVI_MODEL_FAST = saved.fastModel;
    }
}

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

/** A model by its exact id, for callers (chat mode) that choose the id themselves. */
export function getModelById(id: string) {
    const provider = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY || "",
    });
    return provider(id);
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
