/**
 * Size, rate and spending limits: how long an input may be, how often
 * something may happen, and how much one message may cost.
 */
import { BudgetError } from "../errors";

/** Cut a very long message so one paste cannot blow the token budget. */
export function limitInput(text: string, maxChars: number): { text: string; truncated: boolean } {
    const clean = text.trim();
    if (clean.length <= maxChars) return { text: clean, truncated: false };
    return { text: clean.slice(0, maxChars), truncated: true };
}

/** Rough token count. Good enough for budgets; real counts come from the provider. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** Share of a clipped text that is kept from its start; the rest comes from its end. */
const CLIP_HEAD_SHARE = 0.6;

/** Shorten a long text, keeping the start and the end, and say how much was left out. */
export function clipMiddle(text: string, max: number): string {
    if (text.length <= max) return text;
    const head = Math.floor(max * CLIP_HEAD_SHARE);
    const tail = max - head;
    return (
        text.slice(0, head) +
        `\n\n… [${text.length - max} characters omitted] …\n\n` +
        text.slice(text.length - tail)
    );
}

/** Allows at most `max` actions in any one-minute window. */
export class RateLimiter {
    private stamps: number[] = [];

    constructor(
        private readonly max: number,
        private readonly windowMs = 60_000,
        private readonly now: () => number = Date.now,
    ) {}

    /** Take one slot. Returns false when the window is full. */
    tryTake(): boolean {
        const cutoff = this.now() - this.windowMs;
        this.stamps = this.stamps.filter((t) => t > cutoff);
        if (this.stamps.length >= this.max) return false;
        this.stamps.push(this.now());
        return true;
    }
}

/**
 * The spending limit of one message. The call count is a hard stop. The
 * token count only switches off optional steps, so the user still gets an
 * answer from what was already gathered.
 */
export class CallBudget {
    calls = 0;
    tokens = 0;

    constructor(
        readonly maxCalls: number,
        readonly maxTokens: number,
    ) {}

    /** Is there room for one more call, leaving `reserve` calls for later steps? */
    hasRoom(reserve = 0): boolean {
        return this.calls + 1 + reserve <= this.maxCalls;
    }

    /** Room for an optional step: also requires that tokens are not used up. */
    hasRoomForOptional(reserve = 1): boolean {
        return this.hasRoom(reserve) && this.tokens < this.maxTokens;
    }

    startCall(): void {
        if (!this.hasRoom()) {
            throw new BudgetError(`This message reached its limit of ${this.maxCalls} model calls.`);
        }
        this.calls++;
    }

    addTokens(count: number): void {
        this.tokens += count;
    }
}
