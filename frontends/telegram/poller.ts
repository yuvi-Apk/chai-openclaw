/**
 * Fetches updates from Telegram by long polling: the PC asks, Telegram
 * answers when something arrives. Nothing has to be reachable from outside.
 */
import type { Logger } from "../../core/log";
import { TelegramApiError } from "./api/telegram-api";
import type { TelegramApi, TgUpdate } from "./api/types";
import { realClock, type Clock } from "./clock";

const POLL_SECONDS = 30;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export interface PollerOptions {
    signal: AbortSignal;
    log: Logger;
    clock?: Clock;
    pollSeconds?: number;
}

/**
 * Throw away everything sent while the bot was not running, so a message
 * from yesterday cannot start work today. Returns where to read from.
 */
async function skipBacklog(api: TelegramApi, signal: AbortSignal): Promise<number> {
    const newest = await api.getUpdates(-1, 0, signal);
    const last = newest[newest.length - 1];
    return last ? last.update_id + 1 : 0;
}

/**
 * Hand every new update to `onUpdate` until the signal aborts. `onUpdate`
 * must return at once: a turn waits for later updates (button presses), so
 * the loop may never wait for a handler.
 */
export async function runPoller(api: TelegramApi, onUpdate: (update: TgUpdate) => void, options: PollerOptions): Promise<void> {
    const { signal, log } = options;
    const clock = options.clock ?? realClock;
    let offset: number | undefined;
    let backoffMs = MIN_BACKOFF_MS;

    while (!signal.aborted) {
        try {
            if (offset === undefined) {
                offset = await skipBacklog(api, signal);
                continue;
            }
            const updates = await api.getUpdates(offset, options.pollSeconds ?? POLL_SECONDS, signal);
            for (const update of updates) {
                offset = update.update_id + 1;
                onUpdate(update);
            }
            backoffMs = MIN_BACKOFF_MS;
        } catch (error) {
            if (signal.aborted) break;
            log.event("telegram.poll_failed", { code: error instanceof TelegramApiError ? error.code : undefined });
            await clock.sleep(backoffMs);
            backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        }
    }
}
