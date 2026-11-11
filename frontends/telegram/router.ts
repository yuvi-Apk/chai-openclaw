/**
 * The front door. Every update from Telegram passes these checks, in this
 * order, before anything else runs: is it a private chat with an allowed
 * user, is the user sending too fast, is the bot unlocked. Only then does
 * the update reach the chat's controller or answer a waiting question.
 */
import type { Core } from "../../core/compose";
import { formatDuration } from "../../core/format";
import type { ModeRegistry } from "../../core/mode";
import { RateLimiter } from "../../core/security/limits";
import type { TelegramApi, TgCallbackQuery, TgMessage, TgUpdate } from "./api/types";
import { ChatController, COMMAND_BUTTON_PREFIX } from "./chat-controller";
import type { Clock } from "./clock";
import { parseCommand } from "./commands";
import type { TelegramConfig } from "./config";
import { MAX_UPLOAD_BYTES } from "./files";
import { PinLock } from "./lock";
import { Questions } from "./questions";

const MAX_MESSAGES_PER_MINUTE = 30;
const PHOTO_MEDIA_TYPE = "image/jpeg";
const LOCKED_NOTICE = "🔒 Locked. Send /unlock, then your PIN.";

export interface RouterDeps {
    api: TelegramApi;
    core: Core;
    registry: ModeRegistry;
    config: TelegramConfig;
    clock: Clock;
    questions?: Questions;
}

interface Chat {
    controller: ChatController;
    lock: PinLock;
    limiter: RateLimiter;
    awaitingPin: boolean;
    /** The "slow down" notice was sent and not yet followed by an accepted message. */
    warnedAboutRate: boolean;
}

export class Router {
    private readonly chats = new Map<number, Chat>();
    private readonly questions: Questions;

    constructor(private readonly deps: RouterDeps) {
        this.questions = deps.questions ?? new Questions(deps.clock);
    }

    /** Take one update. Returns at once; the work goes on in the background. */
    handle(update: TgUpdate): void {
        void this.dispatch(update).catch(() => this.deps.core.log.event("telegram.update_failed"));
    }

    /** The same, but resolves when the update has been dealt with (for tests). */
    async dispatch(update: TgUpdate): Promise<void> {
        if (update.message) await this.onMessage(update.message);
        else if (update.callback_query) await this.onCallback(update.callback_query);
    }

    private chat(chatId: number): Chat {
        let chat = this.chats.get(chatId);
        if (!chat) {
            const { clock, config } = this.deps;
            chat = {
                controller: new ChatController({ ...this.deps, chatId, questions: this.questions }),
                lock: new PinLock(config.pin, config.lockIdleMs, () => clock.now()),
                limiter: new RateLimiter(MAX_MESSAGES_PER_MINUTE, undefined, () => clock.now()),
                awaitingPin: false,
                warnedAboutRate: false,
            };
            this.chats.set(chatId, chat);
        }
        return chat;
    }

    /** Only a person on the allowlist, writing to the bot in a private chat. */
    private allowed(userId: number, isBot: boolean, chat: { id: number; type: string } | undefined): boolean {
        const ok = !isBot && chat?.type === "private" && chat.id === userId && this.deps.config.users.has(userId);
        if (!ok) this.deps.core.log.event("telegram.refused", { chatType: chat?.type });
        return ok;
    }

    // ---------- messages ----------

    private async onMessage(message: TgMessage): Promise<void> {
        if (!message.from || !this.allowed(message.from.id, message.from.is_bot, message.chat)) return;
        const chat = this.chat(message.chat.id);
        const { controller } = chat;

        if (!chat.limiter.tryTake()) {
            if (!chat.warnedAboutRate) await controller.messenger.send("◆ Too many messages. Wait a minute.");
            chat.warnedAboutRate = true;
            return;
        }
        chat.warnedAboutRate = false;
        if (await this.handleLock(chat, message)) return;
        chat.lock.touch();

        if (message.document) return controller.onDocument(message.document, message.caption ?? "");
        if (message.photo?.length) return this.onPhoto(chat, message);
        const text = message.text ?? "";
        if (!text.trim()) return;
        // A command ends a wait for a reply; anything else answers it.
        if (text.trim().startsWith("/")) this.questions.dropText(message.chat.id);
        else if (this.questions.offerText(message.chat.id, text)) return;
        await controller.onText(text);
    }

