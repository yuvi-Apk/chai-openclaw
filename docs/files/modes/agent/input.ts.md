# modes/agent/input.ts

**Purpose:** The **message box** of agent mode. It draws a framed input line with a hint bar under it, reads your keys one at a time, and reports back what you want: send a message, open the menu, or leave.

**Where it fits:** [orchestrator.ts](orchestrator.ts.md) calls `readInput()` at the top of its main loop and gives it the hint-bar text and the "switch mode" action. This file knows nothing about modes or the AI. It only knows about keys and drawing. Concept: [raw-mode-and-ansi-escapes.md](../../../concepts/raw-mode-and-ansi-escapes.md).

```
────────────────────────────────────────────
› type here
────────────────────────────────────────────
  ● Ask mode · shift+tab switch mode · / menu
```

---

### `InputResult`: three possible answers

```ts
export type InputResult =
    | { kind: "message"; text: string }
    | { kind: "menu" }
    | { kind: "exit" };
```

**What it does:** It says the result is one of three shapes. Only the `"message"` shape has a `text`.

**Why it's used in general:** This is a **discriminated union**: a [union type](../../../concepts/typescript-union-types.md) where every member has the same field (`kind`) with a different value. Check `kind` and TypeScript knows which shape you hold.

**Why it's used here:** The caller can write `if (input.kind === "menu")` and never has to guess from magic strings like `""` or `"/"`.

---

### `InputOptions`: what the caller provides

```ts
export interface InputOptions {
    /** Text of the hint bar under the input box; called again after a mode change. */
    footer: (width: number) => string;
    /** Shift+Tab was pressed. */
    onCycleMode: () => void;
    /** Earlier messages, oldest first, for the Up / Down keys. */
    history: string[];
    placeholder: string;
}
```

**What it does:** It lists four things the box needs: a function that returns the hint-bar text for a given width, a function to call on Shift+Tab, the list of earlier messages, and the grey placeholder text.

**Why it's used in general:** Passing functions in (callbacks) keeps a component reusable. It does its own job and asks the caller for anything it doesn't know.

**Why it's used here:** The box doesn't know what "Ask mode" is. It just calls `onCycleMode()` and then asks `footer()` for the new text.

---

### The fallback when there is no real terminal

```ts
if (!stdin.isTTY || !out.isTTY) {
    return text({ message: "You:", placeholder: options.placeholder }).then(
        (value) => {
            if (isCancel(value)) return { kind: "exit" as const };
            const line = String(value ?? "").trim();
            if (line === "/") return { kind: "menu" as const };
            return { kind: "message" as const, text: line };
        },
    );
}
```

**What it does:** `isTTY` is `true` only for a real interactive terminal. When input or output is piped (for example in a script), it uses a simple clack [`text` prompt](../../../concepts/clack-prompts.md) and maps the answer to the same three results.

**Why it's used in general:** Fancy drawing needs a real terminal. A plain fallback keeps the program usable everywhere. `as const` keeps `"exit"` as the exact literal type instead of a loose `string`.

**Why it's used here:** Raw key reading (next sections) is impossible without a TTY, so the box degrades gracefully.

---

### The state inside the Promise

```ts
return new Promise((resolve) => {
    let buffer = "";
    let historyIndex = options.history.length;
    let draft = "";
    const width = () => Math.max(20, (out.columns ?? 80) - 1);
    const rule = () => chalk.dim("─".repeat(width()));
    // ...drawing and key handling...
});
```

**What it does:**
- `buffer` holds what you have typed so far.
- `historyIndex` points into the history. Starting at `history.length` means "past the end", which is your new, unsent line.
- `draft` keeps your unfinished line safe while you browse older messages.
- `width()` is the usable terminal width (at least 20, default 80). `rule()` is a dim horizontal line that wide.

**Why it's used in general:** `new Promise((resolve) => ...)` wraps event-based code (key presses) so the caller can simply `await` it. The Promise finishes when `resolve(result)` is called. See [async-await.md](../../../concepts/async-await.md).

