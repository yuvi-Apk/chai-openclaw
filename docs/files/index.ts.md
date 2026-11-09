# index.ts

**Purpose:** This is the **front door** of `yuvi`. When you run `yuvi` in a terminal, this is the file that runs. It describes the program and lists its commands.

**Where it fits:** [package.json](package.json.md) points its `"bin"` → `yuvi` entry at this file. It uses the `commander` library (listed in package.json) to understand what you typed. It is type-checked using the rules in [tsconfig.json](tsconfig.json.md).

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

### Importing Commander

```ts
import { Command } from "commander";
```

**What it does:** It pulls the `Command` class out of the `commander` package.

**Why it's used in general:** `import` is the modern ES Module way to use code from other files or packages. See [concepts/es-modules.md](../concepts/es-modules.md).

**Why it's used here:** `Command` is the building block for the whole CLI. See [concepts/commander-cli.md](../concepts/commander-cli.md).

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
    .action(()=>{
        console.log("wakeup is calling....")
    })
```

**What it does:**
- `.command('wakeup')` adds a sub-command, so `yuvi wakeup` now means something.
- `.description(...)` is the text shown next to `wakeup` in help.
- `.action(() => { ... })` is the function that runs when the user types `yuvi wakeup`. For now it just prints a message.

**Why it's used in general:** Sub-commands keep a CLI organised. `git commit` and `git push` work the same way: one tool, many actions.

**Why it's used here:** `wakeup` is the planned starting point for `yuvi`. The description shows where it's heading: show a banner (the `figlet` package is already installed for that) and let the user choose **CLI** or **Telegram** mode (`@clack/prompts` is ready for that menu). For now, the action is a placeholder.

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

**Why it's used here:** Future actions, like asking the user questions or talking to Telegram, will be `async`. Using `parseAsync` now means those will just work. The `await` sits at the **top level** (outside any function), which is allowed because this is an [ES module](../concepts/es-modules.md).

💡 **Tip:** If you forget this line, `yuvi wakeup` silently does nothing. The commands are defined, but nobody reads your input.

---

### 🧠 Key takeaways
- The shebang plus package.json `bin` is what lets you type `yuvi` like a real command.
- Commander builds the CLI from chained calls: `.name()`, `.command()`, `.action()`.
- `.version()` and the automatic `--help` give you useful features without writing them.
- `parseAsync(process.argv)` is the "go" button. Without it, nothing runs.
- `wakeup` is a placeholder that will become the banner and mode picker.
