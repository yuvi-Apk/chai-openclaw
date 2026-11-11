/** How text and turns are turned into Telegram messages. No network, no clock. */
import { describe, expect, test } from "bun:test";
import type { ModeEvent } from "../../../core/mode";
import { escapeHtml, lineHtml, linesHtml, markdownToHtml, MESSAGE_MAX_CHARS, packBlocks, stripHtml } from "../view/html";
import { TurnView } from "../view/turn-view";

describe("telegram html", () => {
    test("escapes the characters Telegram treats as markup", () => {
        expect(escapeHtml("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
        expect(stripHtml("<b>a &lt; b</b> &amp; c")).toBe("a < b & c");
    });

    test("markdown becomes the tags Telegram supports", () => {
        const html = markdownToHtml("# Title\n\nSome **bold**, *soft* and `x < 1` with a [link](https://example.com/a?b=1&c=2).").join("\n");
        expect(html).toContain("<b>Title</b>");
        expect(html).toContain("<b>bold</b>");
        expect(html).toContain("<i>soft</i>");
        expect(html).toContain("<code>x &lt; 1</code>");
        expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2">link</a>');
    });

    test("a code block keeps its language and is escaped once", () => {
        const [block] = markdownToHtml("```ts\nif (a < b) {}\n```");
        expect(block).toBe('<pre><code class="language-ts">if (a &lt; b) {}</code></pre>');
    });

    test("lists, task lists and tables stay readable", () => {
        expect(markdownToHtml("- one\n- two\n  - inner")[0]).toBe("• one\n• two\n  • inner");
        expect(markdownToHtml("1. first\n2. second")[0]).toBe("1. first\n2. second");
        expect(markdownToHtml("- [x] done\n- [ ] open")[0]).toBe("☑ done\n☐ open");
        expect(markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |")[0]).toBe("<pre>a | b\n1 | 2</pre>");
    });

    test("raw html and unsafe links from a model are shown as text, never as markup", () => {
        const html = markdownToHtml('See [click](javascript:alert(1)) and <a href="x">y</a>\n\n<script>alert(1)</script>').join("\n");
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("<a ");
        expect(html).not.toContain("javascript:");
        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("See click and &lt;a href");
    });

    test("tones map to bold and italic; edge blank lines are dropped", () => {
        expect(lineHtml([{ text: "Ask <mode>", tone: "strong" }, " — ", { text: "safe", tone: "dim" }])).toBe(
            "<b>Ask &lt;mode&gt;</b> — <i>safe</i>",
        );
        expect(linesHtml(["", "  hello", "", "world", ""])).toBe("  hello\n\nworld");
    });

    test("blocks are packed into messages under the limit without cutting a tag", () => {
        const blocks = Array.from({ length: 30 }, (_, i) => `<b>block ${i}</b> ${"x".repeat(300)}`);
        const messages = packBlocks(blocks);
        expect(messages.length).toBeGreaterThan(1);
        for (const message of messages) {
            expect(message.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
            expect((message.match(/<b>/g) ?? []).length).toBe((message.match(/<\/b>/g) ?? []).length);
        }
        expect(messages.join("\n\n")).toBe(blocks.join("\n\n"));
    });

    test("one oversized code block is split into several code blocks", () => {
        const code = Array.from({ length: 400 }, (_, i) => `const line${i} = a < b;`).join("\n");
        const messages = packBlocks(markdownToHtml("```\n" + code + "\n```"));
        expect(messages.length).toBeGreaterThan(1);
        for (const message of messages) {
            expect(message.startsWith("<pre>")).toBe(true);
            expect(message.endsWith("</pre>")).toBe(true);
            expect(message.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS + 100);
        }
        expect(messages.map(stripHtml).join("\n")).toBe(code);
    });
});

const apply = (view: TurnView, events: ModeEvent[]) => events.forEach((event) => view.apply(event));
const running = { showThinking: true, elapsedMs: 4000 };

describe("the turn view", () => {
    test("the activity shows status, steps and tool calls with their results", () => {
        const view = new TurnView();
        apply(view, [
            { type: "status", text: "Reading" },
            { type: "step", phase: "start" },
            { type: "tool", phase: "call", id: "1", title: "Read", detail: "src/<app>.ts" },
            { type: "tool", phase: "result", id: "1", summary: "2 lines" },
            { type: "usage", tokens: 1500, contextPercent: 3 },
        ]);
        const html = view.activityHtml(running);
        expect(html).toContain("⏳ <b>Reading…</b> · 4s · 1 step · 1.5k tok · ctx 3%");
        expect(html).toContain("● <b>Read</b> src/&lt;app&gt;.ts\n  ⎿ 2 lines");
    });

    test("thinking is folded when shown, and absent when hidden", () => {
        const view = new TurnView();
        apply(view, [{ type: "reasoning", text: "The user wants <x>. " }, { type: "reasoning", text: "I will read the file.", end: true }]);
        expect(view.activityHtml(running)).toContain(
            "<blockquote expandable>✻ <b>Thinking</b>\nThe user wants &lt;x&gt;. I will read the file.</blockquote>",
        );
        expect(view.activityHtml({ ...running, showThinking: false })).not.toContain("blockquote");
    });

    test("a silent tool call is not listed; an error result is marked", () => {
        const view = new TurnView();
        apply(view, [
            { type: "tool", phase: "call", id: "1", title: "Todo", detail: "", silent: true },
            { type: "tool", phase: "call", id: "2", title: "Run", detail: "bun test" },
            { type: "tool", phase: "error", id: "2", summary: "exit 1" },
        ]);
        const html = view.activityHtml(running);
        expect(html).not.toContain("Todo");
        expect(html).toContain("● <b>Run</b> bun test\n  ⎿ ✗ exit 1");
    });

    test("results of parallel calls name the call they belong to", () => {
        const view = new TurnView();
        apply(view, [
            { type: "tool", phase: "call", id: "1", title: "Read", detail: "a.ts" },
            { type: "tool", phase: "call", id: "2", title: "Read", detail: "b.ts" },
            { type: "tool", phase: "result", id: "1", summary: "5 lines" },
        ]);
        expect(view.activityHtml(running)).toContain("  ⎿ Read a.ts: 5 lines");
    });

    test("the plan is listed with done, current and open items", () => {
        const view = new TurnView();
        view.apply({
            type: "todos",
            items: [
                { content: "read", status: "completed" },
                { content: "edit", status: "in_progress" },
                { content: "test", status: "pending" },
            ],
        });
        expect(view.activityHtml(running)).toContain("📋 <b>Plan (1/3)</b>\n☑ <s>read</s>\n▶ <b>edit</b>\n☐ test");
    });

    test("only the newest steps are kept, with a count of the earlier ones", () => {
        const view = new TurnView();
        for (let i = 0; i < 40; i++) view.apply({ type: "notice", level: "note", text: `step ${i}` });
        const html = view.activityHtml(running);
        expect(html).toContain("… 26 earlier steps");
        expect(html).toContain("step 39");
        expect(html).not.toContain("step 3\n");
        expect(html.length).toBeLessThan(4096);
    });

    test("a short remark before a tool call stays in the activity; the last text is the answer", () => {
        const view = new TurnView();
        apply(view, [
            { type: "token", text: "Let me look." },
            { type: "tool", phase: "call", id: "1", title: "Read", detail: "a.ts" },
            { type: "token", text: "It exports **a**." },
        ]);
        expect(view.activityHtml(running)).toContain("💬 <i>Let me look.</i>");
        expect(view.finalBlocks()).toEqual(["It exports <b>a</b>."]);
    });

    test("a long remark is handed back so it can be sent as its own message", () => {
        const view = new TurnView();
        const long = "word ".repeat(100).trim();
        view.apply({ type: "token", text: long });
        expect(view.takeLongSaid()).toBe(long);
        expect(view.finalBlocks()).toEqual([]);
    });

    test("the final message has the answer, sources as links, errors and the cost line", () => {
        const view = new TurnView();
        apply(view, [
            { type: "token", text: "Bun is fast [1]." },
            { type: "sources", items: [{ n: 1, title: "Bun <docs>", url: "https://bun.sh/?a=1&b=2", date: "2026-01-02" }] },
            { type: "error", message: "429 rate limit" },
            { type: "summary", parts: ["searched", "2 calls"] },
        ]);
        const html = view.finalBlocks().join("\n\n");
        expect(html).toContain("Bun is fast [1].");
        expect(html).toContain('[1] <a href="https://bun.sh/?a=1&amp;b=2">Bun &lt;docs&gt;</a> · 2026-01-02');
        expect(html).toContain("✗ <b>The AI service is busy or you hit its rate limit.</b>");
        expect(html).toContain("<i>searched · 2 calls</i>");
    });

    test("a question back from the mode replaces the streamed text", () => {
        const view = new TurnView();
        apply(view, [{ type: "answer", text: "Which file do you mean?", kind: "clarify" }]);
        expect(view.finalBlocks()).toEqual(["Which file do you mean?"]);
    });

    test("the closing headers say how the turn ended", () => {
        const view = new TurnView();
        view.apply({ type: "step", phase: "start" });
        expect(view.activityHtml({ ...running, done: "finished" })).toStartWith("✓ <b>Done</b> · 4s · 1 step");
        expect(view.activityHtml({ ...running, done: "stopped" })).toStartWith("■ <b>Stopped</b>");
    });
});
