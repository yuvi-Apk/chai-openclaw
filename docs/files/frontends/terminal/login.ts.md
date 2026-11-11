# frontends/terminal/login.ts

**Purpose:** **Logging in and out** of an AI provider in the terminal. Logging in asks for a key, checks it with one tiny model call, and keeps it in the operating system's credential vault. On a first start with no key, it welcomes you and walks you through it.

**Where it fits:** The main menu in [app.ts](app.ts.md) runs `ensureLoggedIn`, `logInTo` and `logOut`. [session-loop.ts](session-loop.ts.md) adds `/login` and `/logout` to every mode. [model-menu.ts](model-menu.ts.md) uses `logIn` when you switch to a provider with no key. The check is [core/llm/verify-key.ts](../../core/llm/verify-key.ts.md); saving goes through [core/config.ts](../../core/config.ts.md) into the [OS vault](../../../concepts/os-credential-vault.md). Provider names and links come from [core/llm/profiles.ts](../../core/llm/profiles.ts.md).

---

### `LoginPrompts`: the questions, passed in

```ts
export interface LoginPrompts {
    choose<T extends string>(question: string, choices: Choice<T>[], initial?: T): Promise<T | null>;
    askKey(provider: string): Promise<string | null>;
    confirm(question: string): Promise<boolean>;
    say(level: LoginNoticeLevel, text: string): void;
    verify(settings: Settings, provider: string, key: string): Promise<KeyCheck>;
}
```

**What it does:** Lists everything logging in needs from the outside world: pick from a list, ask for a key, ask yes/no, show a message, and check a key. `TERMINAL_LOGIN` (at the end of the file) fills these with the real [@clack/prompts](../../../concepts/clack-prompts.md) versions and a spinner.

**Why it's used in general:** Taking the "talk to the user" part as a parameter is [dependency injection](../../../concepts/typescript-classes.md). The logic can then be tested with scripted answers.

**Why it's used here:** Every exported function has `prompts = TERMINAL_LOGIN` as a default. Tests pass a script like "pick `anthropic`, paste this key, the check says `auth_rejected`" and look at what was said and saved, with no keyboard and no network.

---

### `judge()`: what to do after a failed check

```ts
switch (kind) {
    case "auth_rejected":
    case "auth_missing":
        return { action: "retry", level: "warn", text: `${label} rejected that key. Copy it again from ${keysUrl}.` };
    case "no_credits":
        return { action: "save", level: "warn", text: `The key works, but the ${label} account has no credit. Add some at ${billingUrl}.` };
    // model_not_found / no_tool_support → save, with a note to pick another model
    // rate_limited → save, "busy right now"
    default:
        return { action: "ask", level: "warn", text: `Could not check the key right now (${kind.replace("_", " ")}).` };
}
```

**What it does:** Turns an error kind into a **verdict**: an action plus a message.
- **retry**: the provider said "this key is wrong". Ask again.
- **save**: the key is fine, something else isn't (no credit, unknown model, busy). Save it, but tell you.
- **ask**: the check couldn't reach a decision (network, timeout). Ask whether to save anyway.

**Why it's used in general:** A `switch` over a union of strings is a clear way to map each case to an answer. Stacking `case` lines shares one answer between several cases.

**Why it's used here:** Not every failure means a bad key. A key with no credit still *works*; refusing it would be confusing. The messages link to the provider's own key or billing page.

---

### `logIn()`: ask, check, save

```ts
for (let tries = 0; tries < MAX_KEY_TRIES; tries++) {
    const key = (await prompts.askKey(provider))?.trim();
    if (!key) return false;
    const check = await prompts.verify(settings, provider, key);
    if (!check.ok) {
        const verdict = judge(check.kind, settings, provider);
        prompts.say(verdict.level, verdict.text);
        if (verdict.action === "retry") continue;
        if (verdict.action === "ask" && !(await prompts.confirm("Save the key anyway?"))) return false;
    }
    await settings.saveApiKey(key, provider);
    prompts.say("success", `${label} key saved in ${WHERE_SAVED[settings.keySource(provider)]}.`);
    return true;
}
```

**What it does:**
1. Asks for the key. Skipped (Esc or empty) → `false`.
2. Checks it. On failure, shows the verdict's message; `retry` loops round, `ask` asks "Save the key anyway?".
3. Saves it with `saveApiKey` and says *where* it went, using `WHERE_SAVED` ("your system's credential vault", or `~/.yuvi/settings.json` on a machine with no vault).
4. After `MAX_KEY_TRIES` (3) rejected keys it gives up and saves nothing.

