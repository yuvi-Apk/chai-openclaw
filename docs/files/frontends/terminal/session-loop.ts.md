# frontends/terminal/session-loop.ts

**Purpose:** Runs **one session of any mode** in the terminal: read a message, hand it to the mode, show the events it emits, repeat. Nothing here depends on which mode is running; it only uses the `Mode` contract from `core/mode.ts`.

**Where it fits:** It draws with [renderer.ts](renderer.ts.md) and asks questions with [prompts.ts](prompts.ts.md). Settings come from [core/config.ts](../../core/config.ts.md). See [docs/ARCHITECTURE.md](../../../ARCHITECTURE.md) for how a message flows through the layers.

> This doc covers the parts that use the model provider. More sections will be added as the file changes.

---

### `appCommands()`: commands every mode gets

```ts
{
    name: "/key",
    label: "Set API key",
    hint: typed ? `set your ${core.settings.llmProfile.label} key` : `${core.settings.llmProfile.label} key`,
    run: async () => void (await setupApiKey(core.settings)),
},
```

**What it does:** Builds the commands the terminal adds to every mode: change model, set key, help, exit. The `/key` hint names the active provider, for example "OpenAI key". `typed` picks a longer hint when you are typing a `/` command and a shorter one in the menu.

**Why it's used in general:** Commands owned by the front end (like "exit") should work the same in every mode, so they're defined once here.

**Why it's used here:** The label comes from the [provider profile](../../core/llm/profiles.ts.md), so the menu always matches `YUVI_LLM`.

💡 **Tip:** `async () => void (await ...)` runs the promise and then throws away its result. `run` only needs to finish, not return anything.

---

### `runModeSession()`: the renderer gets the provider

```ts
const renderer = new TerminalRenderer(core.settings.llmProfile);
const host: ModeHost = {
    core: grantTools(core, mode.name, mode.tools),
    grants: mode.tools,
    // ...emit, confirm, choose, ask
};
```

**What it does:** Creates the renderer with the active provider profile, then builds the `ModeHost` the mode talks to. `grantTools` gives the mode only the tools it declared.

**Why it's used here:** This is where the settings and the renderer meet. The session loop knows the settings; the renderer only gets the one piece it needs.

---

### 🧠 Key takeaways
- One loop for every mode: read, handle, render, repeat.
- Front-end commands like `/key` are defined once here and work in every mode.
- The active provider's label and profile flow from settings into the menu and the renderer.
