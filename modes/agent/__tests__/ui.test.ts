import { describe, expect, test } from "bun:test";
import {
    AgentUI,
    colorizeDiff,
    describeToolCall,
    errorText,
    explainError,
    formatDuration,
    formatTokens,
    summarizeToolResult,
} from "../ui";
import { captureOutput, plain } from "./helpers";

describe("formatting", () => {
    test("tokens and durations", () => {
        expect(formatTokens(950)).toBe("950");
        expect(formatTokens(1500)).toBe("1.5k");
        expect(formatTokens(2_300_000)).toBe("2.3M");
        expect(formatDuration(4200)).toBe("4s");
        expect(formatDuration(125_000)).toBe("2m 5s");
    });

    test("errors become text", () => {
        expect(errorText(new Error("boom"))).toBe("boom");
        expect(errorText("plain")).toBe("plain");
        expect(errorText({ code: 1 })).toBe('{"code":1}');
    });

    test("a diff keeps its lines and drops the header noise", () => {
        const patch = "Index: a.ts\n===\n--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n same\n";
        expect(plain(colorizeDiff(patch))).toBe("--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n same");
        expect(plain(colorizeDiff(patch, 2))).toBe("--- a.ts\n+++ a.ts\n… 4 more diff lines");
    });
});

describe("tool calls in plain words", () => {
    test("each tool has a verb, a detail and a phase", () => {
        expect(describeToolCall("read_file", { path: "src/a.ts" })).toEqual({ verb: "Read", detail: "src/a.ts", phase: "Exploring" });
        expect(describeToolCall("grep", { pattern: "foo", path: "src" })).toEqual({ verb: "Search", detail: '"foo" in src', phase: "Exploring" });
        expect(describeToolCall("edit_file", { path: "a.ts" })).toEqual({ verb: "Edit", detail: "a.ts", phase: "Editing" });
        expect(describeToolCall("run_command", { command: "bun test" })).toEqual({ verb: "Run", detail: "bun test", phase: "Running" });
        expect(describeToolCall("task", { type: "reviewer", description: "check diff" })).toEqual({ verb: "Sub-agent (reviewer)", detail: "check diff", phase: "Exploring" });
        expect(describeToolCall("todo_write", {})).toEqual({ verb: "Update plan", detail: "", phase: "Planning" });
        expect(describeToolCall("mystery", { a: 1 })).toEqual({ verb: "mystery", detail: '{"a":1}', phase: "Thinking" });
    });

    test("results are summarised in one line", () => {
        expect(summarizeToolResult("read_file", "1\ta\n2\tb")).toBe("2 lines");
        expect(summarizeToolResult("read_file", "x\n\n[showing lines 5-9 of 40; pass offset to read more]")).toBe("lines 5-9 of 40");
        expect(summarizeToolResult("grep", "(no matches)")).toBe("(no matches)");
        expect(summarizeToolResult("grep", "a:1: x\nb:2: y")).toBe("2 matches");
        expect(summarizeToolResult("list_files", "a\nb\nc")).toBe("3 entries");
        expect(summarizeToolResult("run_command", "exit code 0 (1.2s)\noutput")).toBe("exit code 0 (1.2s)");
        expect(summarizeToolResult("todo_write", "Plan saved")).toBe("");
        expect(summarizeToolResult("task", "a\nb")).toBe("2 lines of findings");
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
});

describe("the agent screen", () => {
    test("a recorded run prints the same lines", async () => {
        const screen = await captureOutput(() => {
            const ui = new AgentUI();
            ui.startRun({ inputTokens: 0, outputTokens: 0, lastInputTokens: 0, cost: 0 }, 120_000);
            ui.setPhase("Sizing up the task");
            ui.print("  ◇ Making a small change");
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
            ui.errorBox("429 Too Many Requests");
            ui.endRun();
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
});
