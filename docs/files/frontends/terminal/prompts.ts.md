# frontends/terminal/prompts.ts

**Purpose:** Every **question the terminal asks you**: save these changes? run this command? pick an option, type an answer, set your API key.

**Where it fits:** Modes never ask questions themselves. They call `host.confirm`, `host.choose` or `host.ask`, and the terminal front end ([session-loop.ts](session-loop.ts.md)) answers them with these functions. The menus are built with [@clack/prompts](../../../concepts/clack-prompts.md), colours with [chalk](../../../concepts/chalk-terminal-colors.md). Keys and models are saved through [core/config.ts](../../core/config.ts.md).

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

### `setupApiKey()`: set a key for a provider

```ts
export async function setupApiKey(settings: Settings, provider = settings.llmProvider): Promise<boolean> {
    const { label, keysUrl } = profileFor(provider);
    log.info([
        chalk.bold(`yuvi needs a ${label} key to talk to an AI model.`),
        `1. Open ${keysUrl} and sign in`,
        // ...
        chalk.dim("To use another provider, type / and choose “Switch AI provider”."),
    ].join("\n"));
    const key = await password({ message: `Paste your ${label} key (Esc to skip):`, ... });
    // ...
    settings.saveApiKey(String(key).trim(), provider);
}
```

**What it does:** Looks up the [provider profile](../../core/llm/profiles.ts.md) for `provider` and shows steps with that provider's name and key page. `provider` defaults to the one in use, but a caller can name another. It uses `password()`, so the key is hidden as you type. A key shorter than 20 characters is refused as "too short". Then `saveApiKey` stores it in that provider's own field.

**Why it's used in general:** A **default parameter** (`provider = settings.llmProvider`) keeps the simple call simple (`setupApiKey(settings)`) while allowing a more specific one.

**Why it's used here:** The `/key` command uses the default. The provider menu in [model-menu.ts](model-menu.ts.md) calls `setupApiKey(settings, "gemini")` to ask for Gemini's key *before* switching to it. The key goes to `~/.yuvi/settings.json` only ([user-settings-file.md](../../../concepts/user-settings-file.md)).

---

### 🧠 Key takeaways
- All terminal questions live here; modes only ask through the host.
- The safe answer is always "no": no terminal or Esc means nothing changes.
- The key prompt names the provider and links to its key page.
- `setupApiKey` can save a key for any provider, not only the one in use.
- Picking a model or provider lives in [model-menu.ts](model-menu.ts.md).
