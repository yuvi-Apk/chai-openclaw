# core/config.ts

**Purpose:** The **one place settings come from**. It reads the environment (`.env`), the user's saved settings file and the OS credential vault, picks the right value, and gives a default. It also saves the choices you make in the menus (key, provider, model, effort). No other file reads `process.env`.

**Where it fits:** Everything that needs a setting gets a `Settings` object passed in. [core/llm/providers.ts](llm/providers.ts.md) asks it for the provider, key and model; [core/llm/profiles.ts](llm/profiles.ts.md) tells it *which* variables to read for the provider in use; [core/llm/choices.ts](llm/choices.ts.md) builds menu options from it. Keys are kept through [core/security/key-store.ts](security/key-store.ts.md); the shapes it works with live in [core/settings-types.ts](settings-types.ts.md). Front ends such as [login.ts](../frontends/terminal/login.ts.md), [model-menu.ts](../frontends/terminal/model-menu.ts.md) and [model-settings.ts](../frontends/telegram/model-settings.ts.md) save choices through it. Background: [environment-variables.md](../../concepts/environment-variables.md), [user-settings-file.md](../../concepts/user-settings-file.md) and [os-credential-vault.md](../../concepts/os-credential-vault.md).

---

### The types, moved next door

```ts
import { REASONING_EFFORTS, type KeySource, type ModelRole, type ReasoningEffort, type UserSettings } from "./settings-types";

export { REASONING_EFFORTS, type KeySource, type ModelRole, type ReasoningEffort, type UserSettings };
```

**What it does:** The types (`UserSettings`, `ModelRole`, `ReasoningEffort`, `KeySource`) and the `REASONING_EFFORTS` list now live in [settings-types.ts](settings-types.ts.md). This file imports them and **re-exports** them in the same line style.

**Why it's used in general:** A re-export lets you move code to a new file without changing every `import` in the project. It's the same idea as a [barrel file](../../concepts/barrel-files.md).

**Why it's used here:** Everyone still writes `import type { UserSettings } from "./config"`, while this file stays about *reading and saving* values, not about describing shapes.

---

### The `Settings` constructor and `usesRealVault()`

```ts
function usesRealVault(file: string | null): boolean {
    return file === userSettingsFile() && process.env.NODE_ENV !== "test";
}

constructor(
    private readonly env: Env = process.env,
    private readonly file: string | null = userSettingsFile(),
    store: KeyStore = usesRealVault(file) ? new OsKeyStore() : new MemoryKeyStore(),
) {
    this.keys = new KeyRing(store);
    this.reload();
}
```

**What it does:**
- `env` is where environment values come from; `file` is the settings file (`null` = memory only, for tests).
- `store` is **where keys are kept**. By default, only the user's real `~/.yuvi/settings.json` pairs with the real OS vault (`OsKeyStore`). Any other file, or a run under `bun test` (which sets `NODE_ENV=test`), gets a `MemoryKeyStore` that forgets everything when the program ends.
- The store is wrapped in a `KeyRing`, which keeps a copy in memory so reading a key needs no `await`.

**Why it's used in general:** Passing collaborators in through the constructor is [dependency injection](../../concepts/typescript-classes.md). A default value means normal callers don't need to think about it; tests can pass their own.

**Why it's used here:** A test must **never** read or overwrite your real keys. With this default, `new Settings({}, tempFile)` is automatically safe. A test that wants to share a vault between two `Settings` objects passes the same `MemoryKeyStore` to both.

---

### `loadKeys()` and `keyVaultWorks`

```ts
async loadKeys(): Promise<void> {
    this.reload();
    const names = Object.keys(LLM_PROFILES);
    await this.keys.load(names);
    for (const name of names) {
        const field = profileFor(name).savedKey;
        const old = this.saved[field];
        if (!old || typeof old !== "string") continue;
        if (this.keys.get(name) || (await this.keys.set(name, old))) this.save({ [field]: "" });
    }
}
```

**What it does:**
1. Re-reads the settings file.
2. Reads every provider's key from the vault into memory (`openrouter`, `openai`, `gemini`, `anthropic`).
3. **Moves old keys.** If an older version left a key in the settings file (like `"apiKey": "sk-or-..."`): when the vault already has one, or saving it to the vault works, the file field is cleared. If the vault doesn't work, the key simply stays in the file.

