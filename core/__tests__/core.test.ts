import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCore } from "../compose";
import { Settings } from "../config";
import { BudgetError, classifyError, ConfigError, errorText, RateLimitError, YuviError } from "../errors";
import { withQuietSdkErrors } from "../llm/quiet-sdk";
import { LLM_PROFILES } from "../llm/profiles";
import type { LLMClient } from "../llm/types";
import { clipMiddle } from "../security/limits";
import { redactSecrets, scrubEnv } from "../security/redact";
import type { SearchProvider } from "../search/types";
import { readCost, totalUsage } from "../usage";

describe("settings", () => {
    test("defaults apply when nothing is set", () => {
        const settings = new Settings({}, null);
        expect(settings.apiKey).toBe("");
        expect(settings.modelId("main")).toBe("openrouter/free");
        expect(settings.modelId("fast")).toBe("openrouter/free");
        expect(settings.llmProvider).toBe("openrouter");
        expect(settings.searchProvider).toBe("auto");
        expect(settings.reasoning).toBeUndefined();
        expect(settings.logEnabled).toBe(false);
        expect(settings.secrets()).toEqual([]);
    });

    test("numbers are validated and kept inside their range", () => {
        const settings = new Settings({ A: "7", B: "999", C: "abc", D: "", E: "2.6" }, null);
        expect(settings.number("A", 3, 1, 10)).toBe(7);
        expect(settings.number("B", 3, 1, 10)).toBe(10);
        expect(settings.number("C", 3, 1, 10)).toBe(3);
        expect(settings.number("D", 3, 1, 10)).toBe(3);
        expect(settings.number("E", 3, 1, 10)).toBe(3);
        expect(settings.number("MISSING", 3, 1, 10)).toBe(3);
    });

    test("flags, switches and lists", () => {
        const settings = new Settings({ ON: "true", OFF: "Off", DIRS: " a ; b;;" , YUVI_REASONING: "HIGH" }, null);
        expect(settings.flag("ON")).toBe(true);
        expect(settings.flag("OFF")).toBe(false);
        expect(settings.isOff("OFF")).toBe(true);
        expect(settings.isOff("ON")).toBe(false);
        expect(settings.list("DIRS", ";")).toEqual(["a", "b"]);
        expect(settings.reasoning).toBe("high");
    });

    test("the environment beats the saved file, and a value saved now beats both", () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-settings-")), "settings.json");
        fs.writeFileSync(file, JSON.stringify({ apiKey: "saved-key-123", model: "saved/model", fastModel: "saved/fast" }));

        const fromFile = new Settings({}, file);
        expect(fromFile.apiKey).toBe("saved-key-123");
        expect(fromFile.modelId("main")).toBe("saved/model");
        expect(fromFile.modelId("fast")).toBe("saved/fast");

        const withEnv = new Settings({ OPENROUTER_API_KEY: "env-key-12345", OPENROUTER_DEFAULT_MODEL: "env/model" }, file);
        expect(withEnv.apiKey).toBe("env-key-12345");
        expect(withEnv.modelId("main")).toBe("env/model");

        withEnv.save({ model: "picked/model" });
        expect(withEnv.modelId("main")).toBe("picked/model");
        expect(JSON.parse(fs.readFileSync(file, "utf8")).model).toBe("picked/model");
        expect(new Settings({}, file).modelId("main")).toBe("picked/model");
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    });

    test("saving never touches the process environment", () => {
        const before = process.env.OPENROUTER_API_KEY;
        new Settings({}, null).save({ apiKey: "in-memory-key-1234" });
        expect(process.env.OPENROUTER_API_KEY).toBe(before);
    });

    test("secrets are listed for redaction", () => {
        const settings = new Settings({ OPENROUTER_API_KEY: "sk-or-long-enough", TAVILY_API_KEY: "short" }, null);
        expect(settings.secrets()).toEqual(["sk-or-long-enough"]);
    });
});

