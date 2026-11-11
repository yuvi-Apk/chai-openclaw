/**
 * One message that is redrawn as work goes on. Telegram limits how often a
 * message may be edited, so changes are collected and written at most once
 * per interval; only the newest text is ever sent.
 */
import type { Clock } from "../clock";
import type { ChatMessenger } from "./messenger";

const DEFAULT_INTERVAL_MS = 1200;
const MS_PER_SECOND = 1000;

export class LiveMessage {
    private messageId = 0;
    private wanted = "";
    private shown = "";
    private cancelTimer: (() => void) | undefined;
    private nextAllowedAt = 0;
    private chain: Promise<void>;

    /**
     * @param after messages that must reach the chat before this one appears
     */
    constructor(
        private readonly messenger: ChatMessenger,
        private readonly clock: Clock,
        after: Promise<unknown> = Promise.resolve(),
        private readonly intervalMs = DEFAULT_INTERVAL_MS,
    ) {
        this.chain = after.then(
            () => undefined,
            () => undefined,
        );
    }

    /** True once the message exists in the chat or is about to. */
    get started(): boolean {
        return this.messageId !== 0 || this.wanted !== "";
    }

    /** Give up on a message that was never needed. */
    discard(): void {
        this.cancelTimer?.();
        this.cancelTimer = undefined;
        this.wanted = this.shown;
    }

    /** Ask for the message to show this text soon. */
    set(html: string): void {
        this.wanted = html;
        if (this.cancelTimer) return;
        const wait = Math.max(0, this.nextAllowedAt - this.clock.now());
        this.cancelTimer = this.clock.after(wait, () => {
            this.cancelTimer = undefined;
            void this.flush();
        });
    }

    /** Write the newest text now, after any write already under way. */
    private flush(): Promise<void> {
        this.chain = this.chain.then(() => this.write());
        return this.chain;
    }

    private async write(): Promise<void> {
        const html = this.wanted;
        if (!html || html === this.shown) return;
        this.nextAllowedAt = this.clock.now() + this.intervalMs;
        if (!this.messageId) {
            this.messageId = await this.messenger.send(html, { silent: true });
        } else {
            const retryAfterSec = await this.messenger.edit(this.messageId, html);
            if (retryAfterSec > 0) {
                // Not written: leave `shown` as it is so the next flush tries again.
                this.nextAllowedAt = this.clock.now() + retryAfterSec * MS_PER_SECOND;
                return;
            }
        }
        this.shown = html;
    }

    /** Show the last text (or the given one) without waiting for the interval. */
    async close(html?: string): Promise<void> {
        this.cancelTimer?.();
        this.cancelTimer = undefined;
        if (html) this.wanted = html;
        await this.flush();
    }
}
