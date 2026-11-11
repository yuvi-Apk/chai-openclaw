/** The Telegram ModeHost on its own: questions to the user and the shape of a turn in the chat. */
import { describe, expect, test } from "bun:test";
import { createCore } from "../../../core/compose";
import { nullLogger } from "../../../core/log";
import { testSettings } from "../../../core/testing";
import { TelegramHost } from "../host";
import { Questions } from "../questions";
import { ChatMessenger } from "../view/messenger";
import { FakeClock, FakeTelegramApi, settle } from "./fakes";

const CHAT = 5;
const TEN_MINUTES = 10 * 60_000;

function setup() {
    const api = new FakeTelegramApi();
    const clock = new FakeClock();
    const questions = new Questions(clock, TEN_MINUTES);
    const messenger = new ChatMessenger(api, CHAT, () => [], nullLogger, clock);
    const host = new TelegramHost({ core: createCore(testSettings()), grants: [], workspace: ".", messenger, questions, clock });
    const press = async (label: string) => {
        await settle();
        const data = api.button(label);
        if (!data) throw new Error(`no button "${label}" in: ${api.transcript()}`);
        questions.press(CHAT, data);
        await settle();
    };
    return { api, clock, questions, host, press };
}

describe("confirming a shell command", () => {
    const request = { kind: "command" as const, command: "bun add <left-pad>", rememberAs: "bun add" };

    test("Run approves once; the command is shown escaped", async () => {
        const { api, host, press } = setup();
        const reply = host.confirm(request);
        await press("Run");
        expect(await reply).toEqual({ approved: ["run"] });
        expect(api.last()!.text).toContain("<pre>bun add &lt;left-pad&gt;</pre>\n▶ Running.");
        expect(api.last()!.options.keyboard).toBeUndefined();
    });

    test("“Always allow” approves and remembers; “Don't run” refuses", async () => {
        const first = setup();
        const always = first.host.confirm(request);
        await first.press("Always allow “bun add”");
        expect(await always).toEqual({ approved: ["run"], remember: true });

        const second = setup();
        const refused = second.host.confirm(request);
        await second.press("Don't run");
        expect(await refused).toEqual({ approved: [] });
        expect(second.api.last()!.text).toContain("✋ Not run.");
    });

    test("a chained command gets no “always” button", async () => {
        const { api, host } = setup();
        void host.confirm({ kind: "command", command: "rm -rf build && bun test" });
        await settle();
        expect(api.keyboards()[0]!.flat().map((b) => b.text)).toEqual(["▶ Run", "✋ Don't run"]);
    });

    test("no answer within ten minutes means no", async () => {
        const { api, clock, host } = setup();
        const reply = host.confirm(request);
        await settle();
        await clock.advance(TEN_MINUTES);
        expect(await reply).toEqual({ approved: [] });
        expect(api.last()!.text).toContain("No answer, so nothing was accepted.");
    });

    test("when the question cannot be shown, the answer is no", async () => {
        const { api, host } = setup();
        api.onWrite = () => {
            throw new Error("network down");
        };
        expect(await host.confirm(request)).toEqual({ approved: [] });
    });
});

describe("confirming file changes", () => {
    const groups = [
        { id: "0", label: "a.ts (file_modify)", patch: "--- a.ts\n+++ a.ts\n-old\n+new" },
        { id: "1", label: "b.ts (file_create)", patch: "--- b.ts\n+++ b.ts\n+hello" },
        { id: "2", label: "Create folder: lib", patch: null },
    ];

    test("Pick files lets the user drop some changes before Done", async () => {
        const { api, host, press } = setup();
        const reply = host.confirm({ kind: "changes", groups, auto: false });
        await press("Pick files");
        expect(api.keyboards().pop()!.flat().map((b) => b.text)).toEqual(["✅ a.ts (file_modify)", "✅ b.ts (file_create)", "✅ Create folder: lib", "Done"]);
        await press("b.ts");
        expect(api.keyboards().pop()!.flat().map((b) => b.text)[1]).toBe("⬜ b.ts (file_create)");
        await press("Done");
        expect(await reply).toEqual({ approved: ["0", "2"] });
        expect(api.last()!.text).toBe("✅ Approved 2 of 3.");
    });

    test("Auto mode shows the diffs and accepts them without asking", async () => {
        const { api, host } = setup();
        expect(await host.confirm({ kind: "changes", groups, auto: true })).toEqual({ approved: ["0", "1", "2"] });
        expect(api.texts()).toHaveLength(3);
        expect(api.keyboards()).toEqual([]);
    });

    test("a long diff is cut, and the whole patch can be fetched as a file", async () => {
        const { api, host, press } = setup();
        const patch = Array.from({ length: 200 }, (_, i) => `+line ${i}`).join("\n");
        const reply = host.confirm({ kind: "changes", groups: [{ id: "0", label: "big.ts", patch }], auto: false });
        await settle();
        expect(api.texts()[0]).toContain("… 160 more lines");
        expect(api.texts()[0]).not.toContain("line 150");
        await press("Full diff as a file");
        expect(api.documents[0]!.name).toBe("changes.patch");
        expect(new TextDecoder().decode(api.documents[0]!.data)).toContain("+line 199");
        await press("Reject all");
        expect(await reply).toEqual({ approved: [] });
    });

    test("no answer means nothing is approved", async () => {
        const { clock, host } = setup();
        const reply = host.confirm({ kind: "changes", groups, auto: false });
        await settle();
        await clock.advance(TEN_MINUTES);
        expect(await reply).toEqual({ approved: [] });
    });
});

