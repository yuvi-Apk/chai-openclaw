# terminal-ui/wakeup.ts

**Purpose:** This file is `yuvi`'s **"good morning" screen**. It draws a big colourful `YUVI` banner, then shows a small menu asking whether you want **CLI** or **Telegram** mode. It returns your choice.

**Where it fits:** [index.ts](../index.ts.md) imports `wakeup()` from here and calls it when you run `yuvi wakeup`. The libraries it uses (`figlet`, `chalk`, `@clack/prompts`) are listed in [package.json](../package.json.md). It lives in a `terminal-ui/` folder because it only handles *how things look and feel in the terminal*. The real CLI and Telegram logic will live somewhere else.

---

### Imports

```ts
import figlet from "figlet";
import chalk from "chalk";
import { intro, outro, select, isCancel, cancel } from "@clack/prompts";
```

**What it does:**
- `figlet` turns plain text into big ASCII-art letters.
- `chalk` adds colours to terminal text.
- From `@clack/prompts`, it takes five small helpers that build a friendly interactive menu.

**Why it's used in general:** Each library does one job well, and you combine them. The first two lines are *default imports* (one main thing per package). The third is a *named import* (pick specific pieces). See [concepts/es-modules.md](../../concepts/es-modules.md).

**Why it's used here:** Together they make up the whole wakeup experience: figlet for the shape of the banner, chalk for its colour, and clack for the menu.

---

### Constants and the `Mode` type

```ts
const BANNER_FONT = "ANSI Shadow";
const BANNER_TEXT = "YUVI";

export type Mode = "cli" | "telegram";
```

**What it does:**
- `BANNER_FONT` and `BANNER_TEXT` store the banner settings in one place, at the top of the file.
- `Mode` is a TypeScript **type** that only allows two exact strings: `"cli"` or `"telegram"`.

**Why it's used in general:** Named constants at the top of a file are like labelled switches on a control panel. You can change them without hunting through the code. A type built from a few exact strings, joined with `|`, is called a **union of literal types**. See [concepts/typescript-union-types.md](../../concepts/typescript-union-types.md).

**Why it's used here:** `Mode` is `export`ed so [index.ts](../index.ts.md) and future files can share the same idea of "which mode". If you type `"telegrm"` by mistake, TypeScript catches it straight away.

---

### `showBanner()`: drawing the gradient banner

```ts
export function showBanner(): void {
    const art = figlet.textSync(BANNER_TEXT, { font: BANNER_FONT });
    const colors = [chalk.cyanBright, chalk.cyan, chalk.blueBright, chalk.blue, chalk.magentaBright, chalk.magenta];

    const lines = art.split("\n");
    lines.forEach((line, i) => {
        const paint = colors[Math.floor((i / lines.length) * colors.length)] ?? chalk.white;
        console.log(paint(line));
    });

    console.log(chalk.gray("  chai code · open claw · learn\n"));
}
```

**What it does, line by line:**
1. `figlet.textSync(...)` turns `"YUVI"` into a multi-line block of ASCII art using the "ANSI Shadow" font. `Sync` means it returns the result right away, with no `await`.
2. `colors` is a list of six chalk "paint brushes", running from cyan through blue to magenta.
3. `art.split("\n")` cuts the art into separate lines.
4. For each line, `i / lines.length` gives how far down the banner we are, from 0 to almost 1. Multiplying by `colors.length` and rounding down picks a brush. Top lines get cyan and bottom lines get magenta. That creates the **gradient**.
5. `?? chalk.white` is a safety net. If the maths ever picks a slot that doesn't exist, it uses white instead.
6. Last, it prints a small grey tagline under the banner.

**Why it's used in general:** Many CLIs (like Vite or Angular) show a banner so the tool feels alive and branded. Colouring line by line is a simple trick for a gradient. See [concepts/figlet-ascii-art.md](../../concepts/figlet-ascii-art.md) and [concepts/chalk-terminal-colors.md](../../concepts/chalk-terminal-colors.md).

