# core/config.ts

**Purpose:** The **one place settings come from**. It reads the environment (`.env`) and the user's saved settings file, picks the right value, and gives a default. It also saves the choices you make in the menus (key, provider, model, effort). No other file reads `process.env`.

**Where it fits:** Everything that needs a setting gets a `Settings` object passed in. [core/llm/providers.ts](llm/providers.ts.md) asks it for the provider, key and model; [core/llm/profiles.ts](llm/profiles.ts.md) tells it *which* variables to read for the provider in use; [core/llm/choices.ts](llm/choices.ts.md) builds menu options from it. Front ends such as [model-menu.ts](../frontends/terminal/model-menu.ts.md), [prompts.ts](../frontends/terminal/prompts.ts.md) and [model-settings.ts](../frontends/telegram/model-settings.ts.md) save choices through it. Background: [environment-variables.md](../../concepts/environment-variables.md) and [user-settings-file.md](../../concepts/user-settings-file.md).

---

### `UserSettings`: what is saved on disk

```ts
export interface UserSettings {
    llmProvider?: string;      // the provider picked in a menu
    reasoning?: string;        // the effort picked in a menu, or "off"
    apiKey?: string;           // OpenRouter (names predate other providers)
    model?: string;
    fastModel?: string;
    openaiApiKey?: string;  openaiModel?: string;  openaiFastModel?: string;
    geminiApiKey?: string;  geminiModel?: string;  geminiFastModel?: string;
    anthropicApiKey?: string; anthropicModel?: string; anthropicFastModel?: string;
}
```

**What it does:** Describes `~/.yuvi/settings.json`. Every field is optional (`?`). Two fields remember menu choices (`llmProvider`, `reasoning`); the rest are one key + two models per provider.

**Why it's used in general:** Saving settings in the home folder means they work in every project, not just one.

**Why it's used here:** OpenRouter keeps the old names (`apiKey`, `model`) so files saved by earlier versions still work. Each provider has its own fields, so all four keys can live in the file side by side.

---

### The `Settings` constructor, `reload()` and `save()`

```ts
save(patch: UserSettings): void {
    this.saved = { ...this.saved, ...patch };
    for (const [key, value] of Object.entries(patch)) {
        // An empty value clears the setting, so the environment or default applies again.
        if (value) this.changed[key as keyof UserSettings] = value;
        else delete this.changed[key as keyof UserSettings];
    }
    // ...write the file with mode 0o600
}
```

**What it does:**
- The constructor takes where env values come from and which file to use. `null` means "memory only", which tests use.
- `reload()` reads the JSON file again; a missing or broken file just means "nothing saved".
- `save()` merges new values in and writes the file (`0o600` = only you can read it). A non-empty value goes into `changed`, so it wins for the rest of this run. An **empty** value is removed from `changed`, which "un-picks" it: the `.env` value or the default takes over again.

**Why it's used in general:** Passing the environment in, instead of reading `process.env` everywhere, makes code easy to test. This is [dependency injection](../../concepts/typescript-classes.md).

**Why it's used here:** A test can write `new Settings({ YUVI_LLM: "openai" }, null)` and get a fully controlled, throw-away setup. The "empty clears" rule is what lets the effort menu go back to "default".

💡 **Tip:** Telegram calls `reload()` before showing `/provider`, so a key you just saved in the terminal (a separate process) is seen without restarting the bot.

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

**Why it's used here:** `apiKey`, `modelId`, `reasoning` and `llmProvider` all follow this order, so one piece of code serves all four providers. See [concepts/provider-profiles.md](../../concepts/provider-profiles.md).

---

### `apiKey`, `saveApiKey()`, `hasKey()`, `saveModel()`

```ts
saveApiKey(key: string, provider = this.llmProvider): void {
    this.save({ [profileFor(provider).savedKey]: key });
}

hasKey(provider: string): boolean {
    const profile = profileFor(provider);
    return Boolean(this.pick(profile.keyEnv, profile.savedKey));
}
```

**What it does:** `apiKey` gives the key of the active provider. `saveApiKey` saves to the active provider's field, **or** to another provider's field if you name one. `hasKey` answers "does this provider have a key anywhere?". `saveModel` saves the main model for the active provider. `{ [name]: value }` is a **computed property name**: the object key is whatever `name` holds.

**Why it's used in general:** Callers say *what* they want ("save this key for Gemini") and the class decides *where*.

**Why it's used here:** When you switch to Gemini in the terminal menu and it has no key yet, the menu asks for one and saves it to `geminiApiKey` *before* switching. `hasKey` is how the menus show "no key yet" and how Telegram refuses a provider with no key.

---

### `modelId()`: which model for which job

```ts
modelId(role: ModelRole = "main"): string {
    const profile = this.llmProfile;
    const main = this.pick(profile.modelEnv, profile.savedModel) || profile.defaultModel;
    if (role === "main") return main;
    return this.pick(profile.fastModelEnv, profile.savedFastModel) || profile.defaultFastModel || main;
}
```

**What it does:** There are two roles. `main` does the real work (planning, editing, answering). `fast` does small internal jobs (triage, routing, summaries). For `fast` it tries, in order: the fast model you set, the profile's cheaper default (`defaultFastModel`), then the main model.

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

**Why it's used here:** `REASONING_EFFORTS` is now exported, so [choices.ts](llm/choices.ts.md) can build the effort menu from the same list. `readonly` stops anyone changing it by accident.

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
- `secrets()` lists every secret value so the logger and redaction can hide them. It collects the key of **every** provider, not only the active one. Very short values (under 8 characters) are skipped, because hiding them would blank out normal words.
- `childEnv()` copies the environment and deletes every name in `SECRET_ENV_NAMES`, so shell commands the agent runs can't read your keys.
- `SECRET_ENV_NAMES` is **built from the profiles**: every profile's `keyEnv`, made unique with `new Set`, then spread (`...`) into the array.

**Why it's used in general:** Secrets should be hidden in two ways: never shown in output, and never handed to programs that don't need them. Deriving a list from data instead of typing it by hand means it can't fall out of date.

**Why it's used here:** Adding a profile for a new provider automatically hides `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` or any future key. Nobody has to remember a second list.

---

### 🧠 Key takeaways
- Only this file reads `process.env` and `~/.yuvi/settings.json`.
- One order for every value: this run → environment → saved file → default.
- Provider, model, key and effort can all be picked in a menu and saved; an empty save clears a choice.
- `saveProvider` refuses unknown names; `hasKey` tells the menus which providers are ready.
- All provider keys are hidden from output and removed from shell commands, using a list built from the profiles.
