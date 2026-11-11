# modes/agent/input.ts

**Purpose:** The **message box** of agent mode. It draws a framed input line with a hint bar under it, reads your keys one at a time, and reports back what you want: send a message, open the menu, or leave. When you type `@`, it also pops up a small list of project files you can pick from.

**Where it fits:** [orchestrator.ts](orchestrator.ts.md) calls `readInput()` at the top of its main loop and gives it the hint-bar text, the "switch mode" action, and a function that lists the project's files (from [tool-executor.ts](tool-executor.ts.md)'s `listTextFiles`). This file knows nothing about modes or the AI. It only knows about keys and drawing. Concept: [raw-mode-and-ansi-escapes.md](../../../concepts/raw-mode-and-ansi-escapes.md).

```
────────────────────────────────────────────
› explain @orch
────────────────────────────────────────────
  ● Ask mode · shift+tab switch mode · / menu
› modes/agent/orchestrator.ts
  docs/files/modes/agent/orchestrator.ts.md
  ↑↓ choose · tab/enter select · esc close
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
    /** Workspace files (relative, "/" separated) offered after typing "@". */
    files?: () => string[];
}
```

**What it does:** It lists what the box needs: a function that returns the hint-bar text for a given width, a function to call on Shift+Tab, the list of earlier messages, the grey placeholder text, and (optionally) a function that returns the project's file paths.

**Why it's used in general:** Passing functions in (callbacks) keeps a component reusable. It does its own job and asks the caller for anything it doesn't know. The `?` in `files?` makes the field **optional**: a caller may leave it out (see [typescript-interfaces-and-utility-types.md](../../../concepts/typescript-interfaces-and-utility-types.md)).

**Why it's used here:** The box doesn't know what "Ask mode" is. It just calls `onCycleMode()` and then asks `footer()` for the new text. In the same way, it doesn't know how to find files. It just calls `files()` when it needs them. If `files` is missing, the `@` list simply never appears.

💡 **Tip:** `files` is a *function*, not an array. Walking the whole project takes time, so the box only calls it the first time you actually type `@`.

---

### `mentionAtEnd(buffer)`: spotting an `@` being typed

```ts
function mentionAtEnd(buffer: string): { start: number; query: string } | null {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(buffer);
    if (!m) return null;
    return { start: buffer.length - m[1]!.length, query: m[1]! };
}
```

**What it does:** It checks whether the line **ends** with an `@word` that you are still typing.
- `(?:^|\s)@` means: an `@` at the very start, or right after a space. So an email like `me@site.com` does not count.
- `([^\s@]*)` captures the letters after the `@` (no spaces, no second `@`). This is the **query**.
- `$` means "at the end of the line".
- It returns the query and `start`, the position where the query begins, so it can be replaced later. No match → `null`.

**Why it's used in general:** A **regular expression** is a small pattern language for finding text. `exec` returns the match and its captured groups, or `null`.

**Why it's used here:** The list should only show while you are in the middle of an `@mention`. Once you type a space after it, the pattern stops matching and the list closes by itself.

---

### `rankPaths(paths, query)`: best matches first

```ts
if (lower.startsWith(q)) score = 0;
else if (base.startsWith(q)) score = 1;
else if (base.includes(q)) score = 2;
else if (lower.includes(q)) score = 3;
else {
    // Letters in order, e.g. "orch" → modes/agent/orchestrator.ts
    let i = 0;
    for (const ch of lower) if (ch === q[i]) i++;
    if (i < q.length) continue;
    score = 4;
}
```

**What it does:** Each path gets a score. Lower is better:

| Score | Rule | Example query → path |
|---|---|---|
| 0 | the whole path starts with it | `modes/a` → `modes/agent/` |
| 1 | the file or folder name starts with it | `orch` → `modes/agent/orchestrator.ts` |
| 2 | the name contains it | `strat` → `orchestrator.ts` |
| 3 | the full path contains it | `agent/or` → `modes/agent/orchestrator.ts` |
| 4 | its letters appear in order | `mao` → `modes/agent/orchestrator.ts` |

