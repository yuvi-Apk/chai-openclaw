import { describe, expect, test } from "bun:test";
import { createRecordingHost } from "../../../core/testing";
import { AgentOutput, describeToolCall, summarizeToolResult } from "../output";

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

describe("agent activity as mode events", () => {
    test("a model stream becomes steps, tool events, tokens and a final answer", () => {
        const host = createRecordingHost();
        const ui = new AgentOutput(host);
        ui.startRun({ inputTokens: 900, outputTokens: 100, lastInputTokens: 600, cost: 0 }, 1200);
        ui.handlePart({ type: "start-step" });
        ui.handlePart({ type: "tool-call", toolName: "read_file", toolCallId: "1", input: { path: "a.ts" } });
        ui.handlePart({ type: "tool-result", toolName: "read_file", toolCallId: "1", output: "1\tx" });
        ui.handlePart({ type: "tool-result", toolName: "read_file", toolCallId: "1", output: "partial", preliminary: true });
        ui.handlePart({ type: "tool-call", toolName: "todo_write", toolCallId: "2", input: {} });
        ui.handlePart({ type: "finish-step" });
        ui.handlePart({ type: "start-step" });
        ui.handlePart({ type: "text-delta", text: "All " });
        ui.handlePart({ type: "text-delta", text: "done." });
        ui.handlePart({ type: "text-end" });
        ui.handlePart({ type: "finish-step" });
        ui.turnSummary({ inputTokens: 0, outputTokens: 0, lastInputTokens: 0, cost: 0.5 }, 1500, 2);

        expect(host.of("usage")[0]).toEqual({ type: "usage", tokens: 1000, contextPercent: 50 });
        expect(host.of("status").map((e) => e.text)).toEqual(["Thinking", "Thinking", "Exploring", "Planning", "Thinking", "Writing"]);
        expect(host.of("tool")).toEqual([
            { type: "tool", phase: "call", id: "1", title: "Read", detail: "a.ts" },
            { type: "tool", phase: "result", id: "1", summary: "1 lines" },
            { type: "tool", phase: "call", id: "2", title: "Update plan", detail: "", silent: true },
        ]);
        expect(host.answerText()).toBe("All done.");
        expect(host.of("answer")).toEqual([{ type: "answer", text: "All done.", kind: "answer" }]);
        expect(host.of("summary")[0]!.parts).toEqual(["2 steps", "0s", "1.5k tokens", "$0.5000 session"]);
    });
});