describe("settings per model provider", () => {
    const bothKeys = {
        OPENROUTER_API_KEY: "sk-or-router-key-123",
        OPENROUTER_DEFAULT_MODEL: "router/model",
        OPENAI_API_KEY: "sk-openai-key-12345",
    };

    test("OpenAI uses its own key and a default model OpenAI knows", () => {
        const settings = new Settings({ ...bothKeys, YUVI_LLM: "openai" }, null);
        expect(settings.llmProvider).toBe("openai");
        expect(settings.llmProfile.label).toBe("OpenAI");
        expect(settings.apiKey).toBe("sk-openai-key-12345");
        expect(settings.modelId("main")).toBe("gpt-5-mini");
        expect(settings.modelId("fast")).toBe("gpt-5-mini");
    });

    test("OpenAI models come from their own variables, never OpenRouter's", () => {
        const settings = new Settings(
            { ...bothKeys, YUVI_LLM: "OpenAI", YUVI_MODEL_FAST: "router/fast", OPENAI_DEFAULT_MODEL: "gpt-main", OPENAI_FAST_MODEL: "gpt-fast" },
            null,
        );
        expect(settings.modelId("main")).toBe("gpt-main");
        expect(settings.modelId("fast")).toBe("gpt-fast");
    });

    test("OpenRouter stays the default and ignores the OpenAI values", () => {
        const settings = new Settings({ ...bothKeys, OPENAI_DEFAULT_MODEL: "gpt-main" }, null);
        expect(settings.apiKey).toBe("sk-or-router-key-123");
        expect(settings.modelId("main")).toBe("router/model");
    });

    test("a key or model saved in the app goes to the provider in use", () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-settings-")), "settings.json");
        const openai = new Settings({ YUVI_LLM: "openai" }, file);
        openai.saveApiKey("sk-saved-openai-123");
        openai.saveModel("gpt-picked");
        expect(openai.apiKey).toBe("sk-saved-openai-123");
        expect(openai.modelId("main")).toBe("gpt-picked");

        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(saved).toEqual({ openaiApiKey: "sk-saved-openai-123", openaiModel: "gpt-picked" });
        const router = new Settings({}, file);
        expect(router.apiKey).toBe("");
        expect(router.modelId("main")).toBe("openrouter/free");
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    });

    test("both provider keys are hidden and kept from shell commands", () => {
        const settings = new Settings({ ...bothKeys, PATH: "/bin" }, null);
        expect(settings.secrets()).toContain("sk-or-router-key-123");
        expect(settings.secrets()).toContain("sk-openai-key-12345");
        expect(settings.childEnv()).toEqual({ OPENROUTER_DEFAULT_MODEL: "router/model", PATH: "/bin" });
    });

    test("every provider key variable is a listed secret", () => {
        for (const profile of Object.values(LLM_PROFILES)) {
            expect(Settings.SECRET_ENV_NAMES as readonly string[]).toContain(profile.keyEnv);
        }
    });

    test("Gemini uses its own key, models and default", () => {
        const env = { ...bothKeys, YUVI_LLM: "gemini", GEMINI_API_KEY: "gemini-key-123456" };
        const settings = new Settings(env, null);
        expect(settings.llmProfile.label).toBe("Gemini");
        expect(settings.apiKey).toBe("gemini-key-123456");
        expect(settings.modelId("main")).toBe("gemini-3.8-flash");
        expect(settings.modelId("fast")).toBe("gemini-3.8-flash");
        const picked = new Settings({ ...env, GEMINI_DEFAULT_MODEL: "gemini-pro", GEMINI_FAST_MODEL: "gemini-lite" }, null);
        expect(picked.modelId("main")).toBe("gemini-pro");
        expect(picked.modelId("fast")).toBe("gemini-lite");
    });

    test("Claude uses its own key and a cheaper default for the fast role", () => {
        const env = { ...bothKeys, YUVI_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-key-123456" };
        const settings = new Settings(env, null);
        expect(settings.llmProfile.label).toBe("Claude");
        expect(settings.apiKey).toBe("sk-ant-key-123456");
        expect(settings.modelId("main")).toBe("claude-sonnet-5-5");
        expect(settings.modelId("fast")).toBe("claude-haiku-5-5");
        expect(new Settings({ ...env, ANTHROPIC_DEFAULT_MODEL: "claude-opus-5-5" }, null).modelId("fast")).toBe("claude-haiku-5-5");
        expect(new Settings({ ...env, ANTHROPIC_FAST_MODEL: "claude-x" }, null).modelId("fast")).toBe("claude-x");
    });

    test("keys and models saved for Gemini and Claude go to their own fields", () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-settings-")), "settings.json");
        const gemini = new Settings({ YUVI_LLM: "gemini" }, file);
        gemini.saveApiKey("gemini-saved-123");
        gemini.saveModel("gemini-picked");
        const claude = new Settings({ YUVI_LLM: "anthropic" }, file);
        claude.saveApiKey("sk-ant-saved-123");
        claude.saveModel("claude-picked");
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
            geminiApiKey: "gemini-saved-123",
            geminiModel: "gemini-picked",
            anthropicApiKey: "sk-ant-saved-123",
            anthropicModel: "claude-picked",
        });
        expect(new Settings({}, file).apiKey).toBe("");
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    });

    test("every provider's key is hidden and kept from shell commands", () => {
        const env = { GEMINI_API_KEY: "gemini-key-123456", ANTHROPIC_API_KEY: "sk-ant-key-123456", PATH: "/bin" };
        const settings = new Settings(env, null);
        expect(settings.secrets()).toContain("gemini-key-123456");
        expect(settings.secrets()).toContain("sk-ant-key-123456");
        expect(settings.childEnv()).toEqual({ PATH: "/bin" });
    });

    test("a provider picked in the app is saved; .env beats the file, a pick made now beats both", () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-settings-")), "settings.json");
        new Settings({}, file).saveProvider("anthropic");
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ llmProvider: "anthropic" });
        expect(new Settings({}, file).llmProvider).toBe("anthropic");
        expect(new Settings({}, file).llmProfile.label).toBe("Claude");

        const withEnv = new Settings({ YUVI_LLM: "openai" }, file);
        expect(withEnv.llmProvider).toBe("openai");
        withEnv.saveProvider("gemini");
        expect(withEnv.llmProvider).toBe("gemini");
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    });

    test("an unknown provider is refused and nothing is saved", () => {
        const settings = new Settings({}, null);
        expect(() => settings.saveProvider("nope")).toThrow(ConfigError);
        expect(settings.llmProvider).toBe("openrouter");
    });

    test("a reasoning effort picked in the app is saved, and clearing it falls back", () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-settings-")), "settings.json");
        const settings = new Settings({}, file);
        settings.saveReasoning("high");
        expect(settings.reasoning).toBe("high");
        expect(new Settings({}, file).reasoning).toBe("high");
        settings.saveReasoning("off");
        expect(settings.reasoning).toBe("off");
        settings.saveReasoning(undefined);
        expect(settings.reasoning).toBeUndefined();
        expect(new Settings({}, file).reasoning).toBeUndefined();

        const withEnv = new Settings({ YUVI_REASONING: "low" }, file);
        expect(withEnv.reasoning).toBe("low");
        withEnv.saveReasoning(undefined);
        expect(withEnv.reasoning).toBe("low");
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    });

    test("odd values in a hand-edited settings file are ignored", () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-settings-")), "settings.json");
        fs.writeFileSync(file, JSON.stringify({ llmProvider: 42, reasoning: "loud" }));
        const settings = new Settings({}, file);
        expect(settings.llmProvider).toBe("openrouter");
        expect(settings.reasoning).toBeUndefined();
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    });

    test("a custom provider without a profile shares OpenRouter's settings", () => {
        const settings = new Settings({ ...bothKeys, YUVI_LLM: "local" }, null);
        expect(settings.llmProfile.label).toBe("OpenRouter");
        expect(settings.apiKey).toBe("sk-or-router-key-123");
    });
});

