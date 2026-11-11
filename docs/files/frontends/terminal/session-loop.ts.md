# frontends/terminal/session-loop.ts

**Purpose:** Runs **one session of any mode** in the terminal: read a message, hand it to the mode, show the events it emits, repeat. Nothing here depends on which mode is running; it only uses the `Mode` contract from `core/mode.ts`.

**Where it fits:** It is started from the main menu in [app.ts](app.ts.md). It draws with [renderer.ts](renderer.ts.md), asks questions with [prompts.ts](prompts.ts.md), runs the provider/model/effort menus from [model-menu.ts](model-menu.ts.md), and logs you in or out with [login.ts](login.ts.md). Settings come from [core/config.ts](../../core/config.ts.md). See [docs/ARCHITECTURE.md](../../../ARCHITECTURE.md) for how a message flows through the layers.

> This doc covers the parts that use the model provider. More sections will be added as the file changes.

---

### `appCommands()`: commands every mode gets

```ts
const typed = mode.commandStyle === "typed";
const { settings } = core;
const show = (notice: MenuNotice | null) => notice && renderer.render({ type: "notice", ...notice });
return [
    {
        name: "/provider",
        label: "Switch AI provider",
        hint: typed ? "OpenRouter, OpenAI, Gemini or Claude" : `now: ${settings.llmProfile.label}`,
        run: async () => void show(await chooseProvider(settings)),
    },
    { name: "/model", label: "Change AI model", /* ... */ run: async () => void show(await chooseModel(settings)) },
    { name: "/effort", label: "Change thinking effort", /* ... */ run: async () => void show(await chooseEffort(settings)) },
    {
        name: "/login",
        label: "Log in / change key",
        hint: typed ? `paste a new ${settings.llmProfile.label} key` : `${settings.llmProfile.label} key`,
        run: async () => void (await logIn(settings, settings.llmProvider)),
    },
    { name: "/logout", label: "Log out", hint: "remove a saved key", run: async () => void (await logOut(settings)) },
    // /help, /exit
];
```

**What it does:** Builds the commands the terminal adds to every mode: switch provider, change model, change effort, log in, log out, help, exit. You reach them by typing `/`.
- `/login` asks for a new key for the provider in use, checks it and saves it ([login.ts](login.ts.md)).
- `/logout` lets you pick a provider and removes its saved key.
- `typed` picks a longer hint when you type a `/` command and a shorter one in the menu. The short hints show the current value, like "now: Claude" or "now: default".
- `show` is a tiny helper: if a menu returned a notice, draw it as a `notice` event; if it returned `null`, do nothing. `{ type: "notice", ...notice }` copies `level` and `text` into the event.

**Why it's used in general:** Commands owned by the front end (like "exit") should work the same in every mode, so they're defined once here. `notice && ...` is a short way to say "only if there is a notice".

**Why it's used here:** The menus themselves live in [model-menu.ts](model-menu.ts.md) and only *return* what to say. This file decides how to show it. That split keeps both files small and lets the menus be tested without a screen.

💡 **Tip:** `async () => void (await ...)` runs the promise and then throws away its result. `run` only needs to finish, not return anything.

---

### `runModeSession()`: load the keys, make sure you're logged in

```ts
const settings = new Settings();
await settings.loadKeys();
const core = createCore(settings);
if (process.stdin.isTTY && !(await ensureLoggedIn(settings))) {
    log.warn(
        typed
            ? "Not logged in. You can log in later with /login."
            : "Not logged in. You can log in later: type / and choose “Log in / change key”.",
    );
}
```

**What it does:**
1. Makes a fresh `Settings` and calls `loadKeys()`, which reads every provider's key from the OS credential vault ([core/config.ts](../../core/config.ts.md)). This is `await`ed because the vault is slow-ish to reach ([async-await.md](../../../concepts/async-await.md)).
2. Builds the shared services with `createCore`.
3. If a real person is at the keyboard (`isTTY`), `ensureLoggedIn` checks the provider in use has a key, and walks you through logging in if not.
4. If you skip, you get a gentle reminder of how to log in later. The wording matches the mode's command style.

**Why it's used here:** The vault must be read *before* anything asks "is there a key?", or every start would look logged out. In a script (no TTY) nobody can answer a question, so it doesn't ask.

---

### `runModeSession()`: the renderer gets the provider

```ts
// A getter, so error advice names the provider switched to in the menu.
const renderer = new TerminalRenderer(() => core.settings.llmProfile);
const host: ModeHost = {
    core: grantTools(core, mode.name, mode.tools),
    grants: mode.tools,
    // ...emit, confirm, choose, ask
};
```

**What it does:** Creates the renderer with a function that returns the active provider profile, then builds the `ModeHost` the mode talks to. `grantTools` gives the mode only the tools it declared.

**Why it's used here:** The arrow function is read again each time an error is shown. After you switch to Gemini with `/provider`, errors talk about Gemini, not the provider you started with.

---

### 🧠 Key takeaways
- One loop for every mode: read, handle, render, repeat.
- `/provider`, `/model`, `/effort`, `/login` and `/logout` are defined once here and work in every mode.
- A session first loads keys from the vault, then makes sure you're logged in.
- Menus return a notice; this file draws it.
- The renderer gets a getter for the provider, so it stays correct after a mid-session switch.
