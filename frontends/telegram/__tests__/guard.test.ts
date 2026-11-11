/** The safety pieces on their own: the PIN lock, one-time buttons and the start-up checks. */
import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigError } from "../../../core/errors";
import { testSettings } from "../../../core/testing";
import { loadTelegramConfig } from "../config";
import { PinLock } from "../lock";
import { Questions } from "../questions";
import { FakeClock } from "./fakes";

const PIN = "482915";
const IDLE_MS = 15 * 60_000;
const MINUTE = 60_000;

describe("the PIN lock", () => {
    const make = () => {
        const clock = new FakeClock();
        return { clock, lock: new PinLock(PIN, IDLE_MS, () => clock.now()) };
    };

    test("starts locked and opens only with the right PIN", () => {
        const { lock } = make();
        expect(lock.isLocked()).toBe(true);
        expect(lock.tryUnlock("000000")).toEqual({ ok: false, triesLeft: 4, blockedMs: 0 });
        expect(lock.isLocked()).toBe(true);
        expect(lock.tryUnlock(` ${PIN} `)).toEqual({ ok: true });
        expect(lock.isLocked()).toBe(false);
    });

    test("locks again after the quiet period, and activity pushes that back", async () => {
        const { clock, lock } = make();
        lock.tryUnlock(PIN);
        await clock.advance(10 * MINUTE);
        lock.touch();
        await clock.advance(10 * MINUTE);
        expect(lock.isLocked()).toBe(false);
        await clock.advance(IDLE_MS + 1);
        expect(lock.isLocked()).toBe(true);
    });

    test("/lock locks at once", () => {
        const { lock } = make();
        lock.tryUnlock(PIN);
        lock.lock();
        expect(lock.isLocked()).toBe(true);
    });

    test("five wrong tries block guessing, even with the right PIN, and the block doubles", async () => {
        const { clock, lock } = make();
        for (let i = 0; i < 4; i++) lock.tryUnlock("wrong");
        expect(lock.tryUnlock("wrong")).toEqual({ ok: false, triesLeft: 0, blockedMs: 15 * MINUTE });
        expect(lock.tryUnlock(PIN).ok).toBe(false);
        expect(lock.isLocked()).toBe(true);

        await clock.advance(15 * MINUTE);
        for (let i = 0; i < 4; i++) lock.tryUnlock("wrong");
        expect(lock.tryUnlock("wrong")).toEqual({ ok: false, triesLeft: 0, blockedMs: 30 * MINUTE });

        await clock.advance(30 * MINUTE);
        expect(lock.tryUnlock(PIN)).toEqual({ ok: true });
    });
});

