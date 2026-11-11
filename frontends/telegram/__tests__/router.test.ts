/**
 * End to end, without a network: updates go into the router, and the test
 * reads what lands in the chat. Real modes run behind it; the model is scripted.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { createCore } from "../../../core/compose";
import { Settings } from "../../../core/config";
import { modes } from "../../../modes";
import { FAKE_API_KEY, makeWorkspace, type Workspace } from "../../../modes/agent/__tests__/helpers";
import type { TgUpdate } from "../api/types";
import type { TelegramConfig } from "../config";
import { Router } from "../router";
import { FakeTelegramApi, instantClock, pressUpdate, textUpdate, until, USER_ID } from "./fakes";

const PIN = "482915";
type StreamPart = { type: string; [key: string]: unknown };

const usage = {
    inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 20, text: 20, reasoning: 0 },
};
const finish = (reason: "stop" | "tool-calls"): StreamPart => ({ type: "finish", usage, finishReason: { unified: reason, raw: reason } });
const toolCall = (id: string, toolName: string, input: object): StreamPart[] => [
    { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
    finish("tool-calls"),
];
const say = (text: string): StreamPart[] => [
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    finish("stop"),
];
const EDIT_SCRIPT = [
    toolCall("1", "read_file", { path: "src/app.ts" }),
    toolCall("2", "edit_file", { path: "src/app.ts", old_string: "a = 1", new_string: "a = 5" }),
    say("Changed `a` to 5."),
];

let ws: Workspace;
beforeEach(() => {
    ws = makeWorkspace({ "src/app.ts": "export const a = 1;\n", ".env": "SECRET=1\n" });
});
afterEach(() => ws.cleanup());

function setup(steps: StreamPart[][] = [], projects: TelegramConfig["projects"] = []) {
    let call = 0;
    const model = new MockLanguageModelV4({
        doStream: async () => ({ stream: convertArrayToReadableStream((steps[call++] ?? say("(script ended)")) as never) }),
    });
    const settings = new Settings(
        { ...process.env, YUVI_DEV: "1", YUVI_TRIAGE: "off", YUVI_SELF_REVIEW: "off", YUVI_LOG: "", OPENROUTER_API_KEY: FAKE_API_KEY },
        null,
    );
    const core = createCore(settings, { llmProviders: { openrouter: () => () => model } });
    const api = new FakeTelegramApi();
    const config: TelegramConfig = { token: "t", pin: PIN, users: new Set([USER_ID]), workspace: ws.root, projects, lockIdleMs: 900_000 };
    const router = new Router({ api, core, registry: modes, config, clock: instantClock });
    const send = (text: string, messageId = 1) => router.dispatch(textUpdate(text, { messageId }));
    const press = async (label: string) => {
        const data = await until(() => api.button(label), `button "${label}"`);
        await router.dispatch(pressUpdate(data));
    };
    const open = async (mode: string) => {
        await send(`/unlock ${PIN}`);
        await send(`/open ${mode}`);
    };
    return { api, router, model, send, press, open };
}

describe("who gets in", () => {
    test("strangers, groups and bots get no reply at all", async () => {
        const { api, router } = setup();
        await router.dispatch(textUpdate("/start", { userId: 999 }));
        await router.dispatch(textUpdate("/start", { chatType: "group" }));
        await router.dispatch({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: USER_ID, type: "private" }, from: { id: USER_ID, is_bot: true }, text: "/start" } });
        await router.dispatch(pressUpdate("c:/menu", 999));
        expect(api.messages).toEqual([]);
        expect(api.callbackAnswers).toEqual([]);
    });

    test("the bot starts locked: messages and commands go nowhere", async () => {
        const { api, send } = setup();
        await send("delete everything");
        await send("/open agent");
        expect(api.texts()).toEqual(["🔒 Locked. Send /unlock, then your PIN.", "🔒 Locked. Send /unlock, then your PIN."]);
    });

    test("unlocking: the PIN message is deleted, a wrong PIN is counted, the right one opens", async () => {
        const { api, send } = setup();
        await send("/unlock");
        await send("111111", 21);
        expect(api.deleted).toEqual([21]);
        expect(api.last()!.text).toBe("✗ Wrong PIN. 4 tries left. Send it again.");
        await send(PIN, 22);
        expect(api.deleted).toEqual([21, 22]);
        expect(api.last()!.text).toStartWith("🔓 Unlocked.");
        await send("/start");
        expect(api.last()!.text).toContain("What do you want to do?");
    });

    test("too many wrong PINs block further tries", async () => {
        const { api, send } = setup();
        for (let i = 0; i < 5; i++) await send("/unlock 000000");
        expect(api.last()!.text).toBe("✗ Too many wrong tries. Try again in 15m 0s.");
        await send(`/unlock ${PIN}`);
        expect(api.last()!.text).toStartWith("✗ Too many wrong tries.");
    });

    test("a button pressed while locked does nothing and stays valid", async () => {
        const { api, router, send, open } = setup();
        await open("echo");
        await send("/lock");
        await router.dispatch(pressUpdate("c:/count"));
        expect(api.callbackAnswers).toEqual(["Locked. Send /unlock first."]);
        expect(api.last()!.text).toBe("🔒 Locked.");
    });

    test("a flood of messages is cut off with one notice", async () => {
        const { api, send } = setup();
        for (let i = 0; i < 40; i++) await send("hi");
        expect(api.texts().filter((t) => t.includes("Too many messages"))).toHaveLength(1);
        expect(api.messages).toHaveLength(31);
    });
});

describe("modes over telegram", () => {
    test("/start lists the modes as buttons; pressing one opens it", async () => {
        const { api, send, press } = setup();
        await send(`/unlock ${PIN}`);
        await send("/start");
        expect(api.keyboards().pop()!.flat().map((b) => b.text)).toEqual(["Agent", "Plan", "Chat", "Echo"]);
        await press("Echo");
        expect(api.last()!.text).toContain("<b>  echo</b>");
        const commandSet = api.commandSets.pop()!;
        expect(commandSet.chatId).toBe(USER_ID);
        expect(commandSet.commands.map((c) => c.command)).toEqual(expect.arrayContaining(["count", "stop", "menu", "lock"]));
        expect(commandSet.commands.map((c) => c.command)).not.toContain("key");
    });

    test("a message runs a turn: the answer arrives with the cost line and shortcut buttons", async () => {
        const { api, send, open } = setup();
        await open("echo");
        await send("hello <world>");
        expect(api.last()!.text).toBe("You said: hello &lt;world&gt;\n\n<i>message 1</i>");
        expect(api.last()!.options.keyboard).toEqual([[{ text: "☰ Modes", callback_data: "c:/menu" }]]);
    });

    test("mode commands, unknown commands and a message with no mode open", async () => {
        const { api, send, press, open } = setup();
        await send(`/unlock ${PIN}`);
        await send("hello");
        expect(api.last()!.text).toContain("Pick a mode first");
        await open("echo");
        await send("one");
        await send("/count@my_bot");
        expect(api.last()!.text).toBe("◆ Echoed 1 so far.");
        await send("/nope");
        expect(api.last()!.text).toBe("Unknown command /nope. Send /help to see the commands.");
        await press("☰ Modes");
        expect(api.last()!.text).toContain("What do you want to do?");
    });

    test("/help lists mode and front-end commands; /key is refused; /thinking toggles", async () => {
        const { api, send, open } = setup();
        await open("echo");
        await send("/help");
        const help = api.transcript();
        expect(help).toContain("/count — how many messages were echoed");
        expect(help).toContain("/stop — stop what yuvi is doing");
        expect(help).toContain("/lock — lock the bot now");
        await send("/key sk-or-oops");
        expect(api.last()!.text).toContain("Keys are never set from Telegram");
        await send("/thinking off");
        expect(api.last()!.text).toContain("Thinking is hidden");
    });

    test("known secrets never reach the chat", async () => {
        const { api, send, open } = setup();
        await open("echo");
        await send(`my key is ${FAKE_API_KEY}`);
        expect(api.transcript()).not.toContain(FAKE_API_KEY);
        expect(api.last()!.text).toContain("You said: my key is [redacted]");
    });
});

describe("the agent over telegram", () => {
    test("a change is shown as a diff and saved only after Approve", async () => {
        const { api, send, press, open } = setup(EDIT_SCRIPT);
        await open("agent");
        const turn = send("change a to 5 in src/app.ts");
        await until(() => api.button("Approve all"), "the approval buttons");
        expect(ws.read("src/app.ts")).toBe("export const a = 1;\n");
        await press("Approve all");
        await turn;

        expect(ws.read("src/app.ts")).toBe("export const a = 5;\n");
        const chat = api.transcript();
        expect(chat).toContain('<pre><code class="language-diff">');
        expect(chat).toContain("-export const a = 1;");
        expect(chat).toContain("+export const a = 5;");
        expect(chat).toContain("✅ Approved 1 change.");
        expect(chat).toContain("● <b>Read</b> src/app.ts");
        expect(chat).toContain("✓ <b>Done</b>");
        expect(api.last()!.text).toContain("Changed <code>a</code> to 5.");
        expect(api.last()!.options.keyboard!.flat().map((b) => b.callback_data)).toEqual(["c:/mode", "c:/undo", "c:/new", "c:/menu"]);
    });

    test("Reject leaves the file alone, and the Undo button puts an approved change back", async () => {
        const first = setup(EDIT_SCRIPT);
        await first.open("agent");
        const rejected = first.send("change a to 5 in src/app.ts");
        await first.press("Reject all");
        await rejected;
        expect(ws.read("src/app.ts")).toBe("export const a = 1;\n");
        expect(first.api.transcript()).toContain("❌ Rejected. No file was changed.");

        const second = setup(EDIT_SCRIPT);
        await second.open("agent");
        const approved = second.send("change a to 5 in src/app.ts");
        await second.press("Approve all");
        await approved;
        await second.press("Undo last change");
        expect(ws.read("src/app.ts")).toBe("export const a = 1;\n");
        expect(second.api.last()!.text).toContain("Put back as before: src/app.ts");
    });

    test("“Reject + tell yuvi” rejects, then runs the instruction as the next message", async () => {
        const { api, model, send, press, open } = setup(EDIT_SCRIPT);
        await open("agent");
        const turn = send("change a to 5 in src/app.ts");
        await press("Reject + tell yuvi");
        await until(() => api.transcript().includes("What should yuvi do instead?"), "the follow-up question");
        await send("use 7, not 5");
        await turn;
        expect(ws.read("src/app.ts")).toBe("export const a = 1;\n");
        // The follow-up turn tells the model both that its change was refused and what to do.
        const lastPrompt = JSON.stringify(model.doStreamCalls[model.doStreamCalls.length - 1]!.prompt);
        expect(lastPrompt).toContain("The user rejected your changes to: src/app.ts");
        expect(lastPrompt).toContain("use 7, not 5");
        expect(api.transcript()).toContain("❌ Rejected. What should yuvi do instead?");
    });

    test("/stop while an approval is open: nothing is saved and the turn ends", async () => {
        const { api, router, send, open } = setup(EDIT_SCRIPT);
        await open("agent");
        const turn = send("change a to 5 in src/app.ts");
        const stale = await until(() => api.button("Approve all"), "the approval buttons");
        await send("/stop");
        await turn;
        expect(api.transcript()).toContain("Stopped");
        // The old button is dead: pressing it now approves nothing.
        await router.dispatch(pressUpdate(stale));
        expect(api.callbackAnswers.pop()).toBe("This button has expired.");
        expect(ws.read("src/app.ts")).toBe("export const a = 1;\n");
    });

    test("an expired or reused approval button is refused", async () => {
        const { api, router, send, press, open } = setup(EDIT_SCRIPT);
        await open("agent");
        const turn = send("change a to 5 in src/app.ts");
        const data = await until(() => api.button("Approve all"), "the approval buttons");
        await press("Reject all");
        await turn;
        await router.dispatch(pressUpdate(data));
        expect(api.callbackAnswers.pop()).toBe("This button has expired.");
        expect(ws.read("src/app.ts")).toBe("export const a = 1;\n");
    });

    test("a message sent while the agent works is passed on as a correction; other commands wait", async () => {
        const { api, send, press, open } = setup(EDIT_SCRIPT);
        await open("agent");
        const turn = send("change a to 5 in src/app.ts");
        await until(() => api.button("Approve all"), "the approval buttons");
        await send("/new");
        expect(api.last()!.text).toContain("yuvi is busy");
        await send("also add a comment");
        expect(api.last()!.text).toContain("Passed to yuvi");
        await press("Approve all");
        await turn;
    });

    test("a photo is given to the model in agent mode and refused in a mode that cannot see", async () => {
        const photo = (caption: string): TgUpdate => ({
            update_id: 3,
            message: { message_id: 5, date: 0, chat: { id: USER_ID, type: "private" }, from: { id: USER_ID, is_bot: false }, caption, photo: [{ file_id: "small" }, { file_id: "big" }] },
        });
        const agent = setup([say("It shows an error dialog.")]);
        agent.api.files.set("big", new Uint8Array([1, 2, 3]));
        await agent.open("agent");
        await agent.router.dispatch(photo("what is this error?"));
        const prompt = JSON.stringify(agent.model.doStreamCalls[0]!.prompt);
        expect(prompt).toContain("what is this error?");
        expect(prompt).toContain("image/jpeg");
        expect(agent.api.last()!.text).toContain("It shows an error dialog.");

        const echo = setup();
        echo.api.files.set("big", new Uint8Array([1, 2, 3]));
        await echo.open("echo");
        await echo.router.dispatch(photo("look"));
        expect(echo.api.last()!.text).toContain("cannot look at photos yet");
    });
});

describe("files and projects", () => {
    const documentUpdate = (name: string, caption?: string): TgUpdate => ({
        update_id: 4,
        message: { message_id: 6, date: 0, chat: { id: USER_ID, type: "private" }, from: { id: USER_ID, is_bot: false }, document: { file_id: "doc", file_name: name, file_size: 4 }, ...(caption ? { caption } : {}) },
    });

    test("an uploaded file is saved inside the project only after Save", async () => {
        const { api, router, send, press } = setup();
        api.files.set("doc", new TextEncoder().encode("data"));
        await send(`/unlock ${PIN}`);
        const upload = router.dispatch(documentUpdate("notes.txt"));
        await until(() => api.button("Save"), "the save button");
        expect(ws.exists("uploads/notes.txt")).toBe(false);
        await press("Save");
        await upload;
        expect(ws.read("uploads/notes.txt")).toBe("data");

        const cancelled = router.dispatch(documentUpdate("other.txt", "docs"));
        await press("Cancel");
        await cancelled;
        expect(ws.exists("docs/other.txt")).toBe(false);
        expect(api.last()!.text).toBe("Not saved.");
    });

    test("uploads cannot leave the project or replace a secrets file", async () => {
        const { api, router, send } = setup();
        api.files.set("doc", new TextEncoder().encode("data"));
        await send(`/unlock ${PIN}`);
        await router.dispatch(documentUpdate("x.txt", "../../outside"));
        expect(api.last()!.text).toContain("I will not save a file there");
        await router.dispatch(documentUpdate(".env", "."));
        expect(api.last()!.text).toContain("I will not save a file there");
        expect(ws.read(".env")).toBe("SECRET=1\n");
    });

    test("/file sends a project file, but not secrets or files outside the project", async () => {
        const { api, send } = setup();
        await send(`/unlock ${PIN}`);
        await send("/file src/app.ts");
        expect(api.documents).toHaveLength(1);
        expect(api.documents[0]!.name).toBe("app.ts");
        expect(new TextDecoder().decode(api.documents[0]!.data)).toBe("export const a = 1;\n");
        for (const target of [".env", "../secret.txt", "C:/Windows/win.ini", "/etc/passwd"]) {
            await send(`/file ${target}`);
            expect(api.last()!.text).toContain("I will not send that");
        }
        await send("/file missing.ts");
        expect(api.last()!.text).toContain("No such file");
        expect(api.documents).toHaveLength(1);
    });

    test("/project switches the folder from the configured list only", async () => {
        const other = makeWorkspace({ "main.py": "print(1)\n" });
        try {
            const { api, send, press } = setup([], [{ name: "other", path: other.root }]);
            await send(`/unlock ${PIN}`);
            await send("/open echo");
            const switching = send("/project");
            await press("other");
            await switching;
            await send("/file main.py");
            expect(api.documents.map((d) => d.name)).toEqual(["main.py"]);
            expect(api.transcript()).toContain("✓ Project: <b>other</b>");
        } finally {
            other.cleanup();
        }
    });

    test("without configured projects, /project explains how to add them", async () => {
        const { api, send } = setup();
        await send(`/unlock ${PIN}`);
        await send("/project");
        expect(api.last()!.text).toContain("YUVI_TELEGRAM_PROJECTS");
    });
});
