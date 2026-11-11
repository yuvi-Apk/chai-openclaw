/**
 * Logging in and out of a model provider in the terminal. Logging in asks
 * for a key, checks it with one tiny model call, and keeps it in the
 * operating system's credential vault. The prompts are passed in, so tests
 * can answer them and fake the check.
 */
import { confirm, isCancel, log, password, spinner } from "@clack/prompts";
import chalk from "chalk";
import type { KeySource, Settings } from "../../core/config";
import type { ErrorKind } from "../../core/errors";
import { providerChoices } from "../../core/llm/choices";
import { LLM_PROFILES, profileFor } from "../../core/llm/profiles";
import { verifyKey, type KeyCheck } from "../../core/llm/verify-key";
import type { Choice } from "../../core/mode";
import { chooseOne } from "./prompts";

/** A pasted key shorter than this is almost certainly not a whole key. */
const MIN_KEY_LENGTH = 20;
/** Give up after this many rejected keys in a row. */
const MAX_KEY_TRIES = 3;

export type LoginNoticeLevel = "success" | "note" | "warn";

/** The questions logging in asks, and the key check; the real ones are TERMINAL_LOGIN. */
export interface LoginPrompts {
    choose<T extends string>(question: string, choices: Choice<T>[], initial?: T): Promise<T | null>;
    /** Explain where to get a key and ask for it. Null when skipped. */
    askKey(provider: string): Promise<string | null>;
    confirm(question: string): Promise<boolean>;
    say(level: LoginNoticeLevel, text: string): void;
    verify(settings: Settings, provider: string, key: string): Promise<KeyCheck>;
}

const WHERE_SAVED: Record<KeySource, string> = {
    vault: "your system's credential vault",
    file: "~/.yuvi/settings.json",
    env: ".env",
    none: "nowhere",
};

/** What to do with a key after the check. */
type Verdict = { action: "save" | "retry" | "ask"; level: LoginNoticeLevel; text: string };

function judge(kind: ErrorKind, settings: Settings, provider: string): Verdict {
    const { label, keysUrl, billingUrl } = profileFor(provider);
    switch (kind) {
        case "auth_rejected":
        case "auth_missing":
            return { action: "retry", level: "warn", text: `${label} rejected that key. Copy it again from ${keysUrl}.` };
        case "no_credits":
            return { action: "save", level: "warn", text: `The key works, but the ${label} account has no credit. Add some at ${billingUrl}.` };
        case "model_not_found":
        case "no_tool_support":
            return {
                action: "save",
                level: "note",
                text: `The key works, but ${label} did not accept the model ${settings.modelId("main", provider)}. Pick another with “Change AI model”.`,
            };
        case "rate_limited":
            return { action: "save", level: "note", text: `The key works, but ${label} is busy right now. Try again in a minute.` };
        default:
            return { action: "ask", level: "warn", text: `Could not check the key right now (${kind.replace("_", " ")}).` };
    }
}

/**
 * Ask for a provider's key, check it, and save it. Does not switch to that
 * provider; the caller does. False when skipped or rejected.
 */
export async function logIn(settings: Settings, provider: string, prompts: LoginPrompts = TERMINAL_LOGIN): Promise<boolean> {
    const { label } = profileFor(provider);
    for (let tries = 0; tries < MAX_KEY_TRIES; tries++) {
        const key = (await prompts.askKey(provider))?.trim();
        if (!key) return false;
        const check = await prompts.verify(settings, provider, key);
        if (!check.ok) {
            const verdict = judge(check.kind, settings, provider);
            prompts.say(verdict.level, verdict.text);
            if (verdict.action === "retry") continue;
            if (verdict.action === "ask" && !(await prompts.confirm("Save the key anyway?"))) return false;
        }
        await settings.saveApiKey(key, provider);
        prompts.say("success", `${label} key saved in ${WHERE_SAVED[settings.keySource(provider)]}.`);
        return true;
    }
    prompts.say("warn", `${label} rejected the key ${MAX_KEY_TRIES} times, so nothing was saved.`);
    return false;
}

