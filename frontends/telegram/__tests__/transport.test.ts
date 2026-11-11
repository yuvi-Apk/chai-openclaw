/** Talking to Telegram: the fetch adapter, sending, live edits and polling. No real network. */
import { describe, expect, test } from "bun:test";
import { nullLogger } from "../../../core/log";
import { FetchTelegramApi, TelegramApiError } from "../api/telegram-api";
import { runPoller } from "../poller";
import { LiveMessage } from "../view/live-message";
import { ChatMessenger } from "../view/messenger";
import { FakeClock, FakeTelegramApi, settle } from "./fakes";

const TOKEN = "123456:FAKE-bot-token-for-tests";
const CHAT = 7;

interface Call {
    url: string;
    body: Record<string, unknown>;
}

/** A fetch that answers from a list and records what was asked. */
function fakeFetch(replies: (object | Error)[]) {
    const calls: Call[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
        calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : {} });
        const reply = replies.shift() ?? { ok: true, result: true };
        if (reply instanceof Error) throw reply;
        return new Response(JSON.stringify(reply));
    };
    return { calls, fetchFn };
}

describe("the fetch adapter", () => {
    test("sends HTML with buttons and returns the message id", async () => {
        const { calls, fetchFn } = fakeFetch([{ ok: true, result: { message_id: 55 } }]);
        const api = new FetchTelegramApi(TOKEN, fetchFn);
        const id = await api.sendMessage(CHAT, "<b>hi</b>", { html: true, silent: true, keyboard: [[{ text: "Yes", callback_data: "q:1:0" }]] });
        expect(id).toBe(55);
        expect(calls[0]!.url).toEndWith("/sendMessage");
        expect(calls[0]!.body).toMatchObject({
            chat_id: CHAT,
            text: "<b>hi</b>",
            parse_mode: "HTML",
            disable_notification: true,
            reply_markup: { inline_keyboard: [[{ text: "Yes", callback_data: "q:1:0" }]] },
        });
    });

    test("an API error carries the code and wait time, and never the token", async () => {
        const { fetchFn } = fakeFetch([
            { ok: false, error_code: 429, description: `Too Many Requests for bot${TOKEN}`, parameters: { retry_after: 7 } },
        ]);
        const error = await new FetchTelegramApi(TOKEN, fetchFn).sendMessage(CHAT, "x").catch((e) => e);
        expect(error).toBeInstanceOf(TelegramApiError);
        expect(error.rateLimited).toBe(true);
        expect(error.retryAfterSec).toBe(7);
        expect(error.message).not.toContain(TOKEN);
    });

    test("a network error that quotes the URL does not leak the token", async () => {
        const { fetchFn } = fakeFetch([new Error(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`)]);
        const error = await new FetchTelegramApi(TOKEN, fetchFn).sendMessage(CHAT, "x").catch((e) => e);
        expect(error.message).toContain("[redacted]");
        expect(error.message).not.toContain(TOKEN);
    });

    test("editing a message to the same text is not an error", async () => {
        const { fetchFn } = fakeFetch([{ ok: false, error_code: 400, description: "Bad Request: message is not modified" }]);
        await expect(new FetchTelegramApi(TOKEN, fetchFn).editMessage(CHAT, 1, "same")).resolves.toBeUndefined();
    });

    test("updates are checked: unreadable ones keep only their id, junk is dropped", async () => {
        const good = { update_id: 5, message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, from: { id: 1, is_bot: false }, text: "hi", extra: "ignored" } };
        const { calls, fetchFn } = fakeFetch([{ ok: true, result: [good, { update_id: 6, message: { text: 42 } }, "junk", { nope: true }] }]);
        const updates = await new FetchTelegramApi(TOKEN, fetchFn).getUpdates(3, 0);
        expect(updates.map((u) => u.update_id)).toEqual([5, 6]);
        expect(updates[0]!.message?.text).toBe("hi");
        expect(updates[1]!.message).toBeUndefined();
        expect(calls[0]!.body).toMatchObject({ offset: 3, allowed_updates: ["message", "callback_query"] });
    });

    test("a download larger than the limit is refused", async () => {
        const { fetchFn } = fakeFetch([{ ok: true, result: { file_path: "photos/a.jpg", file_size: 9_000_000 } }]);
        const error = await new FetchTelegramApi(TOKEN, fetchFn).downloadFile("f", 1000).catch((e) => e);
        expect(error.message).toContain("too large");
    });

    test("per-chat commands are scoped to that chat", async () => {
        const { calls, fetchFn } = fakeFetch([]);
        await new FetchTelegramApi(TOKEN, fetchFn).setCommands([{ command: "undo", description: "undo" }], CHAT);
        expect(calls[0]!.body).toMatchObject({ scope: { type: "chat", chat_id: CHAT } });
    });
});

describe("the messenger", () => {
    const SECRET = "sk-or-secret-value-123";
    const make = (api: FakeTelegramApi, clock = new FakeClock()) => new ChatMessenger(api, CHAT, () => [SECRET], nullLogger, clock);

    test("known secrets are removed from everything it sends or edits", async () => {
        const api = new FakeTelegramApi();
        const messenger = make(api);
        const id = await messenger.send(`key is ${SECRET}`);
        expect(api.last()!.text).toBe("key is [redacted]");
        await messenger.edit(id, `still ${SECRET}`);
        expect(api.last()!.text).toBe("still [redacted]");
    });

    test("when Telegram rejects the formatting, the text is sent plain", async () => {
        const api = new FakeTelegramApi();
        api.onWrite = (_kind, _text, options) => {
            if (options.html) throw new TelegramApiError("sendMessage", "Bad Request: can't parse entities", 400);
        };
        const id = await make(api).send("<b>a &lt; b</b>");
        expect(id).toBeGreaterThan(0);
        expect(api.last()).toMatchObject({ text: "a < b", options: { html: false } });
    });

    test("a rate limit is waited out once; a second failure is given up without throwing", async () => {
        const api = new FakeTelegramApi();
        const clock = new FakeClock();
        let failures = 1;
        api.onWrite = () => {
            if (failures-- > 0) throw new TelegramApiError("sendMessage", "Too Many Requests", 429, 3);
        };
        expect(await make(api, clock).send("hello")).toBeGreaterThan(0);
        expect(clock.sleeps).toEqual([3000]);

        api.onWrite = () => {
            throw new TelegramApiError("sendMessage", "Forbidden", 403);
        };
        expect(await make(api, clock).send("hello")).toBe(0);
    });

    test("blocks are split into messages; only the last one notifies and carries the buttons", async () => {
        const api = new FakeTelegramApi();
        const keyboard = [[{ text: "Undo", callback_data: "c:/undo" }]];
        await make(api).sendBlocks(Array.from({ length: 5 }, () => "y".repeat(1500)), { keyboard });
        expect(api.messages.length).toBe(3);
        expect(api.messages.map((m) => Boolean(m.options.silent))).toEqual([true, true, false]);
        expect(api.messages.map((m) => Boolean(m.options.keyboard))).toEqual([false, false, true]);
    });
});

describe("the live message", () => {
    const setup = () => {
        const api = new FakeTelegramApi();
        const clock = new FakeClock();
        const live = new LiveMessage(new ChatMessenger(api, CHAT, () => [], nullLogger, clock), clock, Promise.resolve(), 1000);
        return { api, clock, live };
    };

    test("the first text is sent silently, later ones edit the same message", async () => {
        const { api, clock, live } = setup();
        live.set("one");
        await clock.advance(0);
        expect(api.messages).toHaveLength(1);
        expect(api.last()).toMatchObject({ text: "one", options: { silent: true } });
        live.set("two");
        await clock.advance(1000);
        expect(api.messages).toHaveLength(1);
        expect(api.last()!.text).toBe("two");
    });

    test("many changes within the interval become one edit with the newest text", async () => {
        const { api, clock, live } = setup();
        live.set("start");
        await clock.advance(0);
        for (let i = 0; i < 50; i++) live.set(`step ${i}`);
        await clock.advance(500);
        expect(api.editCount).toBe(0);
        await clock.advance(500);
        expect(api.editCount).toBe(1);
        expect(api.last()!.text).toBe("step 49");
    });

    test("closing writes the final text at once, and an unchanged text is not sent again", async () => {
        const { api, clock, live } = setup();
        live.set("working");
        await clock.advance(0);
        await live.close("done");
        expect(api.last()!.text).toBe("done");
        await live.close("done");
        expect(api.editCount).toBe(1);
    });

    test("after a rate limit the edit is retried once the wait is over", async () => {
        const { api, clock, live } = setup();
        live.set("a");
        await clock.advance(0);
        api.onWrite = (kind) => {
            if (kind === "edit") throw new TelegramApiError("editMessageText", "Too Many Requests", 429, 5);
        };
        live.set("b");
        await clock.advance(1000);
        expect(api.last()!.text).toBe("a");
        api.onWrite = undefined;
        live.set("b");
        await clock.advance(4000);
        expect(api.last()!.text).toBe("a");
        await clock.advance(1000);
        expect(api.last()!.text).toBe("b");
    });

    test("a discarded message that was never sent stays unsent", async () => {
        const { api, clock, live } = setup();
        live.set("never");
        live.discard();
        await clock.advance(5000);
        await live.close();
        expect(api.messages).toHaveLength(0);
    });
});

describe("the poller", () => {
    const update = (id: number) => ({ update_id: id });

    test("messages sent while the bot was off are dropped, then reading starts after them", async () => {
        const api = new FakeTelegramApi();
        const stop = new AbortController();
        const seen: number[] = [];
        api.updateScript = [[update(40)], [update(41), update(42)]];
        const done = runPoller(api, (u) => seen.push(u.update_id), { signal: stop.signal, log: nullLogger, clock: new FakeClock() });
        await settle(50);
        stop.abort();
        await done;
        expect(seen).toEqual([41, 42]);
        expect(api.polls.slice(0, 3)).toEqual([
            { offset: -1, timeoutSec: 0 },
            { offset: 41, timeoutSec: 30 },
            { offset: 43, timeoutSec: 30 },
        ]);
    });

    test("a failed poll waits, doubles the wait, and carries on", async () => {
        const api = new FakeTelegramApi();
        const clock = new FakeClock();
        const stop = new AbortController();
        const seen: number[] = [];
        api.updateScript = [[], new Error("network"), new Error("network"), [update(1)]];
        const done = runPoller(api, (u) => seen.push(u.update_id), { signal: stop.signal, log: nullLogger, clock });
        await settle(80);
        stop.abort();
        await done;
        expect(clock.sleeps).toEqual([1000, 2000]);
        expect(seen).toEqual([1]);
    });
});
