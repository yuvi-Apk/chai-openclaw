import { describe, expect, test } from "bun:test";
import { profileFor } from "../../../core/llm/profiles";
import { captureOutput, createRecordingHost, plain } from "../../../core/testing";
import { AgentOutput } from "../../../modes/agent/output";
import { explainError } from "../errors";
import { mentionAtEnd, rankPaths } from "../input";
import { confirmChanges } from "../prompts";
import { TerminalRenderer } from "../renderer";
import { StreamPrinter } from "../stream-printer";
import { colorizeDiff, styled } from "../style";

describe("styling", () => {
    test("a diff keeps its lines and drops the header noise", () => {
        const patch = "Index: a.ts\n===\n--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n same\n";
        expect(plain(colorizeDiff(patch))).toBe("--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n same");
        expect(plain(colorizeDiff(patch, 2))).toBe("--- a.ts\n+++ a.ts\n… 4 more diff lines");
    });

    test("a styled line keeps its words", () => {
        expect(plain(styled("plain"))).toBe("plain");
        expect(plain(styled([{ text: "●", tone: "accent" }, " ", { text: "Verify", tone: "strong" }, " bun test"]))).toBe("● Verify bun test");
    });
});

describe("errors in plain words", () => {
    const cases: Array<[string, string]> = [
        ["No auth credentials found", "Your OpenRouter key is missing or not accepted."],
        ["Invalid API key provided", "OpenRouter did not accept your API key."],
        ["402 Payment Required", "Your OpenRouter account has no credits left for this model."],
        ["429 Too Many Requests", "The AI service is busy or you hit its rate limit."],
        ["No endpoints found that support tool use", "This AI model cannot use tools, so it cannot work as an agent."],
        ["foo/bar is not a valid model ID", "The AI model name was not found."],
        ["maximum context length exceeded", "The conversation became too long for this model."],
        ["fetch failed", "Could not reach the AI service."],
        ["The operation timed out", "The AI service took too long to answer."],
        ["503 Service Unavailable", "The AI service had a problem on its side."],
        ["something odd", "Something went wrong while talking to the AI."],
    ];

    test.each(cases)("%s", (raw, problem) => {
        const explained = explainError(raw);
        expect(explained.problem).toBe(problem);
        expect(explained.fix.length).toBeGreaterThan(10);
    });

    test("advice names OpenAI and its pages when OpenAI is in use", () => {
        const openai = profileFor("openai");
        expect(explainError("Incorrect API key provided", openai)).toEqual({
            problem: "OpenAI did not accept your API key.",
            fix: "Type / and choose “Set API key” and paste a fresh key from https://platform.openai.com/api-keys",
        });
        const noCredit = explainError("You exceeded your current quota", openai);
        expect(noCredit.problem).toBe("Your OpenAI account has no credits left for this model.");
        expect(noCredit.fix).toContain("platform.openai.com");
        expect(noCredit.fix).not.toContain("openrouter");
    });
});

describe("the agent on screen", () => {
    test("a recorded run prints the same lines as before the refactor", async () => {
        const screen = await captureOutput(() => {
            const renderer = new TerminalRenderer();
            const ui = new AgentOutput(createRecordingHost({ onEvent: (event) => renderer.render(event) }));
            renderer.startRun();
            ui.startRun({ inputTokens: 0, outputTokens: 0, lastInputTokens: 0, cost: 0 }, 120_000);
            ui.setPhase("Sizing up the task");
            ui.line({ text: "  ◇ Making a small change", tone: "dim" });
            ui.handlePart({ type: "start-step" });
            ui.handlePart({ type: "reasoning-delta", text: "I should read the file first.\n" });
            ui.handlePart({ type: "reasoning-end" });
            ui.handlePart({ type: "tool-call", toolName: "read_file", toolCallId: "1", input: { path: "src/a.ts" } });
            ui.handlePart({ type: "tool-result", toolName: "read_file", toolCallId: "1", output: "1\ta\n2\tb" });
            ui.handlePart({ type: "tool-call", toolName: "grep", toolCallId: "2", input: { pattern: "foo" } });
            ui.handlePart({ type: "tool-call", toolName: "edit_file", toolCallId: "3", input: { path: "src/a.ts" } });
            ui.handlePart({ type: "tool-result", toolName: "grep", toolCallId: "2", output: "a:1: foo" });
            ui.handlePart({ type: "tool-error", toolName: "edit_file", toolCallId: "3", error: new Error("old_string was not found") });
            ui.handlePart({ type: "tool-call", toolName: "todo_write", toolCallId: "4", input: {} });
            ui.showTodos([
                { content: "read", status: "completed" },
                { content: "edit", status: "in_progress" },
                { content: "verify", status: "pending" },
            ]);
            ui.handlePart({ type: "finish-step" });
            ui.handlePart({ type: "start-step" });
            ui.handlePart({ type: "text-delta", text: "Done.\n\nI changed one line." });
            ui.handlePart({ type: "text-end" });
            ui.handlePart({ type: "finish-step" });
            ui.subLine("explorer#1", "Read src/b.ts");
            ui.note("Verification failed.");
            ui.success("Saved 1 file: src/a.ts");
            ui.failure("Could not save a file: x");
            ui.error("429 Too Many Requests");
            renderer.endRun();
        });

        expect(screen.split("\n")).toEqual([
            "  ◇ Making a small change",
            "  ✻ thinking",
            "  │ I should read the file first.",
            "● Read src/a.ts",
            "  ⎿ 2 lines",
            '● Search "foo"',
            "● Edit src/a.ts",
            '  ⎿ Search "foo": 1 matches',
            "  ⎿ Edit src/a.ts: old_string was not found",
            "  Plan (1/3)",
            "  ☑ read",
            "  ▶ edit",
            "  ☐ verify",
            "",
            "Done.",
            "",
            "I changed one line.",
            "  ⎿ explorer#1 Read src/b.ts",
            "◆ Verification failed.",
            "✓ Saved 1 file: src/a.ts",
            "✗ Could not save a file: x",
            "",
            "✗ The AI service is busy or you hit its rate limit.",
            "  What to do: Wait a minute and send your message again. Free models have low limits; a paid model is more reliable.",
            "  Technical detail: 429 Too Many Requests",
            "",
        ]);
    });

    test("chat events: sources, a question back, a summary and an error hint", async () => {
        const screen = await captureOutput(() => {
            const renderer = new TerminalRenderer();
            renderer.render({ type: "token", text: "Node 26 is current [1]." });
            renderer.render({ type: "token", text: "", end: true });
            renderer.render({ type: "answer", text: "Node 26 is current [1].", kind: "answer" });
            renderer.render({ type: "sources", items: [{ n: 1, title: "Node.js", url: "https://nodejs.org", date: "2026-10-01" }] });
            renderer.render({ type: "summary", parts: ["from the web · 1 source", "1 model call", "4s"] });
            renderer.render({ type: "answer", text: "Which Jaguar?", kind: "clarify" });
            renderer.render({ type: "error", message: "fetch failed", hint: "In chat: /key sets the API key." });
        });
        expect(screen.split("\n")).toEqual([
            "",
            "Node 26 is current [1].",
            "",
            "Sources",
            "  [1] Node.js · 2026-10-01",
            "      https://nodejs.org",
            "",
            "  from the web · 1 source · 1 model call · 4s",
            "? Which Jaguar?",
            "",
            "✗ Could not reach the AI service.",
            "  What to do: Check your internet connection and send your message again.",
            "  Technical detail: fetch failed",
            "  In chat: /key sets the API key.",
            "",
        ]);
    });
});

