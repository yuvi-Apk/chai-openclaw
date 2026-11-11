import { describe, expect, test } from "bun:test";
import type { Settings } from "../config";
import { verifyKey } from "../llm/verify-key";
import type { LLMRequest } from "../llm/types";
import { FakeLLM, testSettings } from "../testing";

/** A core maker whose model answers with `reply`, recording what it was asked and with which settings. */
function fakeCore(reply: (request: LLMRequest) => string) {
    const seen: { request?: LLMRequest; settings?: Settings } = {};
    const make = (settings: Settings) => {
        seen.settings = settings;
        return {
            llm: new FakeLLM((request) => {
                seen.request = request;
                return reply(request);
            }),
        };
    };
    return { make, seen };
}

const failing = (message: string) =>
    fakeCore(() => {
        throw new Error(message);
    }).make;

describe("checking a key before it is saved", () => {
    test("a key that gets a reply is ok, checked with that provider's model and key", async () => {
        const settings = testSettings({ YUVI_LLM: "openrouter", ANTHROPIC_DEFAULT_MODEL: "claude-picked" });
        const { make, seen } = fakeCore(() => "OK");
        expect(await verifyKey(settings, "anthropic", "sk-ant-new-key-123456", make)).toEqual({ ok: true });
        expect(seen.request?.model).toBe("claude-picked");
        expect(seen.request?.maxTokens).toBeLessThanOrEqual(16);
        expect(seen.settings?.llmProvider).toBe("anthropic");
        expect(seen.settings?.apiKey).toBe("sk-ant-new-key-123456");
    });

    test("nothing is saved by a check", async () => {
        const settings = testSettings({ YUVI_LLM: "openrouter" });
        await verifyKey(settings, "gemini", "gemini-new-key-123456", fakeCore(() => "OK").make);
        expect(settings.hasKey("gemini")).toBe(false);
        expect(settings.llmProvider).toBe("openrouter");
    });

    test("provider failures come back as a kind the front end can word", async () => {
        const settings = testSettings();
        const cases: [string, string][] = [
            ["authentication_error: invalid x-api-key", "auth_rejected"],
            ["API key not valid. Please pass a valid API key.", "auth_rejected"],
            ["Your credit balance is too low to access the Anthropic API", "no_credits"],
            ["The model `gpt-nope` does not exist or you do not have access to it.", "model_not_found"],
            ["The operation timed out.", "timeout"],
            ["fetch failed", "network"],
        ];
        for (const [message, kind] of cases) {
            expect(await verifyKey(settings, "anthropic", "sk-ant-key-123456", failing(message))).toEqual({ ok: false, kind } as never);
        }
    });
});
