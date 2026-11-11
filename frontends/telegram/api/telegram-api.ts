/**
 * The real Telegram Bot API, called with fetch. Telegram puts the bot token
 * in the URL path, so this file never logs a URL and removes the token from
 * every error before it leaves.
 */
import { errorText, YuviError } from "../../../core/errors";
import {
    UpdateSchema,
    type BotCommand,
    type InlineKeyboard,
    type SendOptions,
    type TelegramApi,
    type TgUpdate,
} from "./types";

const API_BASE = "https://api.telegram.org";
const CALL_TIMEOUT_MS = 15_000;
/** Extra time on top of the long-poll wait before the request is given up. */
const POLL_GRACE_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const HTTP_TOO_MANY_REQUESTS = 429;

/** A failed Bot API call. The message never contains the token. */
export class TelegramApiError extends YuviError {
    constructor(
        readonly method: string,
        message: string,
        readonly code?: number,
        /** Telegram asks to wait this long before the next call (rate limit). */
        readonly retryAfterSec?: number,
    ) {
        super(`Telegram ${method} failed: ${message}`);
    }

    get rateLimited(): boolean {
        return this.code === HTTP_TOO_MANY_REQUESTS;
    }
}

interface ApiReply {
    ok?: boolean;
    result?: unknown;
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const replyMarkup = (keyboard?: InlineKeyboard) =>
    keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {};

export class FetchTelegramApi implements TelegramApi {
    constructor(
        private readonly token: string,
        private readonly fetchFn: FetchFn = fetch,
    ) {}

    private clean(text: string): string {
        return text.split(this.token).join("[redacted]");
    }

    private async request(method: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
        const timeout = AbortSignal.timeout(timeoutMs);
        let reply: ApiReply;
        try {
            const response = await this.fetchFn(`${API_BASE}/bot${this.token}/${method}`, {
                ...init,
                method: "POST",
                signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
            });
            reply = (await response.json()) as ApiReply;
        } catch (error) {
            // A network error can quote the URL, and the URL holds the token.
            throw new TelegramApiError(method, this.clean(errorText(error)));
        }
        if (!reply.ok) {
            throw new TelegramApiError(
                method,
                this.clean(reply.description ?? "unknown error"),
                reply.error_code,
                reply.parameters?.retry_after,
            );
        }
        return reply.result;
    }

    private call(method: string, payload: object, timeoutMs = CALL_TIMEOUT_MS, signal?: AbortSignal): Promise<unknown> {
        const init = { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
        return this.request(method, init, timeoutMs, signal);
    }

    async getUpdates(offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TgUpdate[]> {
        const payload = { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] };
        const result = await this.call("getUpdates", payload, timeoutSec * 1000 + POLL_GRACE_MS, signal);
        if (!Array.isArray(result)) return [];
        return result.flatMap((raw): TgUpdate[] => {
            const parsed = UpdateSchema.safeParse(raw);
            if (parsed.success) return [parsed.data];
            // Keep the id of an update we cannot read, so the poller still moves past it.
            const id = (raw as { update_id?: unknown } | null)?.update_id;
            return typeof id === "number" ? [{ update_id: id }] : [];
        });
    }

    async sendMessage(chatId: number, text: string, options: SendOptions = {}): Promise<number> {
        const result = await this.call("sendMessage", {
            chat_id: chatId,
            text,
            ...(options.html ? { parse_mode: "HTML" } : {}),
            ...(options.silent ? { disable_notification: true } : {}),
            link_preview_options: { is_disabled: true },
            ...replyMarkup(options.keyboard),
        });
        return (result as { message_id?: number } | null)?.message_id ?? 0;
    }

    async editMessage(chatId: number, messageId: number, text: string, options: SendOptions = {}): Promise<void> {
        try {
            await this.call("editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text,
                ...(options.html ? { parse_mode: "HTML" } : {}),
                link_preview_options: { is_disabled: true },
                ...replyMarkup(options.keyboard),
            });
        } catch (error) {
            // Editing a message to the text it already has is not a failure.
            if (error instanceof TelegramApiError && /not modified/i.test(error.message)) return;
            throw error;
        }
    }

    async deleteMessage(chatId: number, messageId: number): Promise<void> {
        await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
    }

    async answerCallback(callbackId: string, text?: string): Promise<void> {
        await this.call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
    }

    async sendTyping(chatId: number): Promise<void> {
        await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
    }

    async setCommands(commands: BotCommand[], chatId?: number): Promise<void> {
        const scope = chatId === undefined ? {} : { scope: { type: "chat", chat_id: chatId } };
        await this.call("setMyCommands", { commands, ...scope });
    }

    async sendDocument(chatId: number, fileName: string, data: Uint8Array, caption?: string): Promise<void> {
        const form = new FormData();
        form.set("chat_id", String(chatId));
        if (caption) form.set("caption", caption);
        // A copy, so the bytes sit in a plain ArrayBuffer as Blob requires.
        form.set("document", new Blob([new Uint8Array(data)]), fileName);
        await this.request("sendDocument", { body: form }, DOWNLOAD_TIMEOUT_MS);
    }

    async downloadFile(fileId: string, maxBytes: number): Promise<Uint8Array> {
        const info = (await this.call("getFile", { file_id: fileId })) as { file_path?: string; file_size?: number } | null;
        if (!info?.file_path) throw new TelegramApiError("getFile", "no file path returned");
        if ((info.file_size ?? 0) > maxBytes) throw new TelegramApiError("getFile", "the file is too large");
        let bytes: Uint8Array;
        try {
            const response = await this.fetchFn(`${API_BASE}/file/bot${this.token}/${info.file_path}`, {
                signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            bytes = new Uint8Array(await response.arrayBuffer());
        } catch (error) {
            throw new TelegramApiError("download", this.clean(errorText(error)));
        }
        if (bytes.length > maxBytes) throw new TelegramApiError("download", "the file is too large");
        return bytes;
    }
}
