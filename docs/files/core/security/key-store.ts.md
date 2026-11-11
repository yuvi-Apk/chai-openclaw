# core/security/key-store.ts

**Purpose:** Decides **where API keys are kept**. Normally that's the operating system's own credential vault (Windows Credential Manager, macOS Keychain, libsecret on Linux), so no key sits in a plain text file. When a machine has no vault, it says so instead of crashing, and the keys go to the settings file.

**Where it fits:** Only [core/config.ts](../config.ts.md) uses it: `Settings` builds a `KeyRing` around a `KeyStore` and reads keys through it. Tests in `core/__tests__/key-store.test.ts` and the Telegram router tests pass a `MemoryKeyStore`. Background: [os-credential-vault.md](../../../concepts/os-credential-vault.md).

---

### `KEY_SERVICE` and the `KeyStore` interface

```ts
export const KEY_SERVICE = "yuvi";

export interface KeyStore {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
}
```

**What it does:** A `KeyStore` is any place that can keep a secret by name: get it, set it, delete it. Every method returns a Promise, because a real vault talks to the operating system. `get` returns `null` when there's no such key. `KEY_SERVICE` is the "folder name" all yuvi keys go under in the vault.

**Why it's used in general:** An [interface](../../../concepts/typescript-interfaces-and-utility-types.md) in front of an outside system (here the OS) lets you swap in a fake for tests. This is the **adapter behind an interface** pattern.

**Why it's used here:** The key names are the provider names (`"openrouter"`, `"openai"`, `"gemini"`, `"anthropic"`). In Windows you can see them under Credential Manager → Windows Credentials → `yuvi`.

---

### `OsKeyStore`: the real vault

```ts
export class OsKeyStore implements KeyStore {
    constructor(private readonly service = KEY_SERVICE) { }

    get(name: string): Promise<string | null> {
        return Bun.secrets.get({ service: this.service, name });
    }

    async set(name: string, value: string): Promise<void> {
        await Bun.secrets.set({ service: this.service, name, value });
    }
    // delete() is the same shape
}
```

**What it does:** Each method calls **`Bun.secrets`**, a built-in Bun API that talks to the OS vault. It needs a `service` (here `"yuvi"`) and a `name` (the provider).

**Why it's used in general:** The OS vault encrypts secrets with your login and is the standard place for passwords and tokens (Git, browsers and the GitHub CLI use it too).

**Why it's used here:** Bun has this built in, so no extra package was needed ([bun-runtime.md](../../../concepts/bun-runtime.md)). The class is only three tiny methods: all real work is in Bun.

---

### `MemoryKeyStore`: keys that vanish

```ts
export class MemoryKeyStore implements KeyStore {
    private readonly values = new Map<string, string>();

    async get(name: string): Promise<string | null> {
        return this.values.get(name) ?? null;
    }
    // set() and delete() update the Map
}
```

**What it does:** Keeps keys in a `Map` inside the program. When the program ends, they're gone. `?? null` turns "not found" (`undefined`) into the `null` the interface promises.

**Why it's used in general:** An in-memory fake makes tests fast and safe: no network, no OS, no leftovers.

**Why it's used here:** `Settings` uses it for every file that isn't your real settings file, and always under `bun test`. Two `Settings` objects can share one `MemoryKeyStore` to act like "the terminal and the bot share a vault".

---

### `KeyRing`: a memory copy and a safety net

```ts
export class KeyRing {
    private readonly cache = new Map<string, string>();
    private broken = false;

    get(name: string): string {
        return this.cache.get(name) ?? "";
    }

    async load(names: readonly string[]): Promise<void> {
        for (const name of names) {
            const value = await this.attempt(() => this.store.get(name));
            if (value) this.cache.set(name, value);
            else this.cache.delete(name);
        }
    }
}
```

**What it does:**
- `load(names)` reads each key from the store into the `cache`. A key that's gone from the vault is removed from the cache too.
- `get(name)` is **not** async: it just reads the cache, returning `""` when there's no key.
- `set` saves to the store and, only if that worked, to the cache. It returns `true` or `false`.
- `delete` forgets the key in the cache and in the store.
- `usable` is `false` once the vault has failed.

**Why it's used in general:** A **cache** keeps a copy of slow data close by. Here it turns an async source into a sync read, so code like `settings.apiKey` stays a simple getter.

**Why it's used here:** `Settings.apiKey` is read in many places, and making all of them `await` would spread `async` through the whole app. Instead, front ends call `loadKeys()` once, and every read after that is instant.

---

### `attempt()`: fail once, then stop trying

```ts
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
```

**What it does:** Runs a vault action. If it throws, the ring marks itself `broken` and returns `null`. After that, every action returns `null` straight away without touching the vault again.

**Why it's used in general:** `<T>` is a **generic**: the same helper works for an action that returns a string (`get`) or `true` (`set`). Catching an error on purpose is fine when the comment says *why*.

**Why it's used here:** Some Linux machines have no keyring service. Instead of crashing, yuvi notices once, `Settings.keyVaultWorks` becomes `false`, keys fall back to `~/.yuvi/settings.json`, and the terminal shows a warning.

💡 **Tip:** In `set`, `async () => (await this.store.set(name, value), true)` uses the **comma operator**: run the first part, then give back the second. So the action returns `true` only if `store.set` finished without throwing.

---

### 🧠 Key takeaways
- `KeyStore` is a tiny interface: get, set, delete a secret by name.
- `OsKeyStore` uses `Bun.secrets` and the OS vault; `MemoryKeyStore` is for tests and throw-away settings.
- `KeyRing` keeps a memory copy, so reading a key needs no `await`.
- A failing vault is marked unusable once, and keys fall back to the settings file.