/** Pick a provider, log in to it if it has no key yet, and switch to it. */
export async function logInTo(settings: Settings, prompts: LoginPrompts = TERMINAL_LOGIN, alwaysAskKey = false): Promise<boolean> {
    const ready = Object.keys(LLM_PROFILES).find((name) => settings.hasKey(name));
    const picked = await prompts.choose("Which AI provider do you want to use?", providerChoices(settings), ready ?? settings.llmProvider);
    if (!picked) return false;
    const needsKey = alwaysAskKey || !settings.hasKey(picked);
    if (needsKey && !(await logIn(settings, picked, prompts))) return false;
    settings.saveProvider(picked);
    prompts.say("success", loginStatus(settings));
    return true;
}

/** At start: do nothing when the provider in use has a key, else welcome the user and log in. */
export async function ensureLoggedIn(settings: Settings, prompts: LoginPrompts = TERMINAL_LOGIN): Promise<boolean> {
    if (settings.hasKey(settings.llmProvider)) return true;
    const anyKey = Object.keys(LLM_PROFILES).some((name) => settings.hasKey(name));
    prompts.say(
        "note",
        anyKey
            ? `There is no ${settings.llmProfile.label} key yet. Pick a provider you are logged in to, or log in to this one.`
            : "Welcome to yuvi! Pick an AI provider and log in with its API key to start.",
    );
    return logInTo(settings, prompts);
}

/** Remove a provider's saved key. A key in .env cannot be removed from here, so say which line to delete. */
export async function logOut(settings: Settings, prompts: LoginPrompts = TERMINAL_LOGIN): Promise<void> {
    const withKeys = Object.keys(LLM_PROFILES).filter((name) => settings.hasKey(name));
    if (!withKeys.length) return prompts.say("note", "You are not logged in to any provider.");
    const choices = withKeys.map((name) => ({
        value: name,
        label: profileFor(name).label,
        hint: `key in ${WHERE_SAVED[settings.keySource(name)]}`,
    }));
    const picked = await prompts.choose("Log out of which provider?", choices, settings.llmProvider);
    if (!picked) return;
    const { label, keyEnv } = profileFor(picked);
    await settings.forgetKey(picked);
    if (settings.keySource(picked) === "env") {
        return prompts.say("note", `The ${label} key comes from .env (${keyEnv}). Delete that line and restart yuvi to log out.`);
    }
    prompts.say("success", `Logged out of ${label}. Its key was removed.`);
    if (picked === settings.llmProvider) await ensureLoggedIn(settings, prompts);
}

/** One line for the menus: "Logged in to Claude · claude-sonnet-5-5", or that nobody is. */
export function loginStatus(settings: Settings): string {
    const { label } = settings.llmProfile;
    return settings.hasKey(settings.llmProvider)
        ? `Logged in to ${label} · ${settings.modelId("main")}`
        : `Not logged in to ${label}`;
}

async function askKey(provider: string): Promise<string | null> {
    const { label, keysUrl } = profileFor(provider);
    log.info(
        [
            chalk.bold(`yuvi needs a ${label} key to talk to an AI model.`),
            `1. Open ${keysUrl} and sign in`,
            "2. Create a key and copy it",
            "3. Paste it below. yuvi checks it, then keeps it in your system's credential vault",
        ].join("\n"),
    );
    const key = await password({
        message: `Paste your ${label} key (Esc to skip):`,
        validate: (value) => (value && value.trim().length < MIN_KEY_LENGTH ? "That looks too short to be a key." : undefined),
    });
    return isCancel(key) ? null : String(key ?? "");
}

async function verifyWithSpinner(settings: Settings, provider: string, key: string): Promise<KeyCheck> {
    const spin = spinner();
    spin.start(`Checking your ${profileFor(provider).label} key…`);
    const check = await verifyKey(settings, provider, key);
    spin.stop(check.ok ? "The key works." : "The check did not pass.");
    return check;
}

export const TERMINAL_LOGIN: LoginPrompts = {
    choose: chooseOne,
    askKey,
    confirm: async (message) => {
        const answer = await confirm({ message });
        return !isCancel(answer) && answer;
    },
    say: (level, text) => (level === "success" ? log.success(text) : level === "warn" ? log.warn(text) : log.info(text)),
    verify: verifyWithSpinner,
};