It does **not** switch to the provider; the caller decides that.

**Why it's used in general:** `?.trim()` is **optional chaining**: if the answer is `null`, the whole thing is `undefined` instead of crashing.

**Why it's used here:** Giving up after three tries stops an endless loop if the provider keeps refusing. Keeping "save the key" apart from "switch provider" lets the model menu reuse it.

---

### `logInTo()` and `ensureLoggedIn()`

```ts
export async function logInTo(settings, prompts = TERMINAL_LOGIN, alwaysAskKey = false) {
    const ready = Object.keys(LLM_PROFILES).find((name) => settings.hasKey(name));
    const picked = await prompts.choose("Which AI provider do you want to use?", providerChoices(settings), ready ?? settings.llmProvider);
    if (!picked) return false;
    const needsKey = alwaysAskKey || !settings.hasKey(picked);
    if (needsKey && !(await logIn(settings, picked, prompts))) return false;
    settings.saveProvider(picked);
    prompts.say("success", loginStatus(settings));
    return true;
}
```

**What it does:**
- `logInTo` shows the providers, starting on one that already has a key. If the picked one needs a key, it runs `logIn`. Then it switches to it and says "Logged in to Claude · claude-sonnet-5-5". With `alwaysAskKey`, it asks for a new key even if one exists (that's the main menu's **Log in**, for changing a key).
- `ensureLoggedIn` runs at start. If the provider in use has a key, it does nothing. Otherwise it says either "Welcome to yuvi! ..." (no keys at all) or "There is no X key yet. Pick a provider you are logged in to, or log in to this one.", then calls `logInTo`.

**Why it's used here:** A brand-new user never has to create a `.env` file: the first start asks for a provider and a key. Someone who already has, say, a Gemini key just picks Gemini and needs no new key.

---

### `logOut()`

```ts
const withKeys = Object.keys(LLM_PROFILES).filter((name) => settings.hasKey(name));
if (!withKeys.length) return prompts.say("note", "You are not logged in to any provider.");
// ...choose one, with a hint like "key in your system's credential vault"
await settings.forgetKey(picked);
if (settings.keySource(picked) === "env") {
    return prompts.say("note", `The ${label} key comes from .env (${keyEnv}). Delete that line and restart yuvi to log out.`);
}
prompts.say("success", `Logged out of ${label}. Its key was removed.`);
if (picked === settings.llmProvider) await ensureLoggedIn(settings, prompts);
```

**What it does:** Lists only the providers that have a key, each with a hint saying where its key lives. It removes the picked key from the vault and the file. If a key is *still* there afterwards, it must come from `.env`, which yuvi never edits, so it tells you which line to delete. If you logged out of the provider in use, it asks you to log in again straight away.

**Why it's used here:** You always end up in a working state: either logged in to something, or told exactly why not.

---

### `loginStatus()`, `askKey()` and `verifyWithSpinner()`

```ts
export function loginStatus(settings: Settings): string {
    const { label } = settings.llmProfile;
    return settings.hasKey(settings.llmProvider)
        ? `Logged in to ${label} · ${settings.modelId("main")}`
        : `Not logged in to ${label}`;
}
```

**What it does:**
- `loginStatus` gives one line for the menus. [app.ts](app.ts.md) shows it next to "What do you want to do?".
- `askKey` (private) prints three steps with the provider's key page, then uses `password()` so the key is hidden as you type. A key under `MIN_KEY_LENGTH` (20) characters gets "That looks too short to be a key."
- `verifyWithSpinner` (private) shows "Checking your Claude key…" while [verifyKey](../../core/llm/verify-key.ts.md) runs, then "The key works." or "The check did not pass.".

**Why it's used here:** A spinner tells you the program isn't frozen during the few seconds the check takes. Hiding the typed key keeps it off your screen (and out of screenshots).

---

### 🧠 Key takeaways
- First start with no key → a welcome, a provider pick, and a key prompt; no `.env` needed.
- Every pasted key is checked with one tiny call; wrong keys are asked for again (3 tries max).
- Some failures still save the key (no credit, model refused) because the key itself works.
- Keys go to the OS vault; a `.env` key can't be logged out of here, so you're told which line to delete.
- The prompts are injected, so the whole flow is tested without a keyboard or network.
