import { describe, expect, test } from "bun:test";
import type { ErrorKind } from "../../../core/errors";
import type { KeyCheck } from "../../../core/llm/verify-key";
import { testSettings } from "../../../core/testing";
import { ensureLoggedIn, logIn, loginStatus, logInTo, logOut, type LoginPrompts } from "../login";

interface Script {
    /** Answers to choose(), in order. */
    picks?: (string | null)[];
    /** Keys pasted, in order; null skips. */
    keys?: (string | null)[];
    /** Result of each key check, in order; ok when the list runs out. */
    checks?: (ErrorKind | "ok")[];
    /** Answer to "Save the key anyway?". */
    saveAnyway?: boolean;
}

/** Prompts that answer from a script and record what was said and checked. */
function scripted(script: Script) {
    const said: string[] = [];
    const checked: string[] = [];
    const offered: string[][] = [];
    const prompts: LoginPrompts = {
        choose: async <T extends string>(_q: string, choices: { value: T }[]) => {
            offered.push(choices.map((c) => c.value));
            return (script.picks?.shift() ?? null) as T | null;
        },
        askKey: async () => script.keys?.shift() ?? null,
        confirm: async () => script.saveAnyway ?? false,
        say: (level, text) => void said.push(`${level}: ${text}`),
        verify: async (_settings, provider, key): Promise<KeyCheck> => {
            checked.push(`${provider}:${key}`);
            const result = script.checks?.shift() ?? "ok";
            return result === "ok" ? { ok: true } : { ok: false, kind: result };
        },
    };
    return { prompts, said, checked, offered };
}

const fresh = () => testSettings({ YUVI_LLM: "", YUVI_CHAT_LLM: "" });

describe("first start: logging in", () => {
    test("with no key anywhere, welcomes, asks the provider, then the key, checks it and switches", async () => {
        const settings = fresh();
        const { prompts, said, checked, offered } = scripted({ picks: ["anthropic"], keys: ["sk-ant-new-key-123456"] });
        expect(await ensureLoggedIn(settings, prompts)).toBe(true);
        expect(said[0]).toContain("Welcome to yuvi");
        expect(offered[0]).toEqual(["openrouter", "openai", "gemini", "anthropic"]);
        expect(checked).toEqual(["anthropic:sk-ant-new-key-123456"]);
        expect(settings.llmProvider).toBe("anthropic");
        expect(settings.apiKey).toBe("sk-ant-new-key-123456");
        expect(settings.keySource("anthropic")).toBe("vault");
        expect(said.at(-1)).toBe("success: Logged in to Claude · claude-sonnet-5-5");
    });

    test("does nothing when the provider in use already has a key", async () => {
        const settings = testSettings({ YUVI_LLM: "openrouter", OPENROUTER_API_KEY: "sk-or-key-123456789" });
        const { prompts, said } = scripted({});
        expect(await ensureLoggedIn(settings, prompts)).toBe(true);
        expect(said).toEqual([]);
    });

    test("switching to a provider that already has a key needs no new key", async () => {
        const settings = testSettings({ YUVI_LLM: "", GEMINI_API_KEY: "gemini-key-123456789" });
        const { prompts, checked } = scripted({ picks: ["gemini"] });
        expect(await ensureLoggedIn(settings, prompts)).toBe(true);
        expect(checked).toEqual([]);
        expect(settings.llmProvider).toBe("gemini");
    });

    test("skipping the provider or the key leaves the user logged out", async () => {
        const settings = fresh();
        expect(await ensureLoggedIn(settings, scripted({ picks: [null] }).prompts)).toBe(false);
        expect(await ensureLoggedIn(settings, scripted({ picks: ["openai"], keys: [null] }).prompts)).toBe(false);
        expect(settings.hasKey("openai")).toBe(false);
        expect(loginStatus(settings)).toBe("Not logged in to OpenRouter");
    });
});

