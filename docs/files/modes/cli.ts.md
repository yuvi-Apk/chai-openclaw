# modes/cli.ts

**Purpose:** This is **CLI mode**, the place you land after picking "CLI" on the wakeup screen. It shows a menu (Agent, Plan, Chat, Help, Exit) in a loop and runs whatever you pick.

**Where it fits:** [index.ts](../index.ts.md) calls `runCliMode()` when [terminal-ui/wakeup.ts](../terminal-ui/wakeup.ts.md) returns `"cli"`. Choosing **Agent** hands control to `runAgentMode()` in [modes/agent/orchestrator.ts](agent/orchestrator.ts.md). Menus and inputs come from [@clack/prompts](../../concepts/clack-prompts.md), and colours come from [chalk](../../concepts/chalk-terminal-colors.md).

---

### Imports and the `CliAction` type

```ts
import chalk from "chalk";
import { select, text, isCancel, log, outro } from "@clack/prompts";
import { runAgentMode } from "./agent/orchestrator";

type CliAction = "agent" | "plan" | "chat" | "help" | "exit";
```

**What it does:**
- It brings in colours, the clack prompt helpers, and the agent runner.
- `CliAction` lists the five menu choices as a [union type](../../concepts/typescript-union-types.md).

**Why it's used in general:** A union of string literals is a lightweight way to say "only these exact values are allowed". TypeScript will warn you about a typo like `"hepl"`.

**Why it's used here:** It types the menu, so `select<CliAction>` returns one of these five values.

---

### `chatOnce()`

```ts
async function chatOnce(): Promise<boolean> {
    const message = await text({
        message: "You:",
        placeholder: "type something to yuvi...",
        validate: (value) => (!value || !value.trim() ? "Say something first!" : undefined),
    });

    if(message == "exit")return false;
    if (isCancel(message)) return false;

    // TODO: replace this echo with a real AI reply once the brain is wired in
    log.message(chalk.cyan(`yuvi: you said "${message.trim()}"`));
    return true;
}
```

**What it does:**
- `text({...})` asks you to type a message. `validate` refuses empty input with "Say something first!".
- If you type `exit`, or press Ctrl+C / Esc (`isCancel`), it returns `false`, meaning "stop chatting".
- Otherwise it echoes your message back in cyan and returns `true`, meaning "keep going".

**Why it's used in general:** Returning a `boolean` from "do one round" lets the caller write a very simple loop: `while (await chatOnce()) {}`.

**Why it's used here:** It is the chat placeholder. For now `yuvi` just repeats what you said. The `TODO` marks where a real AI reply will go.

💡 **Tip:** `.trim()` removes spaces at the start and end, so `"   "` counts as empty.

---

### `showHelp()`

```ts
function showHelp(): void {
    log.info(
        [
            chalk.bold("CLI mode commands"),
            `${chalk.cyan("Agent")}  - Agent`,
            `${chalk.cyan("plan")}  - Plan mode`,
            `${chalk.cyan("Chat")}  - send a message to yuvi`,
            `${chalk.cyan("Help")}  - show this help`,
            `${chalk.cyan("Exit")}  - leave CLI mode (Ctrl+C / Esc also works)`,
        ].join("\n"),
    );
}
```

**What it does:** It builds a list of lines, joins them with newlines, and prints them in a clack info box. Command names are cyan and the title is bold.

**Why it's used in general:** Building an array and then calling `.join("\n")` is a tidy way to make multi-line text, and it's easy to add or remove lines.

**Why it's used here:** It gives the user a quick reminder of what each menu choice does.

---

### `runCliMode()`: the main loop

```ts
export async function runCliMode(): Promise<void> {
    while (true) {
        const action = await select<CliAction>({ message: "What do you want to do?", options: [ /* agent, plan, chat, help, exit */ ] });

        if (isCancel(action) || action === "exit") break;
        if (action === "help") { showHelp(); continue; }
        if (action === "agent") await runAgentMode();
        if (action === "plan") console.log("plan mode")

        while (await chatOnce()) { }
        log.step(chalk.gray("Back to the menu."));
    }
    outro(chalk.gray("Going back to sleep. 😴"));
}
```

(The `options` list is shortened here. Each option has a `value`, a `label`, and a `hint`.)

**What it does:**
- `while (true)` keeps showing the menu until something `break`s out.
- **Exit** or cancel: `break` leaves the loop.
- **Help**: shows help, then `continue` jumps straight back to the menu.
- **Agent**: runs one round of agent mode (`await runAgentMode()`).
- **Plan**: prints `"plan mode"` as a placeholder.
- After those checks, the code reaches the inner `while (await chatOnce()) { }`. It keeps chatting until you type `exit` or cancel, then prints "Back to the menu." and the outer loop shows the menu again. Because only Help uses `continue`, choosing **Chat**, **Agent**, or **Plan** all end up in this chat loop.
- When the outer loop ends, `outro` says goodbye.

**Why it's used in general:** A "menu loop" (show menu → do the thing → show menu again) is the classic shape of interactive terminal apps. `break` exits a loop, and `continue` skips to its next round.

**Why it's used here:** It is the hub of CLI mode. Each menu choice can grow into its own feature, and the loop stays the same.

💡 **Tip:** An empty loop body `{ }` is fine when all the work happens in the condition. Here, `chatOnce()` does the work and its return value decides whether to go again.

---

### 🧠 Key takeaways
- CLI mode is a `while (true)` menu loop, with `break` to leave and `continue` to skip ahead.
- `select<CliAction>` plus `isCancel` gives a typed and cancel-safe menu.
- `chatOnce()` returns `true`/`false`, so the chat loop is a one-liner.
- **Agent** hands off to the [orchestrator](agent/orchestrator.ts.md). Chat and Plan are still placeholders.