describe("errors", () => {
    test("every error is a YuviError with its own name", () => {
        expect(new BudgetError("x")).toBeInstanceOf(YuviError);
        expect(new BudgetError("x").name).toBe("BudgetError");
        expect(new RateLimitError().message).toContain("rate limit");
        expect(errorText(new ConfigError("bad"))).toBe("bad");
    });

    test("provider failures are recognised", () => {
        expect(classifyError("No auth credentials found")).toBe("auth_missing");
        expect(classifyError("401 from model gateway")).toBe("unknown");
        expect(classifyError("User not found")).toBe("auth_rejected");
        expect(classifyError("Payment Required")).toBe("no_credits");
        expect(classifyError("429 Too Many Requests")).toBe("rate_limited");
        expect(classifyError("No endpoints found that support tool use")).toBe("no_tool_support");
        expect(classifyError("model not found")).toBe("model_not_found");
        expect(classifyError("maximum context length")).toBe("context_too_long");
        expect(classifyError("ECONNRESET")).toBe("network");
        expect(classifyError("request timed out")).toBe("timeout");
        expect(classifyError("502 Bad Gateway")).toBe("provider_down");
        expect(classifyError("???")).toBe("unknown");
    });

    test("OpenAI failures are recognised", () => {
        expect(classifyError("Incorrect API key provided: sk-...abcd.")).toBe("auth_rejected");
        expect(classifyError("OpenAI API key is missing. Pass it using the 'apiKey' parameter")).toBe("auth_missing");
        expect(classifyError("429 You exceeded your current quota, please check your plan and billing details.")).toBe("no_credits");
        expect(classifyError("insufficient_quota")).toBe("no_credits");
        expect(classifyError("The model `gpt-9` does not exist or you do not have access to it.")).toBe("model_not_found");
    });

    test("Claude failures are recognised", () => {
        expect(classifyError("Anthropic API key is missing. Pass it using the 'apiKey' parameter")).toBe("auth_missing");
        expect(classifyError("authentication_error: invalid x-api-key")).toBe("auth_rejected");
        expect(classifyError("Your credit balance is too low to access the Anthropic API.")).toBe("no_credits");
        expect(classifyError("529 overloaded_error: Overloaded")).toBe("provider_down");
        expect(classifyError("model: claude-x")).toBe("unknown");
    });

    test("Gemini failures are recognised", () => {
        expect(classifyError("Google Generative AI API key is missing.")).toBe("auth_missing");
        expect(classifyError("API key not valid. Please pass a valid API key.")).toBe("auth_rejected");
        expect(classifyError("API key expired. Please renew the API key.")).toBe("auth_rejected");
        expect(classifyError("RESOURCE_EXHAUSTED: Resource has been exhausted (e.g. check quota).")).toBe("rate_limited");
        expect(classifyError("models/gemini-9 is not found for API version v1beta")).toBe("model_not_found");
    });
});

