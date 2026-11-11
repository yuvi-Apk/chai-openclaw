# frontends/terminal/prompts.ts

**Purpose:** The everyday **questions the terminal asks you**: save these changes? run this command? pick an option, type an answer. Logging in (asking for an API key) has its own file, [login.ts](login.ts.md).

**Where it fits:** Modes never ask questions themselves. They call `host.confirm`, `host.choose` or `host.ask`, and the terminal front end ([session-loop.ts](session-loop.ts.md)) answers them with these functions. [model-menu.ts](model-menu.ts.md) and [login.ts](login.ts.md) reuse `chooseOne` and `askText`. The menus are built with [@clack/prompts](../../../concepts/clack-prompts.md), colours with [chalk](../../../concepts/chalk-terminal-colors.md).

---

### `printStaged()` and `confirmChanges()`

```ts
printStaged(groups);
if (request.auto) return { approved: all };

// Without a terminal nobody can approve: keep the workspace untouched.
if (!process.stdin.isTTY) {
    console.log(chalk.yellow("No interactive terminal: staged changes were not applied."));
    return { approved: [] };
}
```

**What it does:** First it prints every staged change with a coloured diff (green `+` added, red `-` removed). Then:
- if auto-approve is on, it approves all;
- if there's no real terminal (for example a script), it approves **nothing**;
- otherwise it asks: save all, decide file by file, or discard all. File by file, you can also "Show full diff".

**Why it's used in general:** This is the [stage → approve → apply](../../../concepts/staged-changes-and-approval.md) pattern. See also [unified-diffs.md](../../../concepts/unified-diffs.md).

**Why it's used here:** The safe default is "no". If nobody can answer, nothing changes. Pressing Esc in the middle keeps what you already accepted and drops the rest.

---

### `confirmCommand()`

```ts
const choice = await select({
    message: "Allow this command?",
    options: [
        { value: "yes", label: "Yes, run it" },
        ...(request.rememberAs ? [{ value: "always", label: `Yes, and don't ask again for "${request.rememberAs}" commands this session` }] : []),
        { value: "no", label: "No, don't run it" },
    ],
});
```

**What it does:** Shows the shell command and asks yes / no. If the mode allows it, a third "always for this kind" option appears. The `...(cond ? [x] : [])` trick adds an item to the list only when the condition is true.

**Why it's used here:** Running commands on your computer is risky, so each one is approved, unless you chose "always" for that kind during this session.

---

### `chooseOne()` and `askText()`

```ts
export async function askText(question: string): Promise<string | null> {
    const typed = await text({ message: question });
    return isCancel(typed) ? null : String(typed ?? "");
}
```

**What it does:** Simple wrappers: pick one option from a list, or type some text. Both return `null` if you cancel with Esc or Ctrl+C.

**Why it's used here:** Returning `null` for "cancelled" gives modes one simple thing to check.

---

### 🧠 Key takeaways
- The questions modes ask (through the host) are answered here.
- The safe answer is always "no": no terminal or Esc means nothing changes.
- `chooseOne` and `askText` are small, shared building blocks other terminal files reuse.
- Asking for a key lives in [login.ts](login.ts.md); picking a model or provider lives in [model-menu.ts](model-menu.ts.md).