describe("choose and ask", () => {
    test("choose shows the options with hints and returns the pressed one", async () => {
        const { api, host, press } = setup();
        const picked = host.choose("Which mode?", [{ value: "ask", label: "Ask mode", hint: "I ask first" }, { value: "auto", label: "Auto mode" }], "ask");
        await settle();
        expect(api.last()!.text).toBe("<b>Which mode?</b>\n• <b>Ask mode</b>: I ask first");
        expect(api.keyboards()[0]!.flat().map((b) => b.text)).toEqual(["● Ask mode", "Auto mode"]);
        await press("Auto mode");
        expect(await picked).toBe("auto");
        expect(api.last()!.text).toBe("<b>Which mode?</b>\n→ Auto mode");
    });

    test("ask returns the next message, or null when nobody answers", async () => {
        const { clock, questions, host } = setup();
        const answer = host.ask("Which file?");
        await settle();
        questions.offerText(CHAT, "  src/app.ts ");
        expect(await answer).toBe("src/app.ts");

        const silent = host.ask("Which file?");
        await settle();
        await clock.advance(TEN_MINUTES);
        expect(await silent).toBeNull();
    });
});

describe("a turn in the chat", () => {
    test("activity is one message that is redrawn; the answer is a new message", async () => {
        const { api, clock, host } = setup();
        host.beginTurn();
        host.emit({ type: "status", text: "Reading" });
        host.emit({ type: "tool", phase: "call", id: "1", title: "Read", detail: "a.ts" });
        await clock.advance(0);
        host.emit({ type: "tool", phase: "result", id: "1", summary: "9 lines" });
        host.emit({ type: "token", text: "It exports `a`." });
        await clock.advance(2000);
        expect(api.messages).toHaveLength(1);
        expect(api.last()!.text).toContain("⏳ <b>Reading…</b>");

        await host.endTurn(false);
        expect(api.texts()).toHaveLength(2);
        expect(api.texts()[0]).toStartWith("✓ <b>Done</b>");
        expect(api.texts()[0]).toContain("● <b>Read</b> a.ts\n  ⎿ 9 lines");
        expect(api.texts()[1]).toBe("It exports <code>a</code>.");
        expect(api.messages[0]!.options.silent).toBe(true);
        expect(api.messages[1]!.options.silent).toBeFalsy();
    });

    test("a long remark before more work is sent in order, and the activity continues below it", async () => {
        const { api, clock, host } = setup();
        const remark = "First I will explain the plan. ".repeat(20).trim();
        host.beginTurn();
        host.emit({ type: "tool", phase: "call", id: "1", title: "Read", detail: "a.ts" });
        await clock.advance(0);
        host.emit({ type: "token", text: remark });
        host.emit({ type: "tool", phase: "call", id: "2", title: "Edit", detail: "a.ts" });
        await clock.advance(2000);
        host.emit({ type: "token", text: "Done." });
        await host.endTurn(false);

        const texts = api.texts();
        expect(texts).toHaveLength(4);
        expect(texts[0]).toStartWith("▸ <b>Steps so far</b>");
        expect(texts[0]).toContain("● <b>Read</b> a.ts");
        expect(texts[1]).toBe(remark);
        expect(texts[2]).toStartWith("✓ <b>Done</b>");
        expect(texts[2]).toContain("● <b>Edit</b> a.ts");
        expect(texts[2]).not.toContain("Read");
        expect(texts[3]).toBe("Done.");
    });

    test("a stopped turn with nothing to say reports that it stopped", async () => {
        const { api, host } = setup();
        host.beginTurn();
        host.emit({ type: "status", text: "Thinking" });
        await host.endTurn(true);
        expect(api.texts()).toEqual(["■ Stopped."]);
    });

    test("output from a command, outside a turn, is sent as it comes", async () => {
        const { api, host } = setup();
        host.emit({ type: "notice", level: "success", text: "New conversation started." });
        host.emit({ type: "line", line: [{ text: "Used", tone: "strong" }, " 5 tokens"] });
        await host.settled();
        expect(api.texts()).toEqual(["✓ New conversation started.", "<b>Used</b> 5 tokens"]);
    });
});
