# core/config.ts

**Purpose:** The **one place settings come from**. It reads the environment (`.env`) and the user's saved settings file, picks the right value, and gives a default. No other file reads `process.env`.

**Where it fits:** Everything that needs a setting gets a `Settings` object passed in. [core/llm/providers.ts](llm/providers.ts.md) asks it for the key and model; [core/llm/profiles.ts](llm/profiles.ts.md) tells it *which* variables to read for the provider in use. Front ends such as [prompts.ts](../frontends/terminal/prompts.ts.md) save keys and models through it. Background: [environment-variables.md](../../concepts/environment-variables.md) and [user-settings-file.md](../../concepts/user-settings-file.md).

---

### `UserSettings`: what is saved on disk

```ts
export interface UserSettings {
    /** OpenRouter key and models (the names predate other providers). */
    apiKey?: string;
    model?: string;
    fastModel?: string;
    openaiApiKey?: string;
    openaiModel?: string;
    openaiFastModel?: string;
}
```

**What it does:** Describes `~/.yuvi/settings.json`. Every field is optional (`?`). The first three belong to OpenRouter; the `openai...` ones belong to OpenAI.

**Why it's used in general:** Saving settings in the home folder means they work in every project, not just one.

**Why it's used here:** OpenRouter keeps the old names (`apiKey`, `model`) so files saved by earlier versions still work. Each provider has its own fields, so both keys can live in the file side by side.

---

### The `Settings` constructor, `reload()` and `save()`

```ts
constructor(
    private readonly env: Env = process.env,
    private readonly file: string | null = userSettingsFile(),
) {
    this.reload();
}

save(patch: UserSettings): void {
    this.saved = { ...this.saved, ...patch };
    for (const [key, value] of Object.entries(patch)) {
        if (value) this.changed[key as keyof UserSettings] = value;
    }
    // ...write the file with mode 0o600
}
```

**What it does:**
- The constructor takes where env values come from and which file to use. `null` means "memory only", which tests use.
- `reload()` reads the JSON file; a missing or broken file just means "nothing saved".
- `save()` merges new values in, remembers them in `changed` (so they win for the rest of this run), and writes the file. `0o600` means only you can read it.

**Why it's used in general:** Passing the environment in, instead of reading `process.env` everywhere, makes code easy to test. This is [dependency injection](../../concepts/typescript-classes.md).

**Why it's used here:** A test can write `new Settings({ YUVI_LLM: "openai" }, null)` and get a fully controlled, throw-away setup.

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

### `llmProfile` and `pick()`: the provider in use

```ts
get llmProfile(): LLMProviderProfile {
    return profileFor(this.llmProvider);
}

/** A value saved during this run, then the environment, then the saved file. */
private pick(envName: string, saved: keyof UserSettings): string {
    return this.changed[saved] || this.env[envName] || this.saved[saved] || "";
}
```

**What it does:** `llmProfile` returns the [profile](llm/profiles.ts.md) for `YUVI_LLM`. `pick` finds a value in a fixed order:
1. something you saved **during this run** (e.g. a key you just pasted),
2. the **environment** (`.env`),
3. the **saved file**,
4. otherwise an empty string.

**Why it's used in general:** A clear "who wins" order is called **precedence**. Writing it once in a helper means every setting follows the same rule.

**Why it's used here:** `apiKey` and `modelId` both use `pick` with names from the profile. That's how one piece of code serves both OpenRouter and OpenAI. See [concepts/provider-profiles.md](../../concepts/provider-profiles.md).

---

### `apiKey`, `saveApiKey()`, `saveModel()`

```ts
get apiKey(): string {
    const profile = this.llmProfile;
    return this.pick(profile.keyEnv, profile.savedKey);
}

saveApiKey(key: string): void {
    this.save({ [this.llmProfile.savedKey]: key });
}

saveModel(modelId: string): void {
    this.save({ [this.llmProfile.savedModel]: modelId });
}
```

**What it does:** `apiKey` gives the key of the active provider. `saveApiKey` and `saveModel` save to the active provider's field. `{ [name]: value }` is a **computed property name**: the key of the object is whatever `name` holds.

