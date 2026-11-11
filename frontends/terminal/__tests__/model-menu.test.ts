import { describe, expect, test } from "bun:test";
import type { Settings } from "../../../core/config";
import { OTHER_MODEL } from "../../../core/llm/choices";
import { testSettings } from "../../../core/testing";
import { chooseEffort, chooseModel, chooseProvider, type MenuPrompts } from "../model-menu";
import { TerminalRenderer } from "../renderer";
import { profileFor } from "../../../core/llm/profiles";

/** Prompts that give scripted answers and record what was offered. */
function scripted(answers: (string | null)[], key: string | null = null) {
    const offered: string[][] = [];
    const keyAsked: string[] = [];
    const prompts: MenuPrompts = {
        choose: async <T extends string>(_q: string, choices: { value: T }[]) => {
            offered.push(choices.map((c) => c.value));
            return (answers.shift() ?? null) as T | null;
        },
        askText: async () => answers.shift() ?? null,
        setupKey: async (settings: Settings, provider: string) => {
            keyAsked.push(provider);
            if (!key) return false;
            settings.saveApiKey(key, provider);
            return true;
        },
    };
    return { prompts, offered, keyAsked };
}

const KEYS = { OPENROUTER_API_KEY: "sk-or-router-key-123", ANTHROPIC_API_KEY: "sk-ant-key-123456" };

describe("terminal provider menu", () => {
    test("offers every provider and switches to one that has a key", async () => {
        const settings = testSettings(KEYS);
        const { prompts, offered, keyAsked } = scripted(["anthropic"]);
        const notice = await chooseProvider(settings, prompts);
        expect(offered[0]).toEqual(["openrouter", "openai", "gemini", "anthropic"]);
        expect(keyAsked).toEqual([]);
        expect(settings.llmProvider).toBe("anthropic");
        expect(notice).toEqual({ level: "success", text: "Now using Claude with claude-sonnet-5-5, saved for next time." });
    });

    test("a provider without a key asks for it, and saves it to that provider", async () => {
        const settings = testSettings(KEYS);
        const { prompts, keyAsked } = scripted(["gemini"], "gemini-new-key-123");
        await chooseProvider(settings, prompts);
        expect(keyAsked).toEqual(["gemini"]);
        expect(settings.llmProvider).toBe("gemini");
        expect(settings.apiKey).toBe("gemini-new-key-123");
    });

    test("skipping the key keeps the old provider", async () => {
        const settings = testSettings(KEYS);
        const { prompts } = scripted(["openai"], null);
        const notice = await chooseProvider(settings, prompts);
        expect(settings.llmProvider).toBe("openrouter");
        expect(notice?.text).toBe("Still using OpenRouter: OpenAI needs a key first.");
    });

    test("cancelling or picking the same provider changes nothing", async () => {
        const settings = testSettings(KEYS);
        expect(await chooseProvider(settings, scripted([null]).prompts)).toBeNull();
        expect(await chooseProvider(settings, scripted(["openrouter"]).prompts)).toBeNull();
        expect(settings.llmProvider).toBe("openrouter");
    });

    test("warns when .env names the provider, because .env wins at the next start", async () => {
        const settings = testSettings({ ...KEYS, YUVI_LLM: "openrouter" });
        const notice = await chooseProvider(settings, scripted(["anthropic"]).prompts);
        expect(settings.llmProvider).toBe("anthropic");
        expect(notice?.text).toContain(".env wins at the next start");
    });
});

describe("terminal model menu", () => {
    test("offers the provider's suggestions and saves the pick", async () => {
        const settings = testSettings({ ...KEYS, YUVI_LLM: "anthropic" });
        const { prompts, offered } = scripted(["claude-opus-5-5"]);
        const notice = await chooseModel(settings, prompts);
        expect(offered[0]).toEqual([...profileFor("anthropic").suggestedModels, OTHER_MODEL]);
        expect(settings.modelId("main")).toBe("claude-opus-5-5");
        expect(notice?.text).toBe("Model changed to claude-opus-5-5 and saved for next time.");
    });

    test("“Other…” takes a typed id; an empty one changes nothing", async () => {
        const settings = testSettings(KEYS);
        await chooseModel(settings, scripted([OTHER_MODEL, " vendor/custom-model "]).prompts);
        expect(settings.modelId("main")).toBe("vendor/custom-model");
        expect(await chooseModel(settings, scripted([OTHER_MODEL, "  "]).prompts)).toBeNull();
        expect(settings.modelId("main")).toBe("vendor/custom-model");
    });

    test("a model not in the suggestions is still shown, first, as the one in use", async () => {
        const settings = testSettings({ ...KEYS, OPENROUTER_DEFAULT_MODEL: "vendor/odd" });
        const { prompts, offered } = scripted([null]);
        await chooseModel(settings, prompts);
        expect(offered[0]?.[0]).toBe("vendor/odd");
    });
});

describe("terminal effort menu", () => {
    test("saves an effort, and “default” hands the choice back to each mode", async () => {
        const settings = testSettings(KEYS);
        const { prompts, offered } = scripted(["high"]);
        expect((await chooseEffort(settings, prompts))?.text).toBe("Effort set to high, saved for next time.");
        expect(offered[0]).toEqual(["default", "none", "minimal", "low", "medium", "high", "xhigh", "max", "off"]);
        expect(settings.reasoning).toBe("high");
        await chooseEffort(settings, scripted(["default"]).prompts);
        expect(settings.reasoning).toBeUndefined();
    });
});

describe("terminal renderer error advice", () => {
    test("names the provider in use when the error happens, not the one at start", () => {
        const settings = testSettings(KEYS);
        const renderer = new TerminalRenderer(() => settings.llmProfile);
        settings.saveProvider("anthropic");
        const lines: string[] = [];
        const original = process.stdout.write;
        process.stdout.write = ((chunk: string) => lines.push(String(chunk)) > 0) as typeof process.stdout.write;
        try {
            renderer.render({ type: "error", message: "authentication_error: invalid x-api-key" });
        } finally {
            process.stdout.write = original;
        }
        expect(lines.join("\n")).toContain("Claude did not accept your API key.");
    });
});
