/**
 * Sends messages to one chat. Everything that leaves the bot goes through
 * here, so this is where known secrets are removed, long texts are split,
 * and a formatting error falls back to plain text. Sending never throws:
 * a failed message is logged and the turn goes on.
 */
import type { Logger } from "../../../core/log";
import { TelegramApiError } from "../api/telegram-api";
import type { InlineKeyboard, TelegramApi } from "../api/types";
import { realClock, type Clock } from "../clock";
import { packBlocks, stripHtml } from "./html";

const MS_PER_SECOND = 1000;
/** Longest wait accepted from a rate-limit reply before giving up on a message. */
const MAX_RETRY_WAIT_SEC = 30;

export interface MessageOptions {
    keyboard?: InlineKeyboard;
    silent?: boolean;
}

export class ChatMessenger {
    constructor(
        private readonly api: TelegramApi,
        readonly chatId: number,
        private readonly secrets: () => string[],
        private readonly log: Logger,
        private readonly clock: Clock = realClock,
    ) {}

    /** Remove the exact values of known secrets. */
    private hide(text: string): string {
        return this.secrets().reduce((out, secret) => out.split(secret).join("[redacted]"), text);
    }

    private failed(action: string, error: unknown): void {
        const code = error instanceof TelegramApiError ? error.code : undefined;
        this.log.event("telegram.send_failed", { action, code });
    }

    /** Run a call; on a rate limit wait as asked and try once more; on bad HTML use plain text. */
    private async attempt<T>(action: string, run: (html: boolean) => Promise<T>): Promise<T | undefined> {
        try {
            return await run(true);
        } catch (error) {
            if (!(error instanceof TelegramApiError)) return void this.failed(action, error);
            const wait = error.retryAfterSec ?? 0;
            const badHtml = /parse entities|can't parse|unsupported start tag/i.test(error.message);
            if (!badHtml && !(error.rateLimited && wait <= MAX_RETRY_WAIT_SEC)) return void this.failed(action, error);
            if (!badHtml) await this.clock.sleep(wait * MS_PER_SECOND);
            try {
                return await run(!badHtml);
            } catch (second) {
                return void this.failed(action, second);
            }
        }
    }

    /** Send one message of Telegram HTML. Returns its id, or 0 when it could not be sent. */
    async send(html: string, options: MessageOptions = {}): Promise<number> {
        const safe = this.hide(html);
        const id = await this.attempt("send", (asHtml) =>
            this.api.sendMessage(this.chatId, asHtml ? safe : stripHtml(safe), { ...options, html: asHtml }),
        );
        return id ?? 0;
    }

    /** Send HTML blocks as one or more messages. Buttons go under the last one. */
    async sendBlocks(blocks: string[], options: MessageOptions = {}): Promise<void> {
        const messages = packBlocks(blocks);
        for (const [index, html] of messages.entries()) {
            const last = index === messages.length - 1;
            await this.send(html, { silent: options.silent || !last, ...(last && options.keyboard ? { keyboard: options.keyboard } : {}) });
        }
    }

    /**
     * Change a message. Returns the seconds Telegram asks us to wait before
     * the next edit (0 when there is no such request).
     */
    async edit(messageId: number, html: string, keyboard?: InlineKeyboard): Promise<number> {
        const safe = this.hide(html);
        try {
            await this.api.editMessage(this.chatId, messageId, safe, { html: true, ...(keyboard ? { keyboard } : {}) });
            return 0;
        } catch (error) {
            if (error instanceof TelegramApiError && error.rateLimited) return error.retryAfterSec ?? 1;
            // A live message is redrawn soon anyway; one lost edit is not worth a retry.
            this.failed("edit", error);
            return 0;
        }
    }

    async remove(messageId: number): Promise<void> {
        await this.api.deleteMessage(this.chatId, messageId).catch((error) => this.failed("delete", error));
    }

    async typing(): Promise<void> {
        await this.api.sendTyping(this.chatId).catch(() => undefined);
    }

    /** Send a file. Returns false when it could not be sent. */
    async document(fileName: string, data: Uint8Array, caption?: string): Promise<boolean> {
        try {
            await this.api.sendDocument(this.chatId, fileName, data, caption);
            return true;
        } catch (error) {
            this.failed("document", error);
            return false;
        }
    }
}
