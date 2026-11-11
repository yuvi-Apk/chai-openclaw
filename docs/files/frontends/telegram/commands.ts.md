# frontends/telegram/commands.ts

**Purpose:** The list of **commands the Telegram front end adds to every mode** (`/menu`, `/stop`, `/provider`, `/model`, ...). Adding a command is one entry in a list; the work is done elsewhere.

**Where it fits:** [chat-controller.ts](chat-controller.ts.md) looks up a typed command in `FRONT_COMMANDS` and runs it (refusing it with "yuvi is busy" during a turn unless `whileRunning` is set); the same list feeds help and the command list Telegram shows. Most entries call a method on [chat-controller.ts](chat-controller.ts.md); the three model commands call [model-settings.ts](model-settings.ts.md).

---

### `FrontCommand`

```ts
export interface FrontCommand {
    name: string;            // with the slash: "/stop"
    description: string;
    whileRunning?: boolean;  // may be used while a turn is running
    hidden?: boolean;        // left out of the command list Telegram shows
    run(chat: ChatController, arg: string): Promise<void> | void;
}
```

**What it does:** Describes one command: its name, a short description for help, two optional flags, and the function to run. `arg` is whatever you typed after the command.

**Why it's used in general:** Describing commands as **data** (a table of objects) instead of a long `switch` is the registry pattern again: help, the command list and the router all read the same table.

---

### `FRONT_COMMANDS`: the model entries

```ts
{ name: "/provider", description: "switch AI provider: OpenRouter, OpenAI, Gemini, Claude", run: (chat) => changeProvider(chat.modelMenu) },
{ name: "/model", description: "change the AI model", run: (chat) => changeModel(chat.modelMenu) },
{ name: "/effort", description: "how hard the model thinks", run: (chat) => changeEffort(chat.modelMenu) },
```

**What it does:** Each model command hands the chat's small `modelMenu` context to a function in [model-settings.ts](model-settings.ts.md). None has `whileRunning`, so they can't be used in the middle of a turn.

**Why it's used here:** Changing the model halfway through an answer would be confusing, so these wait until the turn ends. The hidden `/key` command exists only to explain why keys aren't set from Telegram.

---

### `parseCommand()`

```ts
export function parseCommand(text: string): { name: string; arg: string } {
    const [head = "", ...rest] = text.trim().split(/\s+/);
    return { name: head.split("@")[0]!.toLowerCase(), arg: rest.join(" ") };
}
```

**What it does:** Splits `"/file@my_bot src/a.ts"` into `name: "/file"` and `arg: "src/a.ts"`. Telegram may add `@botname` to a command (for example when you tap it in a list), so that part is cut off, and the name is lower-cased.

---

### 🧠 Key takeaways
- Every Telegram front-end command is one entry in `FRONT_COMMANDS`.
- `/provider`, `/model` and `/effort` delegate to [model-settings.ts](model-settings.ts.md).
- `whileRunning` and `hidden` are small flags that control when and where a command shows up.
