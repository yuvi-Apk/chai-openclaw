/** Test doubles for the Telegram front end: a Bot API that records calls, and clocks. */
import type { BotCommand, InlineKeyboard, SendOptions, TelegramApi, TgUpdate } from "../api/types";
import type { Clock } from "../clock";

export interface SentMessage {
    id: number;
    chatId: number;
    text: string;
    options: SendOptions;
}

/** A Bot API without a network. Messages keep their latest text, as in a real chat. */
export class FakeTelegramApi implements TelegramApi {
    readonly messages: SentMessage[] = [];
    readonly deleted: number[] = [];
    readonly callbackAnswers: (string | undefined)[] = [];
    readonly documents: { name: string; data: Uint8Array; caption?: string | undefined }[] = [];
    readonly commandSets: { commands: BotCommand[]; chatId?: number | undefined }[] = [];
    readonly polls: { offset: number; timeoutSec: number }[] = [];
    readonly files = new Map<string, Uint8Array>();
    /** Each entry answers one getUpdates call: updates, or an error to throw. */
    updateScript: (TgUpdate[] | Error)[] = [];
    /** Called for every send and edit; throw from it to make the call fail. */
    onWrite: ((kind: "send" | "edit", text: string, options: SendOptions) => void) | undefined;
    editCount = 0;
    private nextId = 100;

    async getUpdates(offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TgUpdate[]> {
        this.polls.push({ offset, timeoutSec });
        const next = this.updateScript.shift();
        if (next instanceof Error) throw next;
        if (next) return next;
        // Nothing scripted: behave like a quiet chat until the test stops the poller.
        await new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve();
            signal?.addEventListener("abort", () => resolve());
        });
        return [];
    }

    async sendMessage(chatId: number, text: string, options: SendOptions = {}): Promise<number> {
        this.onWrite?.("send", text, options);
        const id = this.nextId++;
        this.messages.push({ id, chatId, text, options });
        return id;
    }

    async editMessage(chatId: number, messageId: number, text: string, options: SendOptions = {}): Promise<void> {
        this.onWrite?.("edit", text, options);
        this.editCount++;
        const message = this.messages.find((m) => m.id === messageId && m.chatId === chatId);
        if (message) {
            message.text = text;
            // An edit replaces text and buttons; how the message was delivered stays.
            message.options = { ...options, ...(message.options.silent ? { silent: true } : {}) };
        }
    }

    async deleteMessage(_chatId: number, messageId: number): Promise<void> {
        this.deleted.push(messageId);
    }

    async answerCallback(_callbackId: string, text?: string): Promise<void> {
        this.callbackAnswers.push(text);
    }

    async sendTyping(): Promise<void> {}

    async setCommands(commands: BotCommand[], chatId?: number): Promise<void> {
        this.commandSets.push({ commands, chatId });
    }

    async sendDocument(_chatId: number, name: string, data: Uint8Array, caption?: string): Promise<void> {
        this.documents.push({ name, data, caption });
    }

    async downloadFile(fileId: string, maxBytes: number): Promise<Uint8Array> {
        const data = this.files.get(fileId);
        if (!data) throw new Error("no such file");
        if (data.length > maxBytes) throw new Error("the file is too large");
        return data;
    }

    // ---------- reading the chat ----------

    /** The texts now in the chat, oldest first. */
    texts(): string[] {
        return this.messages.map((m) => m.text);
    }

    /** Everything in the chat as one string. */
    transcript(): string {
        return this.texts().join("\n---\n");
    }

    last(): SentMessage | undefined {
        return this.messages[this.messages.length - 1];
    }

    keyboards(): InlineKeyboard[] {
        return this.messages.flatMap((m) => (m.options.keyboard ? [m.options.keyboard] : []));
    }

    /** The callback data of the newest button whose label contains `label`. */
    button(label: string): string | undefined {
        for (const keyboard of this.keyboards().reverse()) {
            const found = keyboard.flat().find((b) => b.text.includes(label));
            if (found) return found.callback_data;
        }
        return undefined;
    }
}

/** A clock the test moves by hand. Timers fire when time passes them. */
export class FakeClock implements Clock {
    private time = 1_000_000;
    private timers: { at: number; fn: () => void }[] = [];
    readonly sleeps: number[] = [];

    now(): number {
        return this.time;
    }

    after(ms: number, fn: () => void): () => void {
        const timer = { at: this.time + ms, fn };
        this.timers.push(timer);
        return () => {
            this.timers = this.timers.filter((t) => t !== timer);
        };
    }

    async sleep(ms: number): Promise<void> {
        this.sleeps.push(ms);
    }

    /** Move time forward, run the timers that are due, and let their work finish. */
    async advance(ms: number): Promise<void> {
        this.time += ms;
        const due = this.timers.filter((t) => t.at <= this.time);
        this.timers = this.timers.filter((t) => t.at > this.time);
        for (const timer of due) timer.fn();
        await settle();
    }
}

/** Real time, but nothing waits: for end-to-end tests where only the order matters. */
export const instantClock: Clock = {
    now: () => Date.now(),
    after(ms, fn) {
        // Long waits are timeouts that a test never wants to hit; short ones are redraws.
        const timer = setTimeout(fn, ms > 5000 ? ms : 0);
        timer.unref?.();
        return () => clearTimeout(timer);
    },
    sleep: async () => undefined,
};

/** Let pending promise callbacks run. */
export async function settle(rounds = 20): Promise<void> {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Wait until `check` returns something, or fail after a few seconds. */
export async function until<T>(check: () => T | undefined | false | null, what = "condition"): Promise<T> {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
        const value = check();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${what}`);
}

export const USER_ID = 4242;

/** A text message from the allowed user in their private chat. */
export function textUpdate(text: string, overrides: { userId?: number; chatType?: string; messageId?: number } = {}): TgUpdate {
    const userId = overrides.userId ?? USER_ID;
    return {
        update_id: 1,
        message: {
            message_id: overrides.messageId ?? 1,
            date: 0,
            chat: { id: userId, type: overrides.chatType ?? "private" },
            from: { id: userId, is_bot: false },
            text,
        },
    };
}

/** A button press by the allowed user. */
export function pressUpdate(data: string, userId = USER_ID): TgUpdate {
    return {
        update_id: 2,
        callback_query: {
            id: "cb",
            from: { id: userId, is_bot: false },
            message: { message_id: 1, date: 0, chat: { id: userId, type: "private" } },
            data,
        },
    };
}