**Why it's used here:** It is the first thing you see when `yuvi` "wakes up", like a robot's face lighting up.

💡 **Tip:** `??` (the *nullish coalescing* operator) only falls back when the left side is `null` or `undefined`. With strict TypeScript settings, reading `array[index]` can be `undefined`, so `??` keeps the type checker happy.

---

### `pickMode()`: the mode menu

```ts
export async function pickMode(): Promise<Mode | null> {
    intro(chalk.bgCyan.black(" yuvi is awake "));

    const mode = await select<Mode>({
        message: "How do you want to talk to yuvi?",
        options: [
            { value: "cli", label: "CLI", hint: "chat right here in the terminal" },
            { value: "telegram", label: "Telegram", hint: "chat through a Telegram bot" },
        ],
    });
```

**What it does:**
- `intro(...)` prints a styled header that opens the prompt "session". `chalk.bgCyan.black` means black text on a cyan background. Chalk styles can be **chained**.
- `select<Mode>(...)` shows an arrow-key menu. Each option has:
  - `value`: what your code receives (`"cli"` or `"telegram"`)
  - `label`: what the user sees
  - `hint`: a small grey explanation
- `await` pauses until the user presses Enter (or cancels).

**Why it's used in general:** Interactive menus are friendlier than asking users to remember flags. See [concepts/clack-prompts.md](../../concepts/clack-prompts.md) and [concepts/async-await.md](../../concepts/async-await.md).

**Why it's used here:** This is where the user decides how `yuvi` will talk to them. The `<Mode>` tells TypeScript that the chosen value is one of our two modes.

---

### Handling cancel and finishing up

```ts
    if (isCancel(mode)) {
        cancel("Going back to sleep. 😴");
        return null;
    }

    outro(chalk.green(`Starting ${mode === "cli" ? "CLI" : "Telegram"} mode...`));
    return mode;
}
```

**What it does:**
- If the user presses **Ctrl+C** or **Esc**, clack returns a special "cancel" symbol instead of a value. `isCancel(mode)` checks for that.
- If they cancelled, `cancel(...)` prints a friendly goodbye and the function returns `null`.
- If they didn't, `outro(...)` closes the prompt session with a green message, and the chosen mode is returned.
- `` `Starting ${...} mode...` `` is a **template string**. The `? :` (ternary) picks `"CLI"` or `"Telegram"` for display.

**Why it's used in general:** Good CLIs always handle "the user changed their mind". Returning `null` is a common way to say "no answer".

**Why it's used here:** The return type `Promise<Mode | null>` tells callers: "you'll get a mode, or `null` if they cancelled." [index.ts](../index.ts.md) uses that `null` to exit cleanly.

💡 **Tip:** After the `isCancel` check, TypeScript *knows* `mode` must be a real `Mode`. This is called **type narrowing**.

---

### `wakeup()`: the whole flow

```ts
export async function wakeup(): Promise<Mode | null> {
    showBanner();
    return pickMode();
}
```

**What it does:** It shows the banner first, then runs the menu and passes the result back.

**Why it's used in general:** A small "orchestrator" function hides the steps behind one simple name. Callers don't need to know the details.

**Why it's used here:** [index.ts](../index.ts.md) only needs one line, `await wakeup()`. `showBanner` and `pickMode` are still exported separately, so you can reuse them on their own later. For example, you could show only the banner on another screen.

---

### 🧠 Key takeaways
- `figlet` draws the letters, `chalk` colours them, and `@clack/prompts` builds the menu.
- The gradient comes from choosing a colour based on how far down the banner each line is.
- `Mode = "cli" | "telegram"` lets TypeScript guard against typos everywhere.
- Always handle cancel: `isCancel` plus `return null` lets the app exit politely.
- `wakeup()` combines small, reusable functions into one easy call.