**Why it's used in general:** Callers say *what* they want ("save this key") and the class decides *where*. Callers don't need to know the field names.

**Why it's used here:** With `YUVI_LLM=openai`, saving a key writes `openaiApiKey`; with OpenRouter it writes `apiKey`. The terminal and Telegram front ends just call `saveApiKey` / `saveModel`.

---

### `modelId()`: which model for which job

```ts
modelId(role: ModelRole = "main"): string {
    const profile = this.llmProfile;
    const main = this.pick(profile.modelEnv, profile.savedModel) || profile.defaultModel;
    if (role === "main") return main;
    return this.pick(profile.fastModelEnv, profile.savedFastModel) || main;
}
```

**What it does:** There are two roles. `main` does the real work (planning, editing, answering). `fast` does small internal jobs (triage, routing, summaries). If no fast model is set, it uses the main one. If no main model is set, it uses the profile's default (`openrouter/free` or `gpt-5-mini`).

**Why it's used in general:** Using a cheap model for small steps saves money and time.

**Why it's used here:** OpenAI reads `OPENAI_DEFAULT_MODEL` / `OPENAI_FAST_MODEL`; OpenRouter reads `OPENROUTER_DEFAULT_MODEL` / `YUVI_MODEL_FAST`. They never mix.

---

### Other shared settings

```ts
get llmProvider(): string {
    return (this.env.YUVI_LLM || this.env.YUVI_CHAT_LLM || DEFAULT_LLM_PROVIDER).toLowerCase();
}
```

**What it does:** `llmProvider` is the lower-cased `YUVI_LLM` (default `openrouter`), so `OpenAI` and `openai` both work. Next to it: `searchProvider` (`YUVI_SEARCH`), `reasoning` (`YUVI_REASONING`, or `"off"`), `tavilyApiKey`, `telegramToken`, `telegramPin`, `logEnabled` (`YUVI_LOG`) and `devMode` (`YUVI_DEV`).

**Why it's used here:** The full list of variables, with a comment for each, is in the project's `.env.example` template and the settings table of the [root README](../README.md.md).

---

### `secrets()`, `childEnv()` and `SECRET_ENV_NAMES`

```ts
secrets(): string[] {
    // Every provider's key, not only the active one: both may be set.
    const providerKeys = Object.values(LLM_PROFILES).map((p) => this.pick(p.keyEnv, p.savedKey));
    return [...new Set([...providerKeys, this.tavilyApiKey, this.telegramToken, this.telegramPin])].filter(
        (value) => value.length >= MIN_SECRET_LENGTH,
    );
}

static readonly SECRET_ENV_NAMES = [
    "OPENROUTER_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY", "TELEGRAM_BOT_TOKEN", "YUVI_TELEGRAM_PIN",
] as const;
```

**What it does:**
- `secrets()` lists every secret value so the logger and redaction can hide them. It collects the key of **every** provider, not only the active one. `new Set(...)` removes duplicates. Very short values (under 8 characters) are skipped, because hiding them would blank out normal words.
- `childEnv()` copies the environment and deletes every name in `SECRET_ENV_NAMES`, so shell commands the agent runs can't read your keys.

**Why it's used in general:** Secrets should be hidden in two ways: never shown in output, and never handed to programs that don't need them.

**Why it's used here:** You might have both `OPENROUTER_API_KEY` and `OPENAI_API_KEY` set. Even when you use OpenRouter, the OpenAI key must still be hidden.

💡 **Tip:** `as const` makes the array read-only and keeps the exact strings as types. A test checks that every profile's `keyEnv` appears in this list, so a new provider can't forget it.

---

### 🧠 Key takeaways
- Only this file reads `process.env` and `~/.yuvi/settings.json`.
- `pick()` sets one order for every value: this run → environment → saved file.
- `YUVI_LLM` chooses a [profile](llm/profiles.ts.md), and the key and models follow from it.
- `saveApiKey` / `saveModel` write to the active provider's own fields.
- All provider keys are hidden from output and removed from shell commands.