describe("checking the key", () => {
    test("a rejected key is asked for again, and the next good one is saved", async () => {
        const settings = fresh();
        const { prompts, said, checked } = scripted({
            keys: ["sk-wrong-key-1234567", "sk-right-key-1234567"],
            checks: ["auth_rejected", "ok"],
        });
        expect(await logIn(settings, "openai", prompts)).toBe(true);
        expect(checked).toHaveLength(2);
        expect(said[0]).toContain("OpenAI rejected that key");
        expect(settings.hasKey("openai")).toBe(true);
    });

    test("three rejected keys give up and save nothing", async () => {
        const settings = fresh();
        const { prompts, said } = scripted({
            keys: ["sk-wrong-1-12345678", "sk-wrong-2-12345678", "sk-wrong-3-12345678", "never-asked-12345678"],
            checks: ["auth_rejected", "auth_missing", "auth_rejected"],
        });
        expect(await logIn(settings, "gemini", prompts)).toBe(false);
        expect(said.at(-1)).toBe("warn: Gemini rejected the key 3 times, so nothing was saved.");
        expect(settings.hasKey("gemini")).toBe(false);
    });

    test("a key that could not be checked is saved only when the user says so", async () => {
        const declined = fresh();
        const no = scripted({ keys: ["sk-ant-key-123456789"], checks: ["network"], saveAnyway: false });
        expect(await logIn(declined, "anthropic", no.prompts)).toBe(false);
        expect(declined.hasKey("anthropic")).toBe(false);
        expect(no.said[0]).toContain("Could not check the key right now (network)");

        const accepted = fresh();
        const yes = scripted({ keys: ["sk-ant-key-123456789"], checks: ["timeout"], saveAnyway: true });
        expect(await logIn(accepted, "anthropic", yes.prompts)).toBe(true);
        expect(accepted.hasKey("anthropic")).toBe(true);
    });

    test("a key that works but has no credit is saved, with a warning and the billing page", async () => {
        const settings = fresh();
        const { prompts, said } = scripted({ keys: ["sk-openai-key-1234567"], checks: ["no_credits"] });
        expect(await logIn(settings, "openai", prompts)).toBe(true);
        expect(said[0]).toContain("has no credit");
        expect(said[0]).toContain("platform.openai.com");
    });

    test("the main-menu login asks for a new key even when one exists", async () => {
        const settings = testSettings({ YUVI_LLM: "" });
        await settings.saveApiKey("sk-or-old-key-1234567");
        const { prompts, checked } = scripted({ picks: ["openrouter"], keys: ["sk-or-new-key-1234567"] });
        expect(await logInTo(settings, prompts, true)).toBe(true);
        expect(checked).toEqual(["openrouter:sk-or-new-key-1234567"]);
        expect(settings.apiKey).toBe("sk-or-new-key-1234567");
    });
});

describe("logging out", () => {
    test("removes a saved key and asks to log in again when it was the one in use", async () => {
        const settings = fresh();
        await settings.saveApiKey("sk-or-key-1234567890", "openrouter");
        const { prompts, said, offered } = scripted({ picks: ["openrouter", null] });
        await logOut(settings, prompts);
        expect(offered[0]).toEqual(["openrouter"]);
        expect(settings.hasKey("openrouter")).toBe(false);
        expect(said).toContain("success: Logged out of OpenRouter. Its key was removed.");
        expect(said.some((line) => line.includes("Welcome to yuvi"))).toBe(true);
    });

    test("a key from .env cannot be removed here, so it says which line to delete", async () => {
        const settings = testSettings({ YUVI_LLM: "", GEMINI_API_KEY: "gemini-env-key-123456" });
        const { prompts, said } = scripted({ picks: ["gemini"] });
        await logOut(settings, prompts);
        expect(said).toEqual(["note: The Gemini key comes from .env (GEMINI_API_KEY). Delete that line and restart yuvi to log out."]);
        expect(settings.hasKey("gemini")).toBe(true);
    });

    test("with no keys at all there is nothing to log out of", async () => {
        const { prompts, said, offered } = scripted({});
        await logOut(fresh(), prompts);
        expect(offered).toEqual([]);
        expect(said).toEqual(["note: You are not logged in to any provider."]);
    });
});
