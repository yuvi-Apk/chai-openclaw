/**
 * Questions that wait for the user: a set of buttons, or the next text
 * message. Each set of buttons has a random id, belongs to one chat, works
 * once and expires, so an old or copied button cannot approve anything.
 * A question nobody answers resolves to null, which callers treat as "no".
 */
import { randomBytes } from "node:crypto";
import type { InlineKeyboard } from "./api/types";
import type { Clock } from "./clock";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const ID_BYTES = 8;
const PREFIX = "q";

export interface ButtonSpec<T> {
    label: string;
    value: T;
}

interface Waiting<T> {
    chatId: number;
    resolve: (value: T | null) => void;
    cancelTimer: () => void;
}

interface PendingButtons extends Waiting<unknown> {
    values: unknown[];
}

export class Questions {
    private readonly buttons = new Map<string, PendingButtons>();
    private readonly texts = new Map<number, Waiting<string>>();

    constructor(
        private readonly clock: Clock,
        private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
        private readonly newId: () => string = () => randomBytes(ID_BYTES).toString("hex"),
    ) {}

    /** Build a keyboard and a promise for the value of the button that gets pressed. */
    ask<T>(chatId: number, rows: ButtonSpec<T>[][]): { keyboard: InlineKeyboard; answer: Promise<T | null> } {
        const id = this.newId();
        const values: T[] = [];
        const keyboard = rows.map((row) =>
            row.map((button) => {
                values.push(button.value);
                return { text: button.label, callback_data: `${PREFIX}:${id}:${values.length - 1}` };
            }),
        );
        const answer = new Promise<T | null>((resolve) => {
            const cancelTimer = this.clock.after(this.timeoutMs, () => {
                this.buttons.delete(id);
                resolve(null);
            });
            this.buttons.set(id, { chatId, values, cancelTimer, resolve: resolve as (value: unknown) => void });
        });
        return { keyboard, answer };
    }

    /** True when `data` looks like one of our question buttons, live or not. */
    static owns(data: string): boolean {
        return data.startsWith(`${PREFIX}:`);
    }

    /** A button was pressed. Returns false when it is unknown, used, expired or from another chat. */
    press(chatId: number, data: string): boolean {
        const [prefix, id = "", index = ""] = data.split(":");
        const pending = this.buttons.get(id);
        if (prefix !== PREFIX || !pending || pending.chatId !== chatId) return false;
        const position = Number(index);
        if (!Number.isInteger(position) || position < 0 || position >= pending.values.length) return false;
        this.buttons.delete(id);
        pending.cancelTimer();
        pending.resolve(pending.values[position]);
        return true;
    }

    /** Wait for the next text message from this chat. */
    text(chatId: number): Promise<string | null> {
        this.dropText(chatId);
        return new Promise((resolve) => {
            const cancelTimer = this.clock.after(this.timeoutMs, () => {
                this.texts.delete(chatId);
                resolve(null);
            });
            this.texts.set(chatId, { chatId, resolve, cancelTimer });
        });
    }

    /** Give a text message to whoever waits for one. Returns false when nobody does. */
    offerText(chatId: number, text: string): boolean {
        const waiting = this.texts.get(chatId);
        if (!waiting) return false;
        this.texts.delete(chatId);
        waiting.cancelTimer();
        waiting.resolve(text);
        return true;
    }

    /** Stop waiting for a text message in this chat. */
    dropText(chatId: number): void {
        const waiting = this.texts.get(chatId);
        if (!waiting) return;
        this.texts.delete(chatId);
        waiting.cancelTimer();
        waiting.resolve(null);
    }

    /** Answer every open question of this chat with "no". */
    cancelAll(chatId: number): void {
        this.dropText(chatId);
        for (const [id, pending] of this.buttons) {
            if (pending.chatId !== chatId) continue;
            this.buttons.delete(id);
            pending.cancelTimer();
            pending.resolve(null);
        }
    }
}
