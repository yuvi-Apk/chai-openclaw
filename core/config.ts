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

export type ModelRole = "main" | "fast";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const REASONING_EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Settings saved for this user, so they work in every project. */
export interface UserSettings {
    apiKey?: string;
    model?: string;
    fastModel?: string;
}

type Env = Record<string, string | undefined>;

const DEFAULT_MODEL = "openrouter/free";
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
            if (value) this.changed[key as keyof UserSettings] = value;
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

    get apiKey(): string {
        return this.changed.apiKey || this.env.OPENROUTER_API_KEY || this.saved.apiKey || "";
    }

    get tavilyApiKey(): string {
        return this.env.TAVILY_API_KEY || "";
    }

    /**
     * The model id for a role.
     * main - planning, editing, answering (OPENROUTER_DEFAULT_MODEL)
     * fast - triage, routing, summaries (YUVI_MODEL_FAST, falls back to main)
     */
    modelId(role: ModelRole = "main"): string {
        const main =
            this.changed.model || this.env.OPENROUTER_DEFAULT_MODEL || this.saved.model || DEFAULT_MODEL;
        if (role === "main") return main;
        return this.changed.fastModel || this.env.YUVI_MODEL_FAST || this.saved.fastModel || main;
    }

    /**
     * Reasoning effort from YUVI_REASONING. "off" disables the setting (for
     * models that reject it). Undefined means the caller picks the effort.
     */
    get reasoning(): ReasoningEffort | "off" | undefined {
        const value = (this.env.YUVI_REASONING || "").toLowerCase();
        if (value === "off") return "off";
        return REASONING_EFFORTS.find((effort) => effort === value);
    }

    /** Which model provider adapter to build. */
    get llmProvider(): string {
        return (this.env.YUVI_LLM || this.env.YUVI_CHAT_LLM || DEFAULT_LLM_PROVIDER).toLowerCase();
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
        return [this.apiKey, this.tavilyApiKey].filter((value) => value.length >= MIN_SECRET_LENGTH);
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

    /** Names of the environment variables that hold those values. */
    static readonly SECRET_ENV_NAMES = ["OPENROUTER_API_KEY", "TAVILY_API_KEY"] as const;
}
