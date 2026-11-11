/**
 * A small cache interface and its in-memory version.
 * The memory cache is kept for the life of the process. Entries expire after
 * their time-to-live, and the oldest entry is dropped when the cache is full.
 */
export interface Cache<T> {
    get(key: string): T | undefined;
    set(key: string, value: T, ttlMs: number): void;
}

const DEFAULT_MAX_ENTRIES = 200;

export class MemoryCache<T> implements Cache<T> {
    private readonly entries = new Map<string, { value: T; expiresAt: number }>();

    constructor(
        private readonly maxEntries = DEFAULT_MAX_ENTRIES,
        private readonly now: () => number = Date.now,
    ) {}

    get(key: string): T | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= this.now()) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key: string, value: T, ttlMs: number): void {
        if (ttlMs <= 0) return; // a zero lifetime means "do not cache"
        this.entries.delete(key);
        if (this.entries.size >= this.maxEntries) {
            // A Map remembers insertion order, so the first key is the oldest.
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
        }
        this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    }
}