`keyVaultWorks` is `false` when the vault failed, so the terminal can warn that keys are kept in the file.

**Why it's used in general:** This is a small **migration**: data saved in an old format is moved to the new place on the next start, so users don't have to do anything.

**Why it's used here:** Reading the vault is `async` (it talks to the operating system), and a constructor can't `await`. So front ends call `await settings.loadKeys()` once at start: [app.ts](../frontends/terminal/app.ts.md), [session-loop.ts](../frontends/terminal/session-loop.ts.md), the Telegram bot's [app.ts](../frontends/telegram/app.ts.md). Telegram's `/provider` calls it again, so a terminal login is seen without a restart.

---

### `reload()` and `save()`

```ts
save(patch: UserSettings): void {
    this.saved = { ...this.saved, ...patch };
    for (const [key, value] of Object.entries(patch)) {
        const field = key as keyof UserSettings;
        // An empty value clears the setting, so the environment or default applies again.
        if (value) {
            this.changed[field] = value;
        } else {
            delete this.changed[field];
            delete this.saved[field];
        }
    }
    // ...write the file with mode 0o600
}
```

**What it does:**
- `reload()` reads the JSON file again; a missing or broken file just means "nothing saved".
- `save()` merges new values in and writes the file (`0o600` = only you can read it). A non-empty value goes into `changed`, so it wins for the rest of this run. An **empty** value is deleted from both `changed` and `saved`, so the field disappears from the file completely. The `.env` value or the default takes over again.

**Why it's used here:** The "empty clears" rule lets the effort menu go back to "default", and it's how a key is wiped from the file after it moves to the vault: `save({ apiKey: "" })` leaves no `"apiKey": ""` line behind.

---

### Generic readers: `string`, `number`, `flag`, `isOff`, `list`

```ts
number(name: string, fallback: number, min: number, max: number): number {
    const raw = this.env[name];
    const value = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value)));
}
```

**What it does:** Small helpers for settings a mode owns itself. `number` keeps a value between `min` and `max`; `flag` is true for `1`, `true` or `on`; `isOff` is true only for `off` (for features that are on by default); `list` splits a value like `a;b;c`.

**Why it's used in general:** Env values are always strings and can be anything. Checking them at the edge means the rest of the code can trust them.

**Why it's used here:** Chat mode settings like `YUVI_CHAT_MAX_CALLS` go through `number`, so a typo can't set a crazy limit.

---

### `llmProfile`, `pick()` and `pickString()`: the provider in use

```ts
private pick(envName: string, saved: keyof UserSettings): string {
    return this.changed[saved] || this.env[envName] || this.saved[saved] || "";
}

private pickString(envName: string, saved: keyof UserSettings): string {
    const value = this.pick(envName, saved);
    return typeof value === "string" ? value : "";
}
```

**What it does:** `llmProfile` returns the [profile](llm/profiles.ts.md) for the provider in use. `pick` finds a value in a fixed order:
1. something you saved **during this run** (a key you just pasted, a provider you just picked),
2. the **environment** (`.env`),
3. the **saved file**,
4. otherwise an empty string.

`pickString` is the same, but throws away a value that isn't text. Someone could hand-edit the file to `"llmProvider": 42`; that is then simply ignored.

**Why it's used in general:** A clear "who wins" order is called **precedence**. Writing it once in a helper means every setting follows the same rule. Checking the type of data read from a file is validating at the boundary.

**Why it's used here:** `modelId`, `reasoning` and `llmProvider` all follow this order, so one piece of code serves all four providers. Keys have a slightly longer order of their own (next section). See [concepts/provider-profiles.md](../../concepts/provider-profiles.md).

---

### `apiKey`, `keyFor()` and `keySource()`: where a key comes from

