# frontends/terminal/model-menu.ts

**Purpose:** The terminal's three **model menus**: switch AI provider, pick a model, set the thinking effort. Each saves your choice for next time and returns a short notice to show, or `null` when nothing changed.

**Where it fits:** [session-loop.ts](session-loop.ts.md) runs these from the `/provider`, `/model` and `/effort` commands and shows the notice with [renderer.ts](renderer.ts.md). The option lists come from [core/llm/choices.ts](../../core/llm/choices.ts.md); the real questions come from [prompts.ts](prompts.ts.md); the saving is done by [core/config.ts](../../core/config.ts.md).

---

### `MenuNotice` and `MenuPrompts`

```ts
export interface MenuNotice {
    level: "success" | "note";
    text: string;
}

export interface MenuPrompts {
    choose<T extends string>(question: string, choices: Choice<T>[], initial?: T): Promise<T | null>;
    askText(question: string): Promise<string | null>;
    setupKey(settings: Settings, provider: string): Promise<boolean>;
}

export const TERMINAL_PROMPTS: MenuPrompts = { choose: chooseOne, askText, setupKey: setupApiKey };
```

**What it does:** `MenuNotice` is what a menu hands back: a level and a sentence. `MenuPrompts` lists the three questions a menu may ask. `TERMINAL_PROMPTS` fills them with the real [@clack/prompts](../../../concepts/clack-prompts.md) versions.

**Why it's used in general:** Taking the "ask the user" part as a parameter is [dependency injection](../../../concepts/typescript-classes.md). Returning a value instead of printing keeps the function easy to check.

**Why it's used here:** Each menu has `prompts = TERMINAL_PROMPTS` as a default parameter. The app uses the real prompts; a test passes scripted answers (`["anthropic"]`) and checks what was offered and what was saved, with no keyboard at all.

---

### `chooseProvider()`

```ts
const current = settings.llmProvider;
const picked = await prompts.choose("Which AI provider?", providerChoices(settings), current);
if (!picked || picked === current) return null;
const { label } = profileFor(picked);
if (!settings.hasKey(picked) && !(await prompts.setupKey(settings, picked))) {
    return { level: "note", text: `Still using ${settings.llmProfile.label}: ${label} needs a key first.` };
}
settings.saveProvider(picked);
```

**What it does:**
1. Shows every provider, starting on the current one. Cancel or "same one" → nothing happens.
2. If the new provider has **no key**, it asks for one (and saves it to *that* provider). If you skip, you stay on the old provider and get a note saying why.
3. Otherwise it switches and saves, then says "Now using Claude with claude-sonnet-5-5, saved for next time."
4. If `.env` also names a provider, it adds a warning: `.env` wins at the next start.

**Why it's used in general:** `a && !(await b())` only runs `b` when `a` is true. Here: only ask for a key when there isn't one.

**Why it's used here:** Switching to a provider with no key would make the very next message fail. Asking first, and refusing to switch without a key, keeps yuvi always usable.

---

### `chooseModel()`

```ts
let picked = await prompts.choose(question, modelChoices(settings), current);
if (picked === OTHER_MODEL) picked = (await prompts.askText("Model id (pick one that supports tools):"))?.trim() || null;
if (!picked || picked === current) return null;
settings.saveModel(picked);
```

**What it does:** Shows the provider's suggested models (and a link to the full list). Picking "Other…" asks you to type an id; spaces are trimmed and an empty answer counts as "cancel". The pick is saved for the provider in use.

**Why it's used here:** Buttons cover the common models; typing covers everything else. Agent mode needs a model that can call tools, so the question reminds you.

---

### `chooseEffort()`

```ts
const current = currentEffort(settings);
const picked = await prompts.choose("How much should the model think?", effortChoices(settings), current);
if (!picked || picked === current) return null;
saveEffort(settings, picked);
```

**What it does:** Shows `default`, `none … max` and `off`, saves the pick, and warns if `YUVI_REASONING` in `.env` would override it at the next start. Picking `default` clears the setting so each mode picks its own effort again.

---

### 🧠 Key takeaways
- Three menus, one pattern: ask → nothing changed? return `null` → save → return a notice.
- The prompts are injected, so tests answer them without a keyboard.
- A provider without a key is never switched to; you're asked for the key first.
- When `.env` sets the same thing, the notice tells you `.env` will win at the next start.
