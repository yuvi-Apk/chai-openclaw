# ai/ai.config.ts

**Purpose:** This file decides **which AI brain** `yuvi` uses and **where its settings come from**. It reads your OpenRouter key and model names from environment variables, can save them in a small settings file in your home folder, and hands back a ready-to-use model object.

**Where it fits:** Everything here is re-exported by the barrel file [ai/index.ts](index.ts.md). [modes/agent/orchestrator.ts](../modes/agent/orchestrator.ts.md) calls `applyUserSettings()` at startup and `saveUserSettings()` when you paste a key or change the model. [modes/agent/brain.ts](../modes/agent/brain.ts.md) calls `getAgentModel()` and `getReasoningOverride()` when it runs the agent.

---

### Imports

```ts
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
```

**What it does:**
- `fs` reads and writes files, and `path` builds file paths safely ([node-fs-path.md](../../concepts/node-fs-path.md)).
- `homedir()` returns your personal folder, like `C:\Users\you` or `/home/you`.
- `createOpenRouter` creates an [OpenRouter](../../concepts/openrouter.md) **provider** for the [AI SDK](../../concepts/ai-sdk-agents.md).

**Why it's used in general:** The `node:` prefix says "this is a built-in module, not a package from npm". Bun supports these built-ins too.

**Why it's used here:** The file now has two jobs: talk to OpenRouter, and remember your settings on disk.

---

### The two small types: `ModelRole` and `ReasoningEffort`

```ts
export type ModelRole = 'main' | 'fast';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
```

**What it does:** Each one is a [union of string literals](../../concepts/typescript-union-types.md). A `ModelRole` can only be `'main'` or `'fast'`. A `ReasoningEffort` can only be one of the seven listed words.

**Why it's used in general:** Literal unions turn typos into compile errors. `getModelId('fats')` will not compile.

**Why it's used here:** `yuvi` uses two models: a **main** one for the real work and a **fast** (cheaper) one for small jobs like sorting requests and writing summaries. `ReasoningEffort` says how hard the model should think.

---

### `UserSettings` and where they live

```ts
export interface UserSettings {
    apiKey?: string;
    model?: string;
    fastModel?: string;
}

const settingsFile = () => path.join(homedir(), ".yuvi", "settings.json");
```

**What it does:**
- `UserSettings` is an [interface](../../concepts/typescript-interfaces-and-utility-types.md) with three optional fields (the `?` means "may be missing").
- `settingsFile()` builds the path `~/.yuvi/settings.json`, where `~` is your home folder.

**Why it's used in general:** Many tools keep per-user settings in a hidden folder in the home directory (`~/.gitconfig`, `~/.npmrc`). See [user-settings-file.md](../../concepts/user-settings-file.md).

**Why it's used here:** A `.env` file only works inside one project folder. A file in your home folder works **in every project** where you run `yuvi`, so you paste your key once.

---

### `readUserSettings()`

```ts
export function readUserSettings(): UserSettings {
    try {
        return JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as UserSettings;
    } catch {
        return {};
    }
}
```

**What it does:** It reads the settings file as text and turns the JSON into an object. If anything goes wrong (the file does not exist yet, or it is not valid JSON), it returns an empty object `{}`.

**Why it's used in general:** `try` / `catch` with a safe default is the usual way to read an *optional* file. A missing file is normal, not an error.

**Why it's used here:** On the first run there is no settings file. The rest of the code can treat "no file" and "empty settings" the same way.

---

### `saveUserSettings(patch)`

```ts
export function saveUserSettings(patch: UserSettings): void {
    const next = { ...readUserSettings(), ...patch };
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
    });
    if (patch.apiKey) process.env.OPENROUTER_API_KEY = patch.apiKey;
    if (patch.model) process.env.OPENROUTER_DEFAULT_MODEL = patch.model;
    if (patch.fastModel) process.env.YUVI_MODEL_FAST = patch.fastModel;
}
```

**What it does:**
- `{ ...old, ...patch }` copies the saved settings, then lays the new values on top. Saving only a `model` keeps the saved `apiKey`.
- `mkdirSync(..., { recursive: true })` creates the `.yuvi` folder if it is missing, and does nothing if it already exists.
- `JSON.stringify(next, null, 2)` writes nicely indented JSON.
- `mode: 0o600` is a file permission: only the owner may read and write the file.
- The last three lines also put the new values into `process.env`, so they take effect **right now**, without restarting.

