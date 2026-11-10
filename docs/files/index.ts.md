# index.ts

**Purpose:** This is the **front door** of `yuvi`. When you run `yuvi` in a terminal, this is the file that runs. It describes the program and lists its commands.

**Where it fits:** [package.json](package.json.md) points its `"bin"` → `yuvi` entry at this file. It uses the `commander` library (listed in package.json) to understand what you typed. It hands the banner and mode menu over to [terminal-ui/wakeup.ts](terminal-ui/wakeup.ts.md), then starts [modes/cli.ts](modes/cli.ts.md) if you choose CLI. It is type-checked using the rules in [tsconfig.json](tsconfig.json.md).

---

### The shebang line

```ts
#!/usr/bin/env bun
```

**What it does:** It tells your operating system: "find the program called `bun` and use it to run this file."

**Why it's used in general:** Script files (Python, Bash, Node) use a shebang so they can run directly, as in `./script`, without you typing the interpreter's name first. See [concepts/shebang.md](../concepts/shebang.md).

**Why it's used here:** When `yuvi` is installed as a command through `bin`, the OS needs to know that this `.ts` file should be run by [Bun](../concepts/bun-runtime.md).

💡 **Tip:** The shebang must be the **very first line** of the file, with no blank line or space before it.

---

### Imports

```ts
import { Command } from "commander";
import { wakeup } from "./terminal-ui/wakeup";
import { runCliMode } from "./modes/cli";
```

**What it does:**
- Line 1 pulls the `Command` class out of the `commander` **package**, which lives in `node_modules`.
- Line 2 pulls the `wakeup` function out of **our own file**, `terminal-ui/wakeup.ts`. The `./` means "start from this folder". You don't need the `.ts` ending because Bun finds it for you.
- Line 3 pulls in `runCliMode`, the CLI-mode menu loop from [modes/cli.ts](modes/cli.ts.md).

**Why it's used in general:** `import` is the modern ES Module way to use code from other files or packages. A plain name like `"commander"` means a package. A path starting with `./` means one of your own files. See [concepts/es-modules.md](../concepts/es-modules.md).

**Why it's used here:** `Command` is the building block for the whole CLI ([concepts/commander-cli.md](../concepts/commander-cli.md)). `wakeup` holds all the "pretty terminal" work, and `runCliMode` holds CLI mode. That keeps this front-door file short and tidy.

---

### Describing the program

```ts
const program = new Command();

program
    .name("yuvi")
    .description("chai code open claw learn")
    .version("0.0.1")
```

**What it does:**
- `new Command()` creates the main program object. Think of it as an empty menu.
- `.name("yuvi")` sets the name shown in help text.
- `.description(...)` sets the one-line summary shown by `yuvi --help`.
- `.version("0.0.1")` adds a free `--version` / `-V` flag that prints `0.0.1`.

**Why it's used in general:** Each method returns the same `program`, so you can **chain** calls one after another. This style is called a *fluent API*.

**Why it's used here:** It gives `yuvi` its identity, plus automatic help and version flags, without any extra code.

---

### The `wakeup` command

```ts
program
    .command('wakeup')
    .description("show the banner and pick cli or telegram mode.")
    .action(async () => {
        const mode = await wakeup();
        if (!mode) process.exit(0);

        // TODO: start Telegram mode once it's built
        if (mode === "cli") await runCliMode();
        else console.log("Telegram mode coming soon...");
    })
```

**What it does:**
- `.command('wakeup')` adds a sub-command, so `yuvi wakeup` now means something.
- `.description(...)` is the text shown next to `wakeup` in help.
- `.action(async () => { ... })` is the function that runs when the user types `yuvi wakeup`. It is `async` because it waits for the user to pick from a menu.
- `await wakeup()` shows the banner and the mode menu, then gives back `"cli"`, `"telegram"`, or `null` if the user cancelled.
- `if (!mode) process.exit(0);` means that if the user cancelled, the program stops quietly. Exit code `0` means "finished normally, no error".
- The last two lines check which mode was chosen. `"cli"` starts CLI mode with `await runCliMode()`, which runs until you exit its menu. Telegram mode still prints a "coming soon" message.

**Why it's used in general:** Sub-commands keep a CLI organised. `git commit` and `git push` work the same way: one tool, many actions. Keeping the action short and calling helpers from other files is a common pattern. The command file only decides *what happens next*.

**Why it's used here:** `wakeup` is `yuvi`'s starting point. The menu logic lives in [terminal-ui/wakeup.ts](terminal-ui/wakeup.ts.md), and this action is the **switchboard** that routes you to [CLI mode](modes/cli.ts.md) now, and to Telegram mode once it's built. The `await` matters: it keeps the program alive while you're using CLI mode. Because `mode` is typed as `"cli" | "telegram" | null`, TypeScript knows that after the `if (!mode)` check it must be one of the two modes. See [concepts/typescript-union-types.md](../concepts/typescript-union-types.md).

💡 **Tip:** The `// TODO:` comment marks a spot to come back to. Many editors can list every TODO in a project.

---

### Running the parser

```ts
await program.parseAsync(process.argv)
```

**What it does:**
- `process.argv` is the list of words you typed, for example `["bun", "/path/index.ts", "wakeup"]`.
- `parseAsync` reads that list, finds the matching command, and runs its action.
- `await` waits until the action finishes.

**Why it's used in general:** Every Commander program must call `parse` or `parseAsync` at the end, or nothing happens. The async version is needed when actions use `async` code. See [concepts/async-await.md](../concepts/async-await.md).

**Why it's used here:** The `wakeup` action is `async` because it waits for the user's menu choice. `parseAsync` makes sure the program waits for that before it finishes. The `await` sits at the **top level** (outside any function), which is allowed because this is an [ES module](../concepts/es-modules.md).

💡 **Tip:** If you forget this line, `yuvi wakeup` silently does nothing. The commands are defined, but nobody reads your input.

---

### 🧠 Key takeaways
- The shebang plus package.json `bin` is what lets you type `yuvi` like a real command.
- Commander builds the CLI from chained calls: `.name()`, `.command()`, `.action()`.
- `.version()` and the automatic `--help` give you useful features without writing them.
- `parseAsync(process.argv)` is the "go" button. Without it, nothing runs.
- `wakeup` calls the banner and mode picker from `terminal-ui/wakeup.ts`, exits cleanly on cancel, and starts CLI mode (Telegram is coming later).
