/**
 * The one place settings come from. Values are read from the environment
 * (.env) and from the user's saved settings file, validated, and given a
 * default. Nothing else in the code reads process.env.
 *
 * A Settings object is passed to whoever needs it, so two sessions can run
 * with different settings and tests can run with none.
 */
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { ConfigError } from "./errors";
import { LLM_PROFILES, profileFor, type LLMProviderProfile } from "./llm/profiles";

export type ModelRole = "main" | "fast";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Settings saved for this user, so they work in every project. */
export interface UserSettings {
    /** The model provider picked in a menu (a name in LLM_PROFILES). */
    llmProvider?: string;
    /** The reasoning effort picked in a menu: a ReasoningEffort or "off". */
    reasoning?: string;
    /** OpenRouter key and models (the names predate other providers). */
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

type Env = Record<string, string | undefined>;

const DEFAULT_LLM_PROVIDER = "openrouter";
const DEFAULT_SEARCH_PROVIDER = "auto";
/** A secret shorter than this is not worth hiding and would hide too much. */
const MIN_SECRET_LENGTH = 8;

export const userSettingsFile = () => path.join(homedir(), ".yuvi", "settings.json");

export class Settings {
    private saved: UserSettings = {};
    /** Values saved during this run. They win over the environment. */
    private changed: UserSettings = {};

    /**
     * @param env  where environment values come from
     * @param file the saved settings file, or null to keep settings in memory only (tests)
     */
    constructor(
        private readonly env: Env = process.env,
        private readonly file: string | null = userSettingsFile(),
    ) {
        this.reload();
    }

    /** Read the saved settings file again. */
    reload(): void {
        if (!this.file) return;
        try {
            this.saved = JSON.parse(fs.readFileSync(this.file, "utf8")) as UserSettings;
        } catch {
            this.saved = {};
        }
    }

