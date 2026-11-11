/**
 * The small part of the Telegram Bot API this front end uses. Updates come
 * from the network, so they are checked against these schemas before any
 * other code sees them.
 */
import { z } from "zod";

const UserSchema = z.object({ id: z.number(), is_bot: z.boolean() });
const ChatSchema = z.object({ id: z.number(), type: z.string() });
const PhotoSchema = z.object({ file_id: z.string(), file_size: z.number().optional() });
const DocumentSchema = z.object({
    file_id: z.string(),
    file_name: z.string().optional(),
    file_size: z.number().optional(),
});

const MessageSchema = z.object({
    message_id: z.number(),
    date: z.number(),
    chat: ChatSchema,
    from: UserSchema.optional(),
    text: z.string().optional(),
    caption: z.string().optional(),
    photo: z.array(PhotoSchema).optional(),
    document: DocumentSchema.optional(),
});

const CallbackQuerySchema = z.object({
    id: z.string(),
    from: UserSchema,
    message: MessageSchema.optional(),
    data: z.string().optional(),
});

export const UpdateSchema = z.object({
    update_id: z.number(),
    message: MessageSchema.optional(),
    callback_query: CallbackQuerySchema.optional(),
});

export type TgMessage = z.infer<typeof MessageSchema>;
export type TgCallbackQuery = z.infer<typeof CallbackQuerySchema>;
export type TgUpdate = z.infer<typeof UpdateSchema>;

export interface InlineButton {
    text: string;
    /** Sent back to the bot when the button is pressed. At most 64 bytes. */
    callback_data: string;
}

/** Rows of buttons shown under a message. */
export type InlineKeyboard = InlineButton[][];

export interface SendOptions {
    /** The text is Telegram HTML. Otherwise it is sent as plain text. */
    html?: boolean;
    keyboard?: InlineKeyboard;
    /** Deliver without a notification sound. */
    silent?: boolean;
}

export interface BotCommand {
    /** Without the slash: "undo". */
    command: string;
    description: string;
}

/** Everything the front end asks of Telegram. The real one uses fetch; tests use a fake. */
export interface TelegramApi {
    /** Wait up to `timeoutSec` for updates after `offset`. A negative offset counts from the newest. */
    getUpdates(offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TgUpdate[]>;
    /** Returns the id of the new message. */
    sendMessage(chatId: number, text: string, options?: SendOptions): Promise<number>;
    editMessage(chatId: number, messageId: number, text: string, options?: SendOptions): Promise<void>;
    deleteMessage(chatId: number, messageId: number): Promise<void>;
    /** Stop the loading mark on a pressed button, with an optional short notice. */
    answerCallback(callbackId: string, text?: string): Promise<void>;
    sendTyping(chatId: number): Promise<void>;
    /** Set the "/" command list, for every chat or for one chat only. */
    setCommands(commands: BotCommand[], chatId?: number): Promise<void>;
    sendDocument(chatId: number, fileName: string, data: Uint8Array, caption?: string): Promise<void>;
    /** Download a file a user sent. Refuses anything larger than `maxBytes`. */
    downloadFile(fileId: string, maxBytes: number): Promise<Uint8Array>;
}
