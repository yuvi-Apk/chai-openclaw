/**
 * The PIN lock of one chat. The bot starts locked, locks again after a
 * quiet period, and stops accepting guesses for a while after too many
 * wrong ones. A phone left unlocked on a table is the case this is for.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const MAX_WRONG_TRIES = 5;
const FIRST_BLOCK_MS = 15 * 60_000;
const MAX_BLOCK_MS = 24 * 60 * 60_000;

export type UnlockResult =
    | { ok: true }
    /** Wrong PIN. `blockedMs` is set when no more guesses are accepted for now. */
    | { ok: false; triesLeft: number; blockedMs: number };

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest();

export class PinLock {
    private locked = true;
    private lastActiveAt = 0;
    private wrongTries = 0;
    private blockedUntil = 0;
    private nextBlockMs = FIRST_BLOCK_MS;

    constructor(
        private readonly pin: string,
        private readonly idleMs: number,
        private readonly now: () => number = Date.now,
    ) {}

    isLocked(): boolean {
        if (!this.locked && this.now() - this.lastActiveAt > this.idleMs) this.locked = true;
        return this.locked;
    }

    /** The user did something: start the quiet period again. */
    touch(): void {
        if (!this.locked) this.lastActiveAt = this.now();
    }

    lock(): void {
        this.locked = true;
    }

    /** How long guesses are still refused, in ms. 0 when they are accepted. */
    blockedMs(): number {
        return Math.max(0, this.blockedUntil - this.now());
    }

    tryUnlock(candidate: string): UnlockResult {
        const blocked = this.blockedMs();
        if (blocked > 0) return { ok: false, triesLeft: 0, blockedMs: blocked };

        // Compare hashes in constant time, so timing says nothing about the PIN.
        if (timingSafeEqual(digest(candidate.trim()), digest(this.pin))) {
            this.locked = false;
            this.wrongTries = 0;
            this.nextBlockMs = FIRST_BLOCK_MS;
            this.lastActiveAt = this.now();
            return { ok: true };
        }

        this.wrongTries++;
        if (this.wrongTries < MAX_WRONG_TRIES) {
            return { ok: false, triesLeft: MAX_WRONG_TRIES - this.wrongTries, blockedMs: 0 };
        }
        this.wrongTries = 0;
        this.blockedUntil = this.now() + this.nextBlockMs;
        const blockedMs = this.nextBlockMs;
        this.nextBlockMs = Math.min(this.nextBlockMs * 2, MAX_BLOCK_MS);
        return { ok: false, triesLeft: 0, blockedMs };
    }
}