Paths that don't match at all are skipped (`continue`). The rest are sorted by score, then shorter paths first, then A–Z, and only the top 8 (`MAX_SUGGESTIONS`) are kept. If nothing is typed after `@` yet, it shows the **shallowest** paths first, so the list starts at the top level of the project.

The query is lower-cased and any `\` becomes `/`, so Windows-style typing still matches.

**Why it's used in general:** This is a tiny **fuzzy finder**, the same idea as "Go to file" in VS Code. Score 4 is the classic "subsequence" match: walk through the path and tick off the query letters one by one.

**Why it's used here:** You rarely remember a full path. Typing a few letters of the file name should be enough to find it.

---

### `loadPaths()`: files plus their folders

```ts
const loadPaths = (): string[] => {
    if (allPaths) return allPaths;
    const files = options.files?.() ?? [];
    const dirs = new Set<string>();
    for (const f of files) {
        const parts = f.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") + "/");
    }
    allPaths = [...dirs, ...files];
    return allPaths;
};
```

**What it does:**
- The first call asks the caller for the file list. Later calls return the saved `allPaths`. This saving trick is called **caching**.
- For a file like `modes/agent/ui.ts`, it also adds the folders `modes/` and `modes/agent/`. A `Set` makes sure each folder is added only once.
- Folders always end with `/`, which is how the rest of the code tells them apart from files.

**Why it's used in general:** `options.files?.()` uses **optional chaining**: "call `files` if it exists, otherwise give `undefined`". `?? []` then falls back to an empty list.

**Why it's used here:** Picking a folder is useful too ("look at `@modes/agent/`"), but the file walker only returns files. So the folders are worked out from the file paths.

---

### `updateSuggestions()` and `acceptSuggestion()`: the list's state

```ts
let suggestions: string[] = [];
let selected = 0;
let dismissedAt: string | null = null; // buffer value when Esc hid the list