describe("usage", () => {
    test("records add up", () => {
        const record = { step: "answer", model: "m", inputTokens: 100, outputTokens: 20, cost: 0.001, ms: 5 };
        expect(totalUsage([record, record])).toEqual({ calls: 2, inputTokens: 200, outputTokens: 40, cost: 0.002 });
        expect(totalUsage([])).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 });
    });

    test("cost is read from provider metadata when present", () => {
        expect(readCost({ openrouter: { usage: { cost: 0.0042 } } })).toBe(0.0042);
        expect(readCost({ openrouter: {} })).toBe(0);
        expect(readCost(undefined)).toBe(0);
    });
});

describe("security helpers", () => {
    test("known secrets and key-shaped text are hidden", () => {
        const clean = redactSecrets("my key is hunter2-hunter2 and sk-abcdefghijklmnopqrstu", ["hunter2-hunter2"]);
        expect(clean).toBe("my key is [redacted] and [redacted]");
    });

    test("named variables are removed from an environment copy", () => {
        const env = { OPENROUTER_API_KEY: "k", TAVILY_API_KEY: "t", PATH: "/bin" };
        expect(scrubEnv(env, Settings.SECRET_ENV_NAMES)).toEqual({ PATH: "/bin" });
        expect(env.OPENROUTER_API_KEY).toBe("k");
    });

    test("long text keeps its start and end", () => {
        expect(clipMiddle("short", 10)).toBe("short");
        expect(clipMiddle("a".repeat(30), 10)).toBe(`${"a".repeat(6)}\n\n… [20 characters omitted] …\n\n${"a".repeat(4)}`);
    });

    test("console.error comes back after overlapping quiet calls", async () => {
        const original = console.error;
        await Promise.all([
            withQuietSdkErrors(async () => expect(console.error).not.toBe(original)),
            withQuietSdkErrors(async () => undefined),
        ]);
        expect(console.error).toBe(original);
        await withQuietSdkErrors(async () => {
            throw new Error("x");
        }).catch(() => undefined);
        expect(console.error).toBe(original);
    });
});