    private async onPhoto(chat: Chat, message: TgMessage): Promise<void> {
        // Telegram sends several sizes, smallest first.
        const largest = message.photo?.[message.photo.length - 1];
        if (!largest) return;
        try {
            const data = await this.deps.api.downloadFile(largest.file_id, MAX_UPLOAD_BYTES);
            await chat.controller.onPhoto(message.caption ?? "", { mediaType: PHOTO_MEDIA_TYPE, data });
        } catch {
            await chat.controller.messenger.send("✗ The photo could not be downloaded.");
        }
    }

    // ---------- the lock ----------

    /** Deal with lock commands and a locked bot. Returns true when the message goes no further. */
    private async handleLock(chat: Chat, message: TgMessage): Promise<boolean> {
        const { controller, lock } = chat;
        const text = (message.text ?? "").trim();
        const { name, arg } = text.startsWith("/") ? parseCommand(text) : { name: "", arg: "" };

        if (name === "/lock") {
            lock.lock();
            this.questions.dropText(message.chat.id);
            await controller.messenger.send("🔒 Locked.");
            return true;
        }
        if (name === "/unlock") {
            // A PIN typed after the command must not stay readable in the chat.
            if (arg) await controller.messenger.remove(message.message_id);
            if (!lock.isLocked()) {
                await controller.messenger.send("🔓 Already unlocked.");
            } else if (arg) {
                await this.tryPin(chat, arg);
            } else {
                chat.awaitingPin = true;
                await controller.messenger.send("Send your PIN. I delete your message right after reading it.");
            }
            return true;
        }
        if (!lock.isLocked()) return false;

        if (chat.awaitingPin && text && !name) {
            await controller.messenger.remove(message.message_id);
            await this.tryPin(chat, text);
            return true;
        }
        await controller.messenger.send(LOCKED_NOTICE);
        return true;
    }

    private async tryPin(chat: Chat, candidate: string): Promise<void> {
        const { controller, lock } = chat;
        const result = lock.tryUnlock(candidate);
        chat.awaitingPin = false;
        this.deps.core.log.event("telegram.unlock", { ok: result.ok });
        if (result.ok) {
            const idle = formatDuration(this.deps.config.lockIdleMs);
            return void (await controller.messenger.send(`🔓 Unlocked. It locks again after ${idle} without a message, or with /lock.`));
        }
        if (result.blockedMs > 0) {
            return void (await controller.messenger.send(`✗ Too many wrong tries. Try again in ${formatDuration(result.blockedMs)}.`));
        }
        chat.awaitingPin = true;
        await controller.messenger.send(`✗ Wrong PIN. ${result.triesLeft} tries left. Send it again.`);
    }

    // ---------- buttons ----------

    private async onCallback(query: TgCallbackQuery): Promise<void> {
        if (!this.allowed(query.from.id, query.from.is_bot, query.message?.chat)) return;
        const chat = this.chat(query.from.id);
        const answer = (text?: string) => this.deps.api.answerCallback(query.id, text).catch(() => undefined);

        if (chat.lock.isLocked()) return void (await answer("Locked. Send /unlock first."));
        chat.lock.touch();
        const data = query.data ?? "";
        if (Questions.owns(data)) {
            const pressed = this.questions.press(query.from.id, data);
            return void (await answer(pressed ? undefined : "This button has expired."));
        }
        await answer();
        // A shortcut button only ever runs a command, exactly as if it were typed.
        const command = data.startsWith(COMMAND_BUTTON_PREFIX) ? data.slice(COMMAND_BUTTON_PREFIX.length) : "";
        if (command.startsWith("/")) await chat.controller.onText(command);
    }

    /** Stop every chat's work, for shutdown. */
    async shutdown(): Promise<void> {
        await Promise.all([...this.chats.values()].map((chat) => chat.controller.shutdown()));
    }
}
