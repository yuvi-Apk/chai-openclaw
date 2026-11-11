/**
 * Proof that the design holds: every registered mode runs through the same
 * contract with a front end that has no screen, modes only get the tools
 * they declared, and providers are swapped by configuration.
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCore } from "../../core/compose";
import { Settings } from "../../core/config";
import { ToolError } from "../../core/errors";
import { fileLogger } from "../../core/log";
import { grantTools, ModeRegistry, type Mode } from "../../core/mode";
import type { SearchProvider } from "../../core/search/types";
import { createRecordingHost, FakeLLM, testSettings } from "../../core/testing";
import { chatMode } from "../chat/mode";
import { echoMode } from "../echo/mode";
import { modes } from "../index";

const signal = () => new AbortController().signal;

const fakeSearch = (name = "fake"): SearchProvider & { queries: string[] } => {
    const queries: string[] = [];
    return {
        name,
        queries,
        search: async (query) => {
            queries.push(query);
            return [{ title: "Node.js releases", url: "https://nodejs.org/releases", snippet: "Node.js 26 is the latest LTS release." }];
        },
    };
};

describe("the mode registry", () => {
    test("modes are listed in order, hidden ones only on request", () => {
        expect(modes.list().map((m) => m.name)).toEqual(["agent", "plan", "chat"]);
        expect(modes.list({ includeHidden: true }).map((m) => m.name)).toEqual(["agent", "plan", "chat", "echo"]);
        expect(modes.get("chat")).toBe(chatMode);
        expect(modes.get("nope")).toBeUndefined();
    });

    test("a mode is one object and one register() call", () => {
        const custom: Mode = { ...echoMode, name: "custom", hidden: false };
        const registry = new ModeRegistry().register(custom);
        expect(registry.list()).toEqual([custom]);
        expect(() => registry.register(custom)).toThrow('Mode "custom" is already registered.');
    });

    test("every mode declares its tools, and only those", () => {
        const tools = Object.fromEntries(modes.list({ includeHidden: true }).map((m) => [m.name, [...m.tools]]));
        expect(tools).toEqual({
            agent: ["fs.read", "fs.write", "shell"],
            plan: ["fs.read", "fs.write", "shell"],
            chat: ["web.search", "web.fetch"],
            echo: [],
        });
    });
});

describe("tool permissions", () => {
    test("a mode cannot reach a tool it did not declare", () => {
        const core = createCore(testSettings(), { llm: new FakeLLM(() => "x"), search: fakeSearch() });
        const forEcho = grantTools(core, "echo", echoMode.tools);
        expect(() => forEcho.search).toThrow(ToolError);
        expect(() => forEcho.pages).toThrow('Mode "echo" did not declare the "web.fetch" permission.');
        expect(forEcho.llm).toBe(core.llm);

        const forChat = grantTools(core, "chat", chatMode.tools);
        expect(forChat.search.name).toBe("fake");
    });
});

describe("chat mode through a front end without a screen", () => {
    const chatHost = (llm: FakeLLM, search = fakeSearch()) => {
        const core = createCore(testSettings(), { llm, search });
        return { host: createRecordingHost({ core, modeName: "chat", grants: chatMode.tools }), search };
    };

    test("a stable question is answered from the model", async () => {
        const { host, search } = chatHost(new FakeLLM(() => "Recursion is a function calling itself."));
        await chatMode.createSession(host).handle("explain recursion", { signal: signal() });

        expect(search.queries).toEqual([]);
        expect(host.answerText()).toBe("Recursion is a function calling itself.");
        expect(host.of("answer")).toEqual([{ type: "answer", text: "Recursion is a function calling itself.", kind: "answer" }]);
        expect(host.of("sources")).toEqual([]);
        expect(host.of("summary")[0]!.parts.slice(0, 2)).toEqual(["from the model", "1 model call"]);
    });

    test("a fresh-facts question is searched and cited", async () => {
        const { host, search } = chatHost(new FakeLLM(() => "Node.js 26 is the latest LTS [1]."));
        await chatMode.createSession(host).handle("what is the latest version of Node.js?", { signal: signal() });

        expect(search.queries.length).toBeGreaterThan(0);
        expect(host.of("status").map((e) => e.text)).toContain("Searching (1 query)");
        expect(host.of("sources")[0]!.items).toEqual([
            { n: 1, title: "Node.js releases", url: "https://nodejs.org/releases" },
        ]);
        expect(host.of("summary")[0]!.parts[0]).toBe("from the web · 1 source");
    });

    test("commands: /search arms or answers, /new and /sources report", async () => {
        const { host, search } = chatHost(new FakeLLM(() => "Answer [1]."));
        const session = chatMode.createSession(host);
        const command = (name: string) => session.commands().find((c) => c.name === name)!;

        expect(await command("/search").run("")).toBeUndefined();
        expect(session.status().detail).toBe("next answer: web search");
        expect(await command("/nosearch").run("explain recursion")).toEqual({ submit: "explain recursion" });
        await session.handle("explain recursion", { signal: signal() });
        expect(search.queries).toEqual([]);
        expect(session.status().detail).toBe("");

        await command("/sources").run("");
        await command("/new").run("");
        expect(host.messages()).toEqual(expect.arrayContaining(["No web sources yet in this conversation.", "New conversation started."]));
    });

    test("a failure becomes an error event with keys hidden", async () => {
        const secret = "sk-or-very-secret-key-000111";
        const llm = new FakeLLM(() => {
            throw new Error(`401 No auth credentials found (${secret})`);
        });
        const core = createCore(new Settings({ OPENROUTER_API_KEY: secret }, null), { llm, search: fakeSearch() });
        const host = createRecordingHost({ core, modeName: "chat", grants: chatMode.tools });
        await chatMode.createSession(host).handle("explain recursion", { signal: signal() });
        const [error] = host.of("error");
        expect(error!.message).toContain("No auth credentials");
        expect(error!.message).not.toContain(secret);
        expect(error!.hint).toContain("/key");
    });

    test("two sessions do not share a conversation", async () => {
        const llm = new FakeLLM((request) => `turns seen: ${request.messages.length}`);
        const core = createCore(testSettings(), { llm, search: fakeSearch() });
        const first = createRecordingHost({ core, grants: chatMode.tools });
        const second = createRecordingHost({ core, grants: chatMode.tools });
        const a = chatMode.createSession(first);
        const b = chatMode.createSession(second);
        await a.handle("explain recursion", { signal: signal() });
        await a.handle("explain iteration", { signal: signal() });
        await b.handle("explain recursion", { signal: signal() });
        expect(first.of("answer").map((e) => e.text)).toEqual(["turns seen: 1", "turns seen: 3"]);
        expect(second.of("answer").map((e) => e.text)).toEqual(["turns seen: 1"]);
    });
});

describe("echo mode: the example for adding a mode", () => {
    test("it runs through the same contract with no tools at all", async () => {
        const host = createRecordingHost({ grants: echoMode.tools });
        const session = echoMode.createSession(host);
        await session.handle("hello", { signal: signal() });
        await session.commands()[0]!.run("");
        expect(host.answerText()).toBe("You said: hello");
        expect(host.messages()).toEqual(["Echoed 1 so far."]);
        await session.close();
    });
});

describe("swapping providers by configuration", () => {
    test("another search engine is one adapter, one registry entry and one setting", async () => {
        const brave = fakeSearch("brave");
        const core = createCore(testSettings({ YUVI_SEARCH: "brave" }), {
            llm: new FakeLLM(() => "Node.js 26 [1]."),
            searchProviders: { brave: () => brave },
        });
        const host = createRecordingHost({ core, grants: chatMode.tools });
        await chatMode.createSession(host).handle("what is the latest version of Node.js?", { signal: signal() });
        expect(brave.queries.length).toBeGreaterThan(0);
        expect(host.of("sources")).toHaveLength(1);
    });

    test("another model provider is one registry entry and one setting", () => {
        const built: string[] = [];
        const core = createCore(testSettings({ YUVI_LLM: "local", OPENROUTER_DEFAULT_MODEL: "tiny-1" }), {
            llmProviders: {
                local: () => (modelId) => {
                    built.push(modelId);
                    return { modelId } as never;
                },
            },
        });
        core.models.forRole("main");
        core.models.byId("other");
        expect(built).toEqual(["tiny-1", "other"]);
    });
});

describe("the opt-in log file", () => {
    test("events are written as redacted JSON lines", () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-log-")), "logs", "test.jsonl");
        const log = fileLogger(file, () => ["hunter2-hunter2"]);
        log.event("llm.call", { model: "m", inputTokens: 10, note: "key hunter2-hunter2 mail a@b.co" });
        log.event("turn.end");

        const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({ event: "llm.call", model: "m", inputTokens: 10, note: "key [redacted] mail [redacted]" });
        expect(lines[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(lines[1].event).toBe("turn.end");
        fs.rmSync(path.dirname(path.dirname(file)), { recursive: true, force: true });
    });

    test("logging is off unless YUVI_LOG is set", () => {
        expect(testSettings().logEnabled).toBe(false);
        expect(testSettings({ YUVI_LOG: "1" }).logEnabled).toBe(true);
    });
});