describe("composition", () => {
    const fakeSearch = (name: string): SearchProvider => ({ name, search: async () => [] });

    test("an unknown provider is a clear configuration error", () => {
        expect(() => createCore(new Settings({ YUVI_SEARCH: "bing" }, null)).search).toThrow(
            'Unknown search provider "bing". Available: duckduckgo, tavily, auto.',
        );
        expect(() => createCore(new Settings({ YUVI_LLM: "nope" }, null)).models).toThrow(ConfigError);
        expect(() => createCore(new Settings({ YUVI_SEARCH: "tavily" }, null)).search).toThrow("TAVILY_API_KEY is not set");
    });

    test("the search engine follows the settings", () => {
        expect(createCore(new Settings({}, null)).search.name).toBe("duckduckgo");
        expect(createCore(new Settings({ TAVILY_API_KEY: "tvly-key-123456" }, null)).search.name).toBe("tavily");
        expect(createCore(new Settings({ YUVI_SEARCH: "duckduckgo", TAVILY_API_KEY: "tvly-key-123456" }, null)).search.name).toBe("duckduckgo");
    });

    test("a wrongly set search provider does not break a mode that never searches", () => {
        const core = createCore(new Settings({ YUVI_SEARCH: "bing" }, null));
        expect(core.settings.modelId()).toBe("openrouter/free");
        expect(core.models).toBeDefined();
    });

    test("a new provider is one registry entry plus one setting", async () => {
        const settings = new Settings({ YUVI_SEARCH: "brave", YUVI_LLM: "local" }, null);
        const core = createCore(settings, {
            searchProviders: { brave: () => fakeSearch("brave") },
            llmProviders: { local: () => (modelId) => ({ modelId }) as never },
        });
        expect(core.search.name).toBe("brave");
        expect(core.models.byId("tiny")).toEqual({ modelId: "tiny" } as never);
    });

    test("YUVI_LLM=openai builds OpenAI models without any network call", () => {
        const core = createCore(new Settings({ YUVI_LLM: "openai", OPENAI_API_KEY: "sk-openai-key-12345" }, null));
        const model = core.models.forRole("main") as { provider: string; modelId: string };
        expect(model.provider).toStartWith("openai");
        expect(model.modelId).toBe("gpt-5-mini");
    });

    test("Gemini and Claude models are built without any network call", () => {
        const gemini = createCore(new Settings({ YUVI_LLM: "gemini", GEMINI_API_KEY: "gemini-key-123456" }, null));
        const geminiModel = gemini.models.forRole("main") as { provider: string; modelId: string };
        expect(geminiModel.provider).toStartWith("google");
        expect(geminiModel.modelId).toBe("gemini-3.8-flash");

        const claude = createCore(new Settings({ YUVI_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-key-123456" }, null));
        const claudeModel = claude.models.forRole("fast") as { provider: string; modelId: string };
        expect(claudeModel.provider).toStartWith("anthropic");
        expect(claudeModel.modelId).toBe("claude-haiku-5-5");
    });

    test("switching the provider mid-session changes the next model without a restart", () => {
        const settings = new Settings({ OPENROUTER_API_KEY: "sk-or-router-key-123", ANTHROPIC_API_KEY: "sk-ant-key-123456" }, null);
        const core = createCore(settings);
        expect((core.models.forRole("main") as { provider: string }).provider).toStartWith("openrouter");
        settings.saveProvider("anthropic");
        const model = core.models.forRole("main") as { provider: string; modelId: string };
        expect(model.provider).toStartWith("anthropic");
        expect(model.modelId).toBe("claude-sonnet-5-5");
    });

    test("every profile suggests its own default model first", () => {
        for (const profile of Object.values(LLM_PROFILES)) {
            expect(profile.suggestedModels[0]).toBe(profile.defaultModel);
        }
    });

    test("ready-made parts are used as given", async () => {
        const llm: LLMClient = {
            complete: async () => ({ text: "hi", inputTokens: 1, outputTokens: 1, cost: 0 }),
            stream: async () => ({ text: "hi", inputTokens: 1, outputTokens: 1, cost: 0 }),
        };
        const core = createCore(new Settings({}, null), { llm, search: fakeSearch("fake") });
        expect(core.llm).toBe(llm);
        expect(core.search.name).toBe("fake");
    });
});