**Why it's used in general:** "Read, merge, write back" is the standard way to update one key in a config file without losing the others.

**Why it's used here:** When you paste a key or pick a new model from the agent's menu, the choice is saved for next time *and* used for your very next message.

💡 **Tip:** `0o600` is an octal number (the `0o` prefix). It matters on Linux and macOS. Windows mostly ignores it.

---

### `applyUserSettings()`

```ts
export function applyUserSettings(): void {
    const saved = readUserSettings();
    if (!process.env.OPENROUTER_API_KEY && saved.apiKey) {
        process.env.OPENROUTER_API_KEY = saved.apiKey;
    }
    if (!process.env.OPENROUTER_DEFAULT_MODEL && saved.model) {
        process.env.OPENROUTER_DEFAULT_MODEL = saved.model;
    }
    // ...same for YUVI_MODEL_FAST and saved.fastModel
}
```

**What it does:** For each setting it asks: "Is the [environment variable](../../concepts/environment-variables.md) empty, **and** do we have a saved value?" Only then does it copy the saved value into `process.env`.

**Why it's used in general:** Config usually comes in layers, and the more specific layer wins. Here the order is: environment (`.env`) first, saved user settings second, built-in default last.

**Why it's used here:** A project can still force its own key or model through `.env`. Everywhere else, your saved settings fill the gaps. After this one call at startup, the rest of the app only needs to look at `process.env`.

---

### `getModelId(role)`

```ts
export function getModelId(role: ModelRole = 'main'): string {
    const main = process.env.OPENROUTER_DEFAULT_MODEL || "openrouter/free";
    if (role === 'fast') return process.env.YUVI_MODEL_FAST || main;
    return main;
}
```

**What it does:**
- The main model id comes from `OPENROUTER_DEFAULT_MODEL`, or `"openrouter/free"` if that is not set.
- For the `'fast'` role it uses `YUVI_MODEL_FAST`, and falls back to the main model.
- `role: ModelRole = 'main'` is a **default parameter**: calling `getModelId()` means `getModelId('main')`.

**Why it's used in general:** `a || b` is the short way to say "use `a`, or `b` when `a` is empty".

**Why it's used here:** The UI shows this id (in the welcome text and the menu), and `getAgentModel` uses it to build the model.

---

### `getAgentModel(role)`

```ts
export function getAgentModel(role: ModelRole = 'main') {
    const provider = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY || "",
    });
    return provider(getModelId(role));
}
```

**What it does:** It builds a provider that signs each request with your key, then turns the model id into a model object and returns it.

**Why it's used in general:** Wrapping model setup in one small function means the rest of the app just asks for "the model" and never deals with keys or ids.

**Why it's used here:** The provider is created fresh on every call. That is why a key saved a moment ago with `saveUserSettings` is used straight away.

---

### `getReasoningOverride()`

```ts
export function getReasoningOverride(): ReasoningEffort | 'off' | undefined {
    const value = (process.env.YUVI_REASONING || "").toLowerCase();
    if (value === 'off') return 'off';
    const allowed: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    return allowed.find((e) => e === value);
}
```

**What it does:** It reads `YUVI_REASONING`. `off` means "send no reasoning setting at all". A valid effort word is returned as is. Anything else gives `undefined`, which means "the caller decides".

**Why it's used in general:** Checking a free-text setting against a list of allowed values keeps bad input out of the rest of the program.

**Why it's used here:** Some models reject a reasoning option. This gives you a switch to turn it off or pin it, without touching the code.

---

### 🧠 Key takeaways
- Settings come in layers: `.env` / environment wins, then `~/.yuvi/settings.json`, then built-in defaults.
- `saveUserSettings` merges, writes the file, and updates `process.env` so the change works immediately.
- `applyUserSettings` runs once at startup and only fills in what the environment left empty.
- There are two model roles: `main` for real work and `fast` for small helper jobs.
- A **provider** is the adapter, and a **model** is the specific brain you pick from it.
