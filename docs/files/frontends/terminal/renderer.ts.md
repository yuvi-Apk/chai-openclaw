# frontends/terminal/renderer.ts

**Purpose:** Shows **mode events** on the terminal. Output is always written as whole lines, with a one-line spinner below, so the screen never looks frozen and lines never get torn. It knows nothing about any particular mode.

**Where it fits:** [session-loop.ts](session-loop.ts.md) creates one `TerminalRenderer` per session and passes it every `ModeEvent` the mode emits (and the notices from [model-menu.ts](model-menu.ts.md)). For errors it calls [errors.ts](errors.ts.md). Colours come from [chalk](../../../concepts/chalk-terminal-colors.md); see also [raw-mode-and-ansi-escapes.md](../../../concepts/raw-mode-and-ansi-escapes.md).

> This doc covers the parts that link the renderer to the model provider. More sections will be added as the file changes.

---

### The constructor: which provider to name

```ts
export class TerminalRenderer {
    /** Called when the user presses Esc or Ctrl+C during a turn. */
    onAbort: (() => void) | undefined;

    /** @param provider the provider in use, read when an error is explained (it can change mid-session) */
    constructor(private readonly provider: () => LLMProviderProfile | undefined = () => undefined) {}
```

**What it does:** The renderer is given a small **function** that returns the active [provider profile](../../core/llm/profiles.ts.md), not the profile itself. `private readonly provider` is a **parameter property**: it declares and fills the field in one go. If nothing is passed, the default `() => undefined` means "no provider to name". `onAbort` is a hook the session sets so Esc can stop a turn.

**Why it's used in general:** Passing a function (a **getter**, or "lazy value") instead of a value means "ask me when you need it". The answer is always fresh. It's still [dependency injection](../../../concepts/typescript-classes.md): the renderer doesn't read settings itself.

**Why it's used here:** You can switch provider in the middle of a session. If the renderer kept the profile from the start, an error after switching to Claude would still say "OpenRouter". With `() => core.settings.llmProfile`, it names the provider in use *when the error happens*.

---

### `errorBox()`: an error in plain words

```ts
private errorBox(raw: string, hint?: string): void {
    const { problem, fix } = explainError(raw, this.provider());
    const lines = ["", chalk.red.bold(`✗ ${problem}`), `  ${chalk.bold("What to do:")} ${fix}`];
    const detail = raw.replace(/\s+/g, " ").trim();
    if (detail && detail !== problem) {
        // ...adds a dim "technical detail" line
    }
```

**What it does:** Calls `this.provider()` to get the current profile, then turns a raw error into a red `✗` headline, a bold "What to do:" line, and a dim technical detail. `replace(/\s+/g, " ")` squashes newlines and long spaces into single spaces.

**Why it's used here:** Because the current provider is passed to `explainError`, a Claude user sees "Claude did not accept your API key." with Claude's links.

---

### 🧠 Key takeaways
- The renderer only draws events; it never decides task logic.
- It gets the provider through an injected getter, so the answer is always current.
- Errors become a plain-words box with a next step, worded for the provider in use right now.
