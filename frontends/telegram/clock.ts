/** Time as the front end sees it, so tests can move it by hand. */

export interface Clock {
    now(): number;
    /** Run `fn` after `ms`. Returns a function that cancels it. */
    after(ms: number, fn: () => void): () => void;
    sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
    now: () => Date.now(),
    after(ms, fn) {
        const timer = setTimeout(fn, ms);
        // A pending timer must not keep the process alive after the bot stops.
        timer.unref?.();
        return () => clearTimeout(timer);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