describe("questions", () => {
    const CHAT = 9;
    const make = () => {
        const clock = new FakeClock();
        let n = 0;
        return { clock, questions: new Questions(clock, 10 * MINUTE, () => `id${n++}`) };
    };

    test("a pressed button answers with its value", async () => {
        const { questions } = make();
        const { keyboard, answer } = questions.ask(CHAT, [[{ label: "Yes", value: "y" }, { label: "No", value: "n" }]]);
        expect(keyboard).toEqual([[{ text: "Yes", callback_data: "q:id0:0" }, { text: "No", callback_data: "q:id0:1" }]]);
        expect(questions.press(CHAT, "q:id0:1")).toBe(true);
        expect(await answer).toBe("n");
    });

    test("a button works once, only in its own chat, and not with made-up data", async () => {
        const { questions } = make();
        const { answer } = questions.ask(CHAT, [[{ label: "Approve", value: true }]]);
        expect(questions.press(CHAT + 1, "q:id0:0")).toBe(false);
        expect(questions.press(CHAT, "q:id0:5")).toBe(false);
        expect(questions.press(CHAT, "q:other:0")).toBe(false);
        expect(questions.press(CHAT, "c:/undo")).toBe(false);
        expect(questions.press(CHAT, "q:id0:0")).toBe(true);
        expect(await answer).toBe(true);
        expect(questions.press(CHAT, "q:id0:0")).toBe(false);
    });

    test("default button ids are random and long", () => {
        const questions = new Questions(new FakeClock());
        const data = [1, 2].map(() => questions.ask(CHAT, [[{ label: "x", value: 1 }]]).keyboard[0]![0]!.callback_data);
        expect(data[0]).toMatch(/^q:[0-9a-f]{16}:0$/);
        expect(data[0]).not.toBe(data[1]);
        expect(Buffer.byteLength(data[0]!)).toBeLessThanOrEqual(64);
    });

    test("an unanswered question times out as null and its button stops working", async () => {
        const { clock, questions } = make();
        const { answer } = questions.ask(CHAT, [[{ label: "Approve", value: true }]]);
        await clock.advance(10 * MINUTE);
        expect(await answer).toBeNull();
        expect(questions.press(CHAT, "q:id0:0")).toBe(false);
    });

    test("the next text message answers a text question; a second question replaces the first", async () => {
        const { questions } = make();
        expect(questions.offerText(CHAT, "nobody asked")).toBe(false);
        const first = questions.text(CHAT);
        const second = questions.text(CHAT);
        expect(await first).toBeNull();
        expect(questions.offerText(CHAT, "use tabs")).toBe(true);
        expect(await second).toBe("use tabs");
        expect(questions.offerText(CHAT, "again")).toBe(false);
    });

    test("cancelAll answers every open question of that chat with null", async () => {
        const { questions } = make();
        const mine = questions.ask(CHAT, [[{ label: "x", value: 1 }]]);
        const text = questions.text(CHAT);
        const other = questions.ask(CHAT + 1, [[{ label: "x", value: 1 }]]);
        questions.cancelAll(CHAT);
        expect(await mine.answer).toBeNull();
        expect(await text).toBeNull();
        expect(questions.press(CHAT + 1, "q:id1:0")).toBe(true);
        expect(await other.answer).toBe(1);
    });
});

describe("telegram settings", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-tg-config-"));
    const projectDir = path.join(root, "site");
    fs.mkdirSync(projectDir);
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    const base = { TELEGRAM_BOT_TOKEN: "123:FAKE-token-value", YUVI_TELEGRAM_USERS: "11, 22", YUVI_TELEGRAM_PIN: PIN };
    const load = (env: Record<string, string>) => loadTelegramConfig(testSettings(env), root);

    test("reads the token, users, PIN, workspace and projects", () => {
        const config = load({ ...base, YUVI_TELEGRAM_PROJECTS: `site=${projectDir}; gone=${path.join(root, "missing")}; bad`, YUVI_TELEGRAM_LOCK_MINUTES: "5" });
        expect([...config.users]).toEqual([11, 22]);
        expect(config.workspace).toBe(root);
        expect(config.projects).toEqual([{ name: "site", path: projectDir }]);
        expect(config.lockIdleMs).toBe(5 * MINUTE);
    });

    test("refuses to start without a token, an allowlist or a real PIN", () => {
        expect(() => load({ ...base, TELEGRAM_BOT_TOKEN: "" })).toThrow(ConfigError);
        expect(() => load({ ...base, YUVI_TELEGRAM_USERS: "" })).toThrow(/YUVI_TELEGRAM_USERS/);
        expect(() => load({ ...base, YUVI_TELEGRAM_USERS: "@name, abc" })).toThrow(/YUVI_TELEGRAM_USERS/);
        expect(() => load({ ...base, YUVI_TELEGRAM_PIN: "123" })).toThrow(/YUVI_TELEGRAM_PIN/);
        expect(() => load({ ...base, YUVI_TELEGRAM_WORKSPACE: path.join(root, "missing") })).toThrow(/does not exist/);
    });

    test("the token and PIN are treated as secrets and kept from shell commands", () => {
        const settings = testSettings({ ...base, YUVI_TELEGRAM_PIN: "long-enough-pin" });
        expect(settings.secrets()).toEqual(["123:FAKE-token-value", "long-enough-pin"]);
        expect(Object.keys(settings.childEnv())).toEqual(["YUVI_TELEGRAM_USERS"]);
    });
});