    /** Save one or more settings for this user and apply them now. */
    save(patch: UserSettings): void {
        this.saved = { ...this.saved, ...patch };
        for (const [key, value] of Object.entries(patch)) {
            // An empty value clears the setting, so the environment or default applies again.
            if (value) this.changed[key as keyof UserSettings] = value;
            else delete this.changed[key as keyof UserSettings];
        }
        if (!this.file) return;
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.saved, null, 2) + "\n", {
            encoding: "utf8",
            mode: 0o600,
        });
    }

    // ---------- generic readers, for settings a mode owns itself ----------

    string(name: string, fallback = ""): string {
        return this.env[name] || fallback;
    }

    /** A whole number kept inside [min, max]; the fallback when unset or not a number. */
    number(name: string, fallback: number, min: number, max: number): number {
        const raw = this.env[name];
        const value = Number(raw);
        if (raw === undefined || raw === "" || !Number.isFinite(value)) return fallback;
        return Math.max(min, Math.min(max, Math.round(value)));
    }

    /** True for 1, true or on. */
    flag(name: string): boolean {
        return /^(1|true|on)$/i.test(this.env[name] || "");
    }

    /** True only when the value is "off": for features that are on by default. */
    isOff(name: string): boolean {
        return (this.env[name] || "").toLowerCase() === "off";
    }

    list(name: string, separator: string | RegExp): string[] {
        return (this.env[name] ?? "")
            .split(separator)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    // ---------- settings shared by every mode ----------

    /** Settings and links of the model provider in use (YUVI_LLM). */
    get llmProfile(): LLMProviderProfile {
        return profileFor(this.llmProvider);
    }

    /** A value saved during this run, then the environment, then the saved file. */
    private pick(envName: string, saved: keyof UserSettings): string {
        return this.changed[saved] || this.env[envName] || this.saved[saved] || "";
    }

    /** The key of the model provider in use. */
    get apiKey(): string {
        const profile = this.llmProfile;
        return this.pick(profile.keyEnv, profile.savedKey);
    }

    /** Save a key for a provider: the one in use unless another is named. */
    saveApiKey(key: string, provider = this.llmProvider): void {
        this.save({ [profileFor(provider).savedKey]: key });
    }

    /** Whether a provider has a key, so a menu can switch to it safely. */
    hasKey(provider: string): boolean {
        const profile = profileFor(provider);
        return Boolean(this.pick(profile.keyEnv, profile.savedKey));
    }

    /** Save the main model for the model provider in use. */
    saveModel(modelId: string): void {
        this.save({ [this.llmProfile.savedModel]: modelId });
    }

    get tavilyApiKey(): string {
        return this.env.TAVILY_API_KEY || "";
    }

    /** The Telegram bot token from @BotFather (TELEGRAM_BOT_TOKEN in .env). */
    get telegramToken(): string {
        return this.env.TELEGRAM_BOT_TOKEN || "";
    }

    /** The PIN that unlocks the Telegram bot (YUVI_TELEGRAM_PIN in .env). */
    get telegramPin(): string {
        return this.env.YUVI_TELEGRAM_PIN || "";
    }

    /**
     * The model id for a role, for the model provider in use.
     * main - planning, editing, answering (the profile's modelEnv, e.g. OPENAI_DEFAULT_MODEL)
     * fast - triage, routing, summaries (the profile's fastModelEnv; then its
     *        cheaper default if it has one; then the main model)
     */
    modelId(role: ModelRole = "main"): string {
        const profile = this.llmProfile;
        const main = this.pick(profile.modelEnv, profile.savedModel) || profile.defaultModel;
        if (role === "main") return main;
        return this.pick(profile.fastModelEnv, profile.savedFastModel) || profile.defaultFastModel || main;
    }

    /**
     * Reasoning effort from YUVI_REASONING. "off" disables the setting (for
     * models that reject it). Undefined means the caller picks the effort.
     */
    get reasoning(): ReasoningEffort | "off" | undefined {
        const value = this.pickString("YUVI_REASONING", "reasoning").toLowerCase();
        if (value === "off") return "off";
        return REASONING_EFFORTS.find((effort) => effort === value);
    }

    /** Save a reasoning effort for this user; undefined goes back to each mode's own choice. */
    saveReasoning(effort: ReasoningEffort | "off" | undefined): void {
        this.save({ reasoning: effort ?? "" });
    }

    /** Which model provider adapter to build. */
    get llmProvider(): string {
        const env = this.env.YUVI_LLM || this.env.YUVI_CHAT_LLM;
        return (this.changed.llmProvider || env || this.pickString("", "llmProvider") || DEFAULT_LLM_PROVIDER).toLowerCase();
    }

    /** True when .env names the provider, so a saved choice is overridden at the next start. */
    get providerSetInEnv(): boolean {
        return Boolean(this.env.YUVI_LLM || this.env.YUVI_CHAT_LLM);
    }

    /** True when .env sets the effort, so a saved choice is overridden at the next start. */
    get reasoningSetInEnv(): boolean {
        return Boolean(this.env.YUVI_REASONING);
    }

    /** Switch to another model provider and save the choice. Refuses a name with no profile. */
    saveProvider(name: string): void {
        if (!LLM_PROFILES[name]) {
            throw new ConfigError(`Unknown model provider "${name}". Available: ${Object.keys(LLM_PROFILES).join(", ")}.`);
        }
        this.save({ llmProvider: name });
    }

    /** Like pick, but a saved value that is not a string (a hand-edited file) is ignored. */
    private pickString(envName: string, saved: keyof UserSettings): string {
        const value = this.pick(envName, saved);
        return typeof value === "string" ? value : "";
    }

    /** Which search adapter to build: "auto", "duckduckgo" or "tavily". */
    get searchProvider(): string {
        return (this.env.YUVI_SEARCH || this.env.YUVI_CHAT_SEARCH || DEFAULT_SEARCH_PROVIDER).toLowerCase();
    }

    /** Write a structured log file (off unless YUVI_LOG is set). */
    get logEnabled(): boolean {
        return this.flag("YUVI_LOG");
    }

    /** Show developer extras such as the example mode. */
    get devMode(): boolean {
        return this.flag("YUVI_DEV");
    }

    /** Values that must never be printed, logged or handed to other programs. */
    secrets(): string[] {
        // Every provider's key, not only the active one: both may be set.
        const providerKeys = Object.values(LLM_PROFILES).map((p) => this.pick(p.keyEnv, p.savedKey));
        return [...new Set([...providerKeys, this.tavilyApiKey, this.telegramToken, this.telegramPin])].filter(
            (value) => value.length >= MIN_SECRET_LENGTH,
        );
    }

    /**
     * The environment for programs yuvi starts (shell commands), without the
     * API keys: a command has no business reading them.
     */
    childEnv(): Env {
        const copy = { ...this.env };
        for (const name of Settings.SECRET_ENV_NAMES) delete copy[name];
        return copy;
    }

    /**
     * Names of the environment variables that hold those values. Provider key
     * names come from the profiles, so a new provider cannot forget its key.
     */
    static readonly SECRET_ENV_NAMES: readonly string[] = [
        ...new Set(Object.values(LLM_PROFILES).map((profile) => profile.keyEnv)),
        "TAVILY_API_KEY",
        "TELEGRAM_BOT_TOKEN",
        "YUVI_TELEGRAM_PIN",
    ];
}