**Why it's used here:** Key presses arrive as events over time. The orchestrator just wants one answer: "what did the user decide?"

---

### Drawing: `drawInput`, `drawFooter`, `drawAll`

```ts
const drawInput = () => {
    const room = width() - PROMPT.length - 1;
    out.write("\r\x1b[2K" + chalk.cyan(PROMPT));
    if (!buffer) {
        out.write(chalk.dim(options.placeholder.slice(0, room)));
        out.write(`\r\x1b[${PROMPT.length}C`);
        return;
    }
    const visible =
        buffer.length > room ? "…" + buffer.slice(buffer.length - room + 1) : buffer;
    out.write(visible);
};
```

**What it does:**
- `\r` moves the cursor to the start of the line, and `\x1b[2K` erases the line. Then the cyan `› ` prompt is written.
- Empty buffer: write the dim placeholder, then jump back to just after the prompt (`\r` then `\x1b[2C` = "2 columns right"), so the cursor blinks where typing will begin.
- Otherwise write the text. If it is too long for the line, show only the **end** of it with a leading `…`, so you always see what you are typing now.

The other two helpers:

```ts
const drawFooter = () => {
    out.write(`\x1b[2B\r\x1b[2K${options.footer(width())}\x1b[2A`);
    drawInput();
};

const drawAll = () => {
    out.write(`\n${rule()}\n\n${rule()}\n${options.footer(width())}`);
    out.write("\x1b[2A");
    drawInput();
};
```

- `drawAll` draws the whole box once: a rule, an empty line for input, a rule, the hint bar. Then `\x1b[2A` moves the cursor **up 2 lines**, back onto the input line.
- `drawFooter` goes **down 2** (`\x1b[2B`) to the hint bar, erases and rewrites it, and comes back **up 2**.

**Why it's used in general:** These strange strings are **ANSI escape codes**: commands for the terminal, not text. They are how every spinner, progress bar, and full-screen terminal app moves the cursor. See [raw-mode-and-ansi-escapes.md](../../../concepts/raw-mode-and-ansi-escapes.md).

**Why it's used here:** Only the line that changed is redrawn. After each key the input line is repainted in place, so the box never flickers or scrolls.

---

### `close(result)`: tidy up and answer

```ts
const close = (result: InputResult) => {
    stdin.off("data", onData);
    try {
        stdin.setRawMode(false);
    } catch {
        // ignore
    }
    stdin.pause();
    out.write("\x1b[1A\r\x1b[J");
    if (result.kind === "message") {
        out.write(`${chalk.cyan("›")} ${chalk.bold(result.text)}\n`);
    }
    resolve(result);
};
```

**What it does:**
- It stops listening for keys, turns raw mode off, and pauses stdin.
- `\x1b[1A\r\x1b[J` moves up to the top rule and erases everything from there down. The box disappears.
- If you sent a message, it prints `› your message` in bold, so the message stays in the scrollback like a chat line.
- `resolve(result)` finishes the Promise.

**Why it's used in general:** Whoever turns raw mode on must turn it off again. Otherwise the terminal stays in a strange state where typed keys are not shown.

**Why it's used here:** After the box closes, other parts take over the keyboard: the menu, or the agent's own key listener in [ui.ts](ui.ts.md). They need stdin handed back clean.

---

### `onData(chunk)`: special keys

```ts
if (key === "\u0003") {
    // Ctrl+C: first clears what was typed, then leaves.
    if (buffer) {
        buffer = "";
        drawInput();
    } else {
        close({ kind: "exit" });
    }
    return;
}
if (key === "\u0004") return close({ kind: "exit" });
if (key === "\u001b[Z") {
    options.onCycleMode();
    drawFooter();
    return;
}
```

**What it does:** In raw mode each key arrives as a small string. Some are invisible control characters:

| What arrives | Key | What happens |
|---|---|---|
| `\u0003` | Ctrl+C | clears the line if there is text, otherwise exits |
| `\u0004` | Ctrl+D | exits |
| `\u001b[Z` | Shift+Tab | switches mode and redraws the hint bar |
| `\u001b[A` / `\u001b[B` | Up / Down | walks through earlier messages |
| `\u001b` alone | Esc | clears the line |
| `\r` or `\n` | Enter | sends the message (if not empty) |
| `\u007f` or `\b` | Backspace | deletes the last character |
| `\u0015` | Ctrl+U | clears the line |
| `\u0017` | Ctrl+W | deletes the last word |

Any other sequence that starts with `\u001b` (other arrows, function keys) is ignored.

**Why it's used in general:** Normally the terminal handles these keys for you. In raw mode your program receives them and must give each one its meaning.

**Why it's used here:** Shift+Tab and Up / Down are impossible with an ordinary line prompt. Reading raw keys is what makes them work.

💡 **Tip:** Ctrl+C in raw mode does **not** stop the program by itself. It is just the character `\u0003`. That is why this code handles it explicitly.

---

### `onData(chunk)`: history with Up and Down

```ts
if (key === "\u001b[A" || key === "\u001b[B") {
    if (!options.history.length) return;
    if (historyIndex === options.history.length) draft = buffer;
    historyIndex += key === "\u001b[A" ? -1 : 1;
    historyIndex = Math.max(0, Math.min(options.history.length, historyIndex));
    buffer =
        historyIndex === options.history.length
            ? draft
            : (options.history[historyIndex] ?? "");
    drawInput();
    return;
}
```

**What it does:**
- No history → do nothing.
- If you are on your new line, save it in `draft` before moving away.
- Up moves the index back by one, Down moves it forward by one.
- `Math.max(0, Math.min(length, index))` **clamps** the index, so it can never go below the oldest message or beyond the new line.
- At the end position you get your `draft` back. Anywhere else you get that old message.

**Why it's used in general:** This is exactly how shell history works in bash or PowerShell. Clamping with `Math.max` / `Math.min` is the standard way to keep a number inside a range.

**Why it's used here:** You can resend or tweak an earlier request without retyping it, and you never lose a half-typed line by pressing Up.

---

### `onData(chunk)`: `/`, `?`, and normal typing

```ts
// "/" on an empty line opens the menu; "?" shows help.
if (!buffer && key === "/") return close({ kind: "menu" });
if (!buffer && key === "?") return close({ kind: "message", text: "/help" });

// Normal typing or a paste (line breaks in a paste become spaces).
const typed = key.replace(/\r?\n|\r/g, " ").replace(/[\u0000-\u001f]/g, "");
if (typed) {
    buffer += typed;
    drawInput();
}
```

**What it does:**
- `/` as the **first** key opens the menu at once, with no Enter needed. `?` as the first key sends `/help`.
- Both only trigger on an empty line, so you can still type "what is 5/2?" normally.
- Everything else is added to the buffer. A paste arrives as one big chunk, so line breaks are turned into spaces and any leftover control characters are removed.

**Why it's used in general:** Cleaning input before storing it is called **sanitising**. Control characters in a buffer would corrupt the drawing.

**Why it's used here:** The box is a single line. A pasted multi-line text must become one line or the frame would break.

---

### Starting to listen

```ts
stdin.setRawMode(true);
stdin.resume();
stdin.on("data", onData);
drawAll();
```

**What it does:** It switches the terminal to raw mode, starts the input stream, registers `onData` for every key, and draws the box for the first time.

**Why it's used in general:** `stream.on("data", handler)` is the Node/Bun event pattern: "call this function every time something arrives".

**Why it's used here:** These four lines open the box. `close()` undoes them in reverse.

---

### 🧠 Key takeaways
- `readInput` returns a Promise that resolves to one of three results: message, menu, or exit.
- Raw mode delivers every key to the program, which makes Shift+Tab, history, and instant `/` possible.
- ANSI escape codes move the cursor, so only the changed line is redrawn.
- The caller supplies the hint bar and the mode switch through callbacks, so this file stays generic.
- Always undo raw mode when done, and have a plain fallback when there is no real terminal.
