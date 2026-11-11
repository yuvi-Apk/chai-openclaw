# frontends/terminal/renderer.ts

**Purpose:** Shows **mode events** on the terminal. Output is always written as whole lines, with a one-line spinner below, so the screen never looks frozen and lines never get torn. It knows nothing about any particular mode.

**Where it fits:** [session-loop.ts](session-loop.ts.md) creates one `TerminalRenderer` per session and passes it every `ModeEvent` the mode emits. For errors it calls [errors.ts](errors.ts.md). Colours come from [chalk](../../../concepts/chalk-terminal-colors.md); see also [raw-mode-and-ansi-escapes.md](../../../concepts/raw-mode-and-ansi-escapes.md).

> This doc covers the parts that link the renderer to the model provider. More sections will be added as the file changes.

---

### The constructor: which provider to name

```ts
export class TerminalRenderer {
    /** Called when the user presses Esc or Ctrl+C during a turn. */
    onAbort: (() => void) | undefined;

    /** @param provider names the model provider in error advice */
    constructor(private readonly provider?: LLMProviderProfile) {}
```

**What it does:** The renderer can be given the active [provider profile](../../core/llm/profiles.ts.md). `private readonly provider?` is a **parameter property**: it declares and fills the field in one go. The `?` makes it optional. `onAbort` is a hook the session sets so Esc can stop a turn.

**Why it's used in general:** Passing in what a class needs, instead of having it look things up, is [dependency injection](../../../concepts/typescript-classes.md).

**Why it's used here:** The renderer doesn't read settings itself. The session loop hands it `core.settings.llmProfile`, so it stays a pure "drawing" class.

---

### `errorBox()`: an error in plain words

```ts
private errorBox(raw: string, hint?: string): void {
    const { problem, fix } = explainError(raw, this.provider);
    const lines = ["", chalk.red.bold(`✗ ${problem}`), `  ${chalk.bold("What to do:")} ${fix}`];
    const detail = raw.replace(/\s+/g, " ").trim();
    if (detail && detail !== problem) {
        // ...adds a dim "technical detail" line
    }
```

**What it does:** Turns a raw error into a red `✗` headline, a bold "What to do:" line, and a dim technical detail. `replace(/\s+/g, " ")` squashes newlines and long spaces into single spaces.

**Why it's used here:** Because the provider is passed to `explainError`, an OpenAI user sees OpenAI's name and links in the advice.

---

### 🧠 Key takeaways
- The renderer only draws events; it never decides task logic.
- It gets the provider profile by injection, through an optional constructor parameter.
- Errors become a plain-words box with a next step, worded for the active provider.