```ts
private keyFor(provider: string): string {
    const { keyEnv, savedKey } = profileFor(provider);
    const saved = this.saved[savedKey];
    return this.changed[savedKey] || this.env[keyEnv] || this.keys.get(provider) || (typeof saved === "string" ? saved : "");
}

keySource(provider: string): KeySource {
    const { keyEnv, savedKey } = profileFor(provider);
    if (this.changed[savedKey]) return "file";
    if (this.env[keyEnv]) return "env";
    if (this.keys.get(provider)) return "vault";
    return this.saved[savedKey] ? "file" : "none";
}
```

**What it does:** `keyFor` finds a provider's key in this order:
1. a key saved to the file **during this run** (only happens when there's no vault),
2. `.env` (like `OPENAI_API_KEY`),
3. the **vault**,
4. an old key still in the settings file.

`apiKey` is just `keyFor(this.llmProvider)`. `keySource` walks the same order but answers *where* the key is: `"env"`, `"vault"`, `"file"` or `"none"`.

**Why it's used in general:** Keeping "find the value" and "say where it came from" in the same order means they can never disagree.

**Why it's used here:** The log-out menu needs `keySource`: a vault key can be removed, but a `.env` key can't (yuvi never edits `.env`), so [login.ts](../frontends/terminal/login.ts.md) tells you which line to delete instead.

---

### `saveApiKey()`, `forgetKey()`, `hasKey()`

```ts
async saveApiKey(key: string, provider = this.llmProvider): Promise<void> {
    const field = profileFor(provider).savedKey;
    if (await this.keys.set(provider, key)) this.save({ [field]: "" });
    else this.save({ [field]: key });
}

async forgetKey(provider: string): Promise<void> {
    await this.keys.delete(provider);
    this.save({ [profileFor(provider).savedKey]: "" });
}
```

**What it does:**
- `saveApiKey` tries the vault first. If that works, the provider's file field is cleared (so no copy is left in plain text). If the vault can't be used, the key goes into the file instead. The provider defaults to the one in use, but you can name another.
- `forgetKey` removes the key from the vault **and** the file. A key in `.env` stays, because this class never writes `.env`.
- `hasKey` answers "does this provider have a key anywhere?" using `keyFor`.
- `{ [field]: value }` is a **computed property name**: the object key is whatever `field` holds.

**Why it's used in general:** Callers say *what* they want ("save this key for Gemini") and the class decides *where*. Having a fallback keeps the app working on machines without a vault.

**Why it's used here:** Both are `async` now because the vault is. That's why callers write `await settings.saveApiKey(...)`. `hasKey` is how menus show "no key yet" and how Telegram refuses a provider with no key.

---

### `modelId()`: which model for which job

```ts
modelId(role: ModelRole = "main", provider = this.llmProvider): string {
    const profile = profileFor(provider);
    const main = this.pick(profile.modelEnv, profile.savedModel) || profile.defaultModel;
    if (role === "main") return main;
    return this.pick(profile.fastModelEnv, profile.savedFastModel) || profile.defaultFastModel || main;
}
```

**What it does:** There are two roles. `main` does the real work (planning, editing, answering). `fast` does small internal jobs (triage, routing, summaries). For `fast` it tries, in order: the fast model you set, the profile's cheaper default (`defaultFastModel`), then the main model. The `provider` parameter defaults to the one in use, but you can ask about another: [verify-key.ts](llm/verify-key.ts.md) uses `modelId("main", "anthropic")` to test a new Claude key while you're still on OpenRouter.

**Why it's used in general:** Using a cheap model for small steps saves money and time.

**Why it's used here:** Claude's profile sets `defaultFastModel: "claude-haiku-5-5"`, so even with no settings the small jobs go to Haiku while the real work uses Sonnet. Other providers have no fast default, so `fast` just uses the main model.

---

### `reasoning`, `saveReasoning()` and `REASONING_EFFORTS`

```ts
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

get reasoning(): ReasoningEffort | "off" | undefined {
    const value = this.pickString("YUVI_REASONING", "reasoning").toLowerCase();
    if (value === "off") return "off";
    return REASONING_EFFORTS.find((effort) => effort === value);
}

saveReasoning(effort: ReasoningEffort | "off" | undefined): void {
    this.save({ reasoning: effort ?? "" });
}
```

**What it does:** `reasoning` is how hard the model should "think". It comes from this run, `YUVI_REASONING`, or the saved file. `"off"` means "send no effort at all"; `undefined` means "let each mode choose". Any other text (like `"loud"`) isn't in the list, so `find` returns `undefined`. `saveReasoning(undefined)` saves an empty string, which (thanks to `save()`) clears the choice.

**Why it's used in general:** `?? ""` means "if it's `undefined` or `null`, use `""` instead". Checking against a fixed list turns any string into a safe [union type](../../concepts/typescript-union-types.md).

**Why it's used here:** `REASONING_EFFORTS` is defined in [settings-types.ts](settings-types.ts.md) and re-exported here, so [choices.ts](llm/choices.ts.md) can build the effort menu from the same list. `readonly` stops anyone changing it by accident.

---

### `llmProvider`, `saveProvider()` and the "set in .env" flags

```ts
get llmProvider(): string {
    const env = this.env.YUVI_LLM || this.env.YUVI_CHAT_LLM;
    return (this.changed.llmProvider || env || this.pickString("", "llmProvider") || DEFAULT_LLM_PROVIDER).toLowerCase();
}

saveProvider(name: string): void {
    if (!LLM_PROFILES[name]) {
        throw new ConfigError(`Unknown model provider "${name}". Available: ...`);
    }
    this.save({ llmProvider: name });
}
```

**What it does:**
- `llmProvider` follows the usual order: a pick made now → `YUVI_LLM` in `.env` → the saved file → `openrouter`. It is lower-cased, so `OpenAI` works.
- `saveProvider` refuses a name with no profile (a [`ConfigError`](errors.ts.md)), so a typo can never be saved.
- `providerSetInEnv` and `reasoningSetInEnv` are true when `.env` names the value.

**Why it's used in general:** Refusing bad input *before* saving it keeps the settings file always valid.

**Why it's used here:** A menu pick wins straight away, but at the next start `.env` wins over the saved file. The two flags let the menus warn you: "`.env` sets this too; remove that line to keep this choice."

💡 **Tip:** Next to these live `searchProvider` (`YUVI_SEARCH`), `tavilyApiKey`, `telegramToken`, `telegramPin`, `logEnabled` (`YUVI_LOG`) and `devMode` (`YUVI_DEV`). The full list is in `.env.example` and the [root README](../README.md.md).

---

### `secrets()`, `childEnv()` and `SECRET_ENV_NAMES`

```ts
static readonly SECRET_ENV_NAMES: readonly string[] = [
    ...new Set(Object.values(LLM_PROFILES).map((profile) => profile.keyEnv)),
    "TAVILY_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "YUVI_TELEGRAM_PIN",
];
```

**What it does:**
- `secrets()` lists every secret value so the logger and redaction can hide them. It collects the key of **every** provider (through `keyFor`, so `.env`, vault and file keys all count), not only the active one. Very short values (under 8 characters) are skipped, because hiding them would blank out normal words.
- `childEnv()` copies the environment and deletes every name in `SECRET_ENV_NAMES`, so shell commands the agent runs can't read your keys.
- `SECRET_ENV_NAMES` is **built from the profiles**: every profile's `keyEnv`, made unique with `new Set`, then spread (`...`) into the array.

**Why it's used in general:** Secrets should be hidden in two ways: never shown in output, and never handed to programs that don't need them. Deriving a list from data instead of typing it by hand means it can't fall out of date.

**Why it's used here:** Adding a profile for a new provider automatically hides `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` or any future key. Nobody has to remember a second list.

---

### 🧠 Key takeaways
- Only this file reads `process.env` and `~/.yuvi/settings.json`; keys go through a `KeyStore`.
- One order for most values: this run → environment → saved file → default. Keys: this run → `.env` → vault → old file value.
- Keys live in the OS vault; old file keys move there on `loadKeys()`, and without a vault they fall back to the file.
- Tests never touch the real vault: only the real settings file outside `bun test` uses it.
- Provider, model, key and effort can all be picked in a menu and saved; an empty save clears a choice.
- `saveProvider` refuses unknown names; `hasKey` tells the menus which providers are ready.
- All provider keys are hidden from output and removed from shell commands, using a list built from the profiles.
