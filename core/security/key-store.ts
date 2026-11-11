/**
 * Where API keys are kept: the operating system's vault (Windows Credential
 * Manager, macOS Keychain, libsecret on Linux) through Bun.secrets, so no key
 * sits in a plain text file. KeyRing keeps a copy in memory, so settings can
 * be read without waiting.
 */

/** The vault service name every yuvi key is stored under. */
export const KEY_SERVICE = "yuvi";

/** A place to keep secrets by name. A boundary to the OS, so tests use MemoryKeyStore. */
export interface KeyStore {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
}

/** The operating system's credential vault. */
export class OsKeyStore implements KeyStore {
    constructor(private readonly service = KEY_SERVICE) { }

    get(name: string): Promise<string | null> {
        return Bun.secrets.get({ service: this.service, name });
    }

    async set(name: string, value: string): Promise<void> {
        await Bun.secrets.set({ service: this.service, name, value });
    }

    async delete(name: string): Promise<void> {
        await Bun.secrets.delete({ service: this.service, name });
    }
}

/** Keys kept in memory only: for tests and for Settings with no saved file. */
export class MemoryKeyStore implements KeyStore {
    private readonly values = new Map<string, string>();

    async get(name: string): Promise<string | null> {
        return this.values.get(name) ?? null;
    }

    async set(name: string, value: string): Promise<void> {
        this.values.set(name, value);
    }

    async delete(name: string): Promise<void> {
        this.values.delete(name);
    }
}

/**
 * A KeyStore with a memory copy. When the vault fails (no keyring service on
 * this machine) it is marked unusable and callers fall back to the file.
 */
export class KeyRing {
    private readonly cache = new Map<string, string>();
    private broken = false;

    constructor(private readonly store: KeyStore) { }

    /** False once the vault has failed: keys then go to the settings file. */
    get usable(): boolean {
        return !this.broken;
    }

    /** The key loaded for a name, or "" when there is none. */
    get(name: string): string {
        return this.cache.get(name) ?? "";
    }

    /** Read these names from the vault into memory. */
    async load(names: readonly string[]): Promise<void> {
        for (const name of names) {
            const value = await this.attempt(() => this.store.get(name));
            if (value) this.cache.set(name, value);
            else this.cache.delete(name);
        }
    }

    /** Keep a key in the vault. False when the vault cannot be used. */
    async set(name: string, value: string): Promise<boolean> {
        const done = await this.attempt(async () => (await this.store.set(name, value), true));
        if (done) this.cache.set(name, value);
        return Boolean(done);
    }

    /** Remove a key from the vault and from memory. */
    async delete(name: string): Promise<void> {
        this.cache.delete(name);
        await this.attempt(() => this.store.delete(name));
    }

    private async attempt<T>(action: () => Promise<T>): Promise<T | null> {
        if (this.broken) return null;
        try {
            return await action();
        } catch {
            // No vault on this machine (or it refused): use the settings file instead.
            this.broken = true;
            return null;
        }
    }
}
