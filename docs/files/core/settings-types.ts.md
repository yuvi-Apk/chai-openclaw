# core/settings-types.ts

**Purpose:** Holds the **shapes** `Settings` works with: what's saved on disk, the model roles, the effort levels and where a key comes from. They were moved out of [core/config.ts](config.ts.md) so that file stays about reading and saving values.

**Where it fits:** [core/config.ts](config.ts.md) imports everything here and re-exports it, so the rest of the project still imports from `"./config"`. Background: [typescript-union-types.md](../../concepts/typescript-union-types.md) and [typescript-interfaces-and-utility-types.md](../../concepts/typescript-interfaces-and-utility-types.md).

---

### `KeySource`: where a key comes from

```ts
export type KeySource = "env" | "vault" | "file" | "none";
```

**What it does:** A [union type](../../concepts/typescript-union-types.md) with four possible answers: `.env`, the OS vault, the settings file (old versions, or no vault on this machine), or no key at all.

**Why it's used in general:** A small fixed set of strings is easier to read than numbers, and TypeScript catches a typo like `"vualt"`.

**Why it's used here:** `Settings.keySource()` returns it. [login.ts](../frontends/terminal/login.ts.md) uses it to say where a key was saved and to explain that a `.env` key can't be logged out of from the app.

---

### `ModelRole`, `ReasoningEffort` and `REASONING_EFFORTS`

```ts
export type ModelRole = "main" | "fast";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
```

**What it does:** `ModelRole` names the two jobs a model can have. `ReasoningEffort` lists the allowed effort levels; `REASONING_EFFORTS` is the same list as a real array you can loop over at run time.

**Why it's used in general:** Types disappear when the code runs. If you need the list *at run time* (to build a menu or check a value), you also need an array. `readonly` stops anyone changing it by accident.

**Why it's used here:** [core/config.ts](config.ts.md) checks `YUVI_REASONING` against the array; [core/llm/choices.ts](llm/choices.ts.md) builds the effort menu from it.

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

**What it does:** Describes `~/.yuvi/settings.json`. Every field is optional (`?`). Two fields remember menu choices; the rest are one key and two models per provider.

**Why it's used in general:** Saving settings in the home folder means they work in every project ([user-settings-file.md](../../concepts/user-settings-file.md)).

**Why it's used here:** Keys now live in the [OS vault](../../concepts/os-credential-vault.md), so the `...ApiKey` fields are only **read** from files saved by older versions (and then moved to the vault), or **used** when this machine has no vault. OpenRouter keeps the old names (`apiKey`, `model`) so old files still work.

---

### 🧠 Key takeaways
- This file only describes shapes; [config.ts](config.ts.md) does the reading and saving.
- `KeySource` answers "where is this key?": env, vault, file or none.
- A type plus a matching `readonly` array gives you both checking and a run-time list.
- The key fields in `UserSettings` are for old files and machines without a vault.