describe("approving changes", () => {
    const groups = [
        { id: "0", label: "a.ts (file_create)", patch: "--- a.ts\n+++ a.ts\n+new\n" },
        { id: "1", label: "Create folder: lib", patch: null },
    ];

    test("auto-approve accepts everything and still shows the changes", async () => {
        let approved: string[] = [];
        const screen = await captureOutput(async () => {
            approved = (await confirmChanges({ kind: "changes", groups, auto: true })).approved;
        });
        expect(approved).toEqual(["0", "1"]);
        expect(screen).toContain("yuvi wants to make 2 changes. Nothing is saved yet:");
        expect(screen).toContain("▌ a.ts (file_create)");
        expect(screen).toContain("+new");
    });

    test("without a terminal everything is rejected", async () => {
        let approved = ["x"];
        const screen = await captureOutput(async () => {
            approved = (await confirmChanges({ kind: "changes", groups, auto: false })).approved;
        });
        expect(approved).toEqual([]);
        expect(screen).toContain("No interactive terminal: staged changes were not applied.");
    });
});

describe("input box helpers", () => {
    test("an @mention at the end of the line is found", () => {
        expect(mentionAtEnd("look at @src/a")).toEqual({ start: 9, query: "src/a" });
        expect(mentionAtEnd("@")).toEqual({ start: 1, query: "" });
        expect(mentionAtEnd("mail me@host")).toBeNull();
        expect(mentionAtEnd("@done then more")).toBeNull();
    });

    test("paths are ranked: prefix, file name, contains, letters in order", () => {
        const paths = ["modes/", "modes/agent/orchestrator.ts", "modes/agent/ui.ts", "index.ts", "docs/index.md"];
        expect(rankPaths(paths, "")).toEqual(["index.ts", "docs/index.md", "modes/", "modes/agent/orchestrator.ts", "modes/agent/ui.ts"]);
        expect(rankPaths(paths, "index")).toEqual(["index.ts", "docs/index.md"]);
        expect(rankPaths(paths, "orch")).toEqual(["modes/agent/orchestrator.ts"]);
        expect(rankPaths(paths, "mui")).toEqual(["modes/agent/ui.ts"]);
        expect(rankPaths(paths, "zzz")).toEqual([]);
    });
});

describe("stream printer", () => {
    /** Feed text in small pieces, as a model stream would. */
    const run = (text: string) => {
        const printed: string[] = [];
        const printer = new StreamPrinter((rendered) => printed.push(plain(rendered)));
        for (const piece of text.match(/.{1,3}/gs) ?? []) printer.push(piece);
        return { printed, printer };
    };

    test("prints each paragraph as soon as it is complete", () => {
        const { printed, printer } = run("First paragraph.\n\nSecond paragraph.\n\nThird");
        expect(printed).toHaveLength(2);
        expect(printed[0]).toContain("First paragraph.");
        printer.end();
        expect(printed).toHaveLength(3);
    });

    test("keeps a spaced-out list in one block", () => {
        const { printed, printer } = run("Steps:\n\n1. one\n\n2. two\n\n3. three\n\nDone.");
        printer.end();
        const list = printed.find((w) => w.includes("one"))!;
        expect(list).toContain("two");
        expect(list).toContain("three");
    });

    test("never splits a code block at a blank line", () => {
        const { printed, printer } = run("Code:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.");
        printer.end();
        const code = printed.find((w) => w.includes("const a"))!;
        expect(code).toContain("const b");
    });

    test("prints nothing for an empty answer", () => {
        const { printed, printer } = run("");
        printer.end();
        expect(printed).toHaveLength(0);
    });
});