const acceptSuggestion = () => {
    const mention = mentionAtEnd(buffer);
    const choice = suggestions[selected];
    if (!mention || !choice) return;
    // A folder keeps the list open so you can go on into it.
    buffer = buffer.slice(0, mention.start) + choice + (choice.endsWith("/") ? "" : " ");
};
```

**What it does:**
- `suggestions` is the list on screen and `selected` is the highlighted row.
- `updateSuggestions()` runs before every redraw. If there is no `@mention` at the end, the list is empty. Otherwise it ranks the paths for the current query. When the list's contents change, the highlight jumps back to the top row.
- `dismissedAt` remembers the exact line you had when you pressed Esc. As long as the line is still exactly that, the list stays hidden. Type one more letter and it can come back.
- `acceptSuggestion()` swaps the half-typed query for the chosen path. A **file** gets a space after it, which ends the mention and closes the list. A **folder** gets no space, so the list stays open and now shows what is inside that folder (score 0: paths that start with it).

**Why it's used in general:** Keeping a few small variables for "what is shown" and "what is highlighted" is how every dropdown or autocomplete works under the hood.

**Why it's used here:** Clicking down through folders, one `Tab` at a time, feels like browsing. The space after a file means you can carry on typing your sentence straight away.

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

### Drawing: `drawInput`, `redraw`, `drawAll`

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
const redraw = () => {
    updateSuggestions();
    let s = `\x1b[2B\r\x1b[2K${options.footer(w)}`;
    // rows = the suggestion lines (highlighted one in cyan), maybe
    // "no matching files", then the "↑↓ choose · ..." hint
    for (const row of rows) s += `\n\x1b[2K${row}`;
    s += "\x1b[J"; // wipe rows left over from a longer list
    s += `\x1b[${2 + rows.length}A`;
    out.write(s);
    drawInput();
};

const drawAll = () => {
    out.write(`\n${rule()}\n\n${rule()}\n${options.footer(width())}`);
    out.write("\x1b[2A");
    redraw();
};
```

- `drawAll` draws the whole box once: a rule, an empty line for input, a rule, the hint bar. Then `\x1b[2A` moves the cursor **up 2 lines**, back onto the input line, and calls `redraw`.
- `redraw` runs after every key. It refreshes the suggestions, goes **down 2** (`\x1b[2B`) to the hint bar and rewrites it, then writes one line per suggestion under it. Long paths are cut from the front with `…`, so you still see the file name.
- `\x1b[J` erases everything below. If the list just got shorter, old rows don't stay behind on screen.
- Finally it goes **up** by `2 + rows.length` lines, back to the input line, and repaints it.

**Why it's used in general:** These strange strings are **ANSI escape codes**: commands for the terminal, not text. They are how every spinner, progress bar, and full-screen terminal app moves the cursor. See [raw-mode-and-ansi-escapes.md](../../../concepts/raw-mode-and-ansi-escapes.md).

**Why it's used here:** The box is repainted in place, so it never flickers. Building the whole update in one string `s` and writing it once keeps it smooth too.

💡 **Tip:** The suggestion rows use `\n`, not "cursor down" (`\x1b[1B`). Cursor-down stops at the bottom edge of the screen. `\n` makes the terminal **scroll**, so the list still has room when the box sits on the last line.

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
        redraw();
    } else {
        close({ kind: "exit" });
    }
    return;
}
if (key === "\u0004") return close({ kind: "exit" });
if (key === "\u001b[Z") {
    options.onCycleMode();
    redraw();
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

Any other sequence that starts with `\u001b` (other arrows, function keys) is ignored. While the `@` file list is open, Up / Down, Tab, Enter and Esc mean something different (next section). Every key that changes the line ends with `redraw()`, so the file list always follows what you typed.

**Why it's used in general:** Normally the terminal handles these keys for you. In raw mode your program receives them and must give each one its meaning.

**Why it's used here:** Shift+Tab and Up / Down are impossible with an ordinary line prompt. Reading raw keys is what makes them work.

💡 **Tip:** Ctrl+C in raw mode does **not** stop the program by itself. It is just the character `\u0003`. That is why this code handles it explicitly.

---

### `onData(chunk)`: driving the `@` file list

```ts
if (suggestions.length) {
    if (key === "\u001b[A" || key === "\u001b[B") {
        const n = suggestions.length;
        selected = (selected + (key === "\u001b[A" ? n - 1 : 1)) % n;
        redraw();
        return;
    }
    if (key === "\t" || key === "\r" || key === "\n") {
        acceptSuggestion();
        redraw();
        return;
    }
    if (key === "\u001b") {
        dismissedAt = buffer;
        redraw();
        return;
    }
}
```

**What it does:** This block only runs while the list has rows.
- **Up / Down** move the highlight. `% n` wraps around: Down on the last row goes to the first. Up adds `n - 1` instead of subtracting 1, which is the same move but never makes the number negative.
- **Tab** or **Enter** puts the highlighted path into your line.
- **Esc** hides the list (by remembering the line in `dismissedAt`) but keeps your text.

**Why it's used in general:** The same key can mean different things depending on what is on screen. Checking the "list is open" state **first** gives the list priority, just like a dropdown in a browser.

**Why it's used here:** Without this, Enter would send a half-typed `@orch` to the AI, and Up would jump to an old message instead of moving through the files.

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
    dismissedAt = buffer; // don't pop the file list up over a recalled message
    redraw();
    return;
}
```

**What it does:**
- No history → do nothing.
- If you are on your new line, save it in `draft` before moving away.
- Up moves the index back by one, Down moves it forward by one.
- `Math.max(0, Math.min(length, index))` **clamps** the index, so it can never go below the oldest message or beyond the new line.
- At the end position you get your `draft` back. Anywhere else you get that old message.
- `dismissedAt = buffer` keeps the file list closed. An old message that ends in `@something` would otherwise open the list and "steal" the next Up key.

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
    redraw();
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
- ANSI escape codes move the cursor, so the box and its file list are repainted in place.
- Typing `@` opens a fuzzy file finder; while it is open, arrows / Tab / Enter / Esc drive the list first.
- The caller supplies the hint bar, the mode switch, and the file list through callbacks, so this file stays generic.
- Always undo raw mode when done, and have a plain fallback when there is no real terminal.
