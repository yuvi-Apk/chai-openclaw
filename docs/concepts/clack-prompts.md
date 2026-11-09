# @clack/prompts: friendly interactive menus

`@clack/prompts` builds good-looking questions in the terminal: menus, text inputs, yes/no confirms, and spinners. Think of it as the polite waiter who asks "what would you like?" and shows you the menu.

(`@clack/core` is the lower-level engine underneath. You usually only touch `@clack/prompts`.)

## The usual pattern

```ts
import { intro, select, isCancel, cancel, outro } from "@clack/prompts";

intro("my-app");                       // open the session

const choice = await select({
  message: "Pick one",
  options: [
    { value: "a", label: "Option A", hint: "extra info" },
    { value: "b", label: "Option B" },
  ],
});

if (isCancel(choice)) {                // user pressed Ctrl+C / Esc
  cancel("Cancelled.");
  process.exit(0);
}

outro(`You picked ${choice}`);         // close the session
```

## Key pieces
- **`intro` / `outro`**: print a styled start and end line, so the prompts look like one connected conversation.
- **`select`**: an arrow-key menu. It returns the chosen option's `value`. Other prompt types include `text`, `confirm`, and `multiselect`.
- **Prompts are async**: they return a Promise, so you `await` them. See [async-await.md](async-await.md).
- **`isCancel` + `cancel`**: when a user cancels, clack returns a special *symbol* instead of a value. Always check for it before using the answer.

💡 **Tip:** With TypeScript you can write `select<MyType>(...)`. Then, after the `isCancel` check, the answer is correctly typed as `MyType`.

**Used in:** [files/terminal-ui/wakeup.ts.md](../files/terminal-ui/wakeup.ts.md)
