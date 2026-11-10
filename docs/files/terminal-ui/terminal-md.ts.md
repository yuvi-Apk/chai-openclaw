# terminal-ui/terminal-md.ts

**Purpose:** It turns **Markdown** (the format AI replies usually come in) into nicely coloured terminal text, so `**bold**` looks bold instead of showing the stars.

**Where it fits:** It lives next to [terminal-ui/wakeup.ts](wakeup.ts.md) as another "make the terminal pretty" helper. [modes/agent/orchestrator.ts](../modes/agent/orchestrator.ts.md) uses it to print the agent's final answer. The ideas behind it are in [concepts/marked-terminal.md](../../concepts/marked-terminal.md).

---

### Imports and the `ready` flag

```ts
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

let ready = false;
```

**What it does:** It brings in the Markdown parser (`marked`) and its terminal renderer plug-in (`markedTerminal`). `ready` remembers whether the plug-in has been installed yet.

**Why it's used in general:** A module-level variable like this is a simple way to remember something for the whole program run.

**Why it's used here:** `marked.use(...)` changes `marked` globally, so it should only be done **once**. The flag makes sure of that.

---

### `ensureReady()`

```ts
function ensureReady() {
    if (ready) return;
    const columns = process.stdout.columns ?? 80;
    marked.use(
        markedTerminal({
            width: Math.min(columns, 120),
            reflowText: true,
            tab: 2,
        }),
    );
    ready = true;
}
```

**What it does:**
- If setup has already happened, it returns straight away.
- `process.stdout.columns` is the terminal's width. `?? 80` means "if that's unknown, assume 80".
- `markedTerminal({...})` sets up the renderer:
  - `width: Math.min(columns, 120)`: wrap text to the terminal width, but never wider than 120, so lines stay readable on huge screens.
  - `reflowText: true`: re-wrap paragraphs to fit that width.
  - `tab: 2`: indent nested things (like lists) by 2 spaces.
- Finally it sets `ready = true`.

**Why it's used in general:** This is called **lazy initialisation**: you do setup work the first time it's needed, not when the file is loaded.

**Why it's used here:** The renderer only matters when there's an AI reply to show. Doing setup on first use also means it reads the terminal width at the moment it's actually needed.

💡 **Tip:** `??` (nullish coalescing) only falls back when the value is `null` or `undefined`. `||` would also fall back on `0` or `""`.

---

### `renderTerminalMarkdown(markdown)`

```ts
export function renderTerminalMarkdown(markdown: string): string {
    if (!markdown?.trim()) return "";
    ensureReady();
    try {
        const out = marked.parse(markdown, { async: false }) as string;
        return out.replace(/\n+$/, "");
    } catch {
        return markdown;
    }
}
```

**What it does:**
- If the text is empty or only spaces, it returns `""`. (`?.` safely handles a missing value.)
- `ensureReady()` makes sure the terminal renderer is installed.
- `marked.parse(..., { async: false })` converts the Markdown to coloured text right away. `as string` tells TypeScript "trust me, this is a string, not a Promise".
- `.replace(/\n+$/, "")` trims extra blank lines at the end.
- If anything goes wrong, `catch` returns the original raw text, so the user still sees the answer.

**Why it's used in general:** A `try/catch` with a sensible fallback is a common way to make display code **never crash the app**.

**Why it's used here:** AI replies can contain any kind of Markdown. If the renderer chokes on something odd, showing plain text is much better than an error.

---

### 🧠 Key takeaways
- `marked` parses Markdown, and `marked-terminal` makes it print nicely in a terminal.
- Plug-ins that change global state should be installed once (the `ready` flag).
- Lazy setup plus a `try/catch` fallback makes for safe, friendly output.
