# modes/agent/approval.ts

**Purpose:** The **"are you sure?"** step of agent mode. It shows you every change the agent prepared, in plain words and with a coloured diff, and lets you save all of them, decide file by file, or discard them. It also decides whether a shell command may run.

**Where it fits:** [orchestrator.ts](orchestrator.ts.md) calls `runApprovalFlow` from the session's `checkpoint`. It reads the staged actions from the [ActionTracker](action-tracker.ts.md), builds diffs with [diff-view.ts](diff-view.ts.md), and colours them with `colorizeDiff` from [ui.ts](ui.ts.md). The shapes `ActionLog` and `AgentSession` come from [types.ts](types.ts.md). Background: [staged-changes-and-approval.md](../../../concepts/staged-changes-and-approval.md).

---

### The `ReviewGroup` shape

```ts
interface ReviewGroup {
    label: string;
    actionIds: string[];
    patch: string | null;
}
```

**What it does:** It describes **one thing you are asked about**:
- `label`: the text shown to you, like `hello.ts (file_create)`.
- `actionIds`: every logged action that belongs to this question.
- `patch`: the diff text to show, or `null` when there is nothing to diff.

**Why it's used in general:** A small [interface](../../../concepts/typescript-interfaces-and-utility-types.md) gives a name to a bundle of data. `string | null` is a [union type](../../../concepts/typescript-union-types.md) that says "maybe there is no value".

**Why it's used here:** The agent may touch the same file several times. You should answer **once per file**, not once per edit.

---

### `groupPending(pending)`: sorting actions into buckets

```ts
const byPath = new Map<string, ActionLog[]>();
const shells: ActionLog[] = [];

for (const a of pending) {
    if (a.type === "tool_execute") {
        shells.push(a);
        continue;
    }
    const key = a.path;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key)!.push(a);
}
```

**What it does:**
- Shell commands (`tool_execute`) go into their own list.
- File and folder actions go into a `Map` keyed by path, so all actions on `hello.ts` land in the same bucket.
- The `!` in `byPath.get(key)!` tells TypeScript "trust me, this exists". The line above just created it.

**Why it's used in general:** "Group by key" with a `Map` is one of the most common data-shaping patterns.

**Why it's used here:** Files are reviewed per path. Each shell command is its own decision.

---

### `groupPending(pending)`: turning buckets into review groups

```ts
const sorted = acts.sort(
    (x, y) => x.timestamp.getTime() - y.timestamp.getTime(),
);
const ids = sorted.map((x) => x.id);

if (sorted.every((x) => x.type === "folder_create")) {
    groups.push({ label: `Create folder: ${p}`, actionIds: ids, patch: null });
    continue;
}

const { before, after } = composeBeforeAfter(sorted);
const patch = formatPatch(p, before, after);
const kinds = [...new Set(sorted.map((x) => x.type))].join(", ");
groups.push({ label: `${p} (${kinds})`, actionIds: ids, patch });
```

**What it does:** For each path (paths are sorted A→Z first):
- It sorts that path's actions **oldest first**.
- A path with only folder creations gets the label `Create folder: <path>` and no patch.
- Otherwise [diff-view.ts](diff-view.ts.md) works out the file's overall *before* and *after* text and turns it into a patch.
- `new Set(...)` removes duplicate action types for the label.

After the files, each shell command becomes its own group with the label `Shell: <command>`.

**Why it's used in general:** Sorting by time before combining is how you squash a history into one net result.

**Why it's used here:** You see **one net diff per file**, no matter how many steps the agent took.

---

### `printStaged(groups)`: showing what is about to change

```ts
console.log(
    chalk.bold(
        `\nyuvi wants to make ${groups.length} change${groups.length === 1 ? "" : "s"}. Nothing is saved yet:`,
    ),
);
console.log(chalk.dim("Green lines (+) are added, red lines (-) are removed."));
for (const g of groups) {
    console.log(`\n${chalk.cyan("▌")} ${chalk.bold(g.label)}`);
    if (g.patch) console.log(colorizeDiff(g.patch, 60));
}
```

**What it does:**
- It prints a bold headline that counts the changes and says clearly that **nothing is saved yet**. The small `=== 1 ? "" : "s"` part picks "change" or "changes".
- A dim line explains how to read a diff: green `+` lines are added, red `-` lines are removed.
- Then for each group it prints the label and up to 60 coloured diff lines.

**Why it's used in general:** Good prompts show the facts *before* asking the question. A one-line legend removes the need to already know the notation.

**Why it's used here:** Someone who has never seen a [unified diff](../../../concepts/unified-diffs.md) can still understand what they are about to say yes or no to. Colours come from [chalk](../../../concepts/chalk-terminal-colors.md).

---

### `runApprovalFlow(tracker, options)`: the quick exits

```ts
const pending = tracker.getPendingMutations();
if (pending.length === 0) return false;

const groups = groupPending(pending);
printStaged(groups);

if (options.autoApprove) {
    for (const a of pending) tracker.updateActionStatus(a.id, "approved", true);
    return true;
}

if (!process.stdin.isTTY) {
    for (const a of pending) tracker.updateActionStatus(a.id, "rejected", false);
    console.log(chalk.yellow("No interactive terminal: staged changes were not applied."));
    return false;
}
```

**What it does:**
- Nothing staged → return `false` straight away.
- Otherwise the changes are always printed first.
- `autoApprove` (set when the session is in **Auto mode**) marks everything `approved` without asking. You still see the diffs.
- `process.stdin.isTTY` is `true` only when a real person is at a real terminal. If input is piped, nobody can answer, so everything is rejected.

**Why it's used in general:** Handling the simple cases first with early returns keeps the main path easy to read.

**Why it's used here:** The safe default when no human can answer is "touch nothing".

---

### `runApprovalFlow`: the main question

```ts
const choice = await select({
    message: "Save these changes to your files?",
    options: [
        { value: "all", label: "Yes, save all changes" },
        { value: "select", label: "Let me decide file by file" },
        { value: "cancel", label: "No, discard all changes", hint: "your files stay as they are" },
    ],
});

if (isCancel(choice) || choice === "cancel") {
    for (const a of pending) tracker.updateActionStatus(a.id, "rejected", false);
    return false;
}

if (choice === "all") {
    for (const a of pending) tracker.updateActionStatus(a.id, "approved", true);
    return true;
}
```

**What it does:** A clack [`select` menu](../../../concepts/clack-prompts.md) asks one plain question with three answers:
- **Yes, save all changes** → every action is marked `approved`.
- **Let me decide file by file** → continue to the per-file review below.
- **No, discard all changes** (or Esc / Ctrl+C, which `isCancel` detects) → every action is marked `rejected`. The hint reassures you: "your files stay as they are".

**Why it's used in general:** Offering a fast path beside a careful path is a common review design. Git has the same idea with `git add .` and `git add -p`.

**Why it's used here:** The labels describe **what will happen to your files**, so you don't need to know words like "staged" or "apply". The apply step in [tool-executor.ts](tool-executor.ts.md) only writes actions whose status is `approved`.

---

### `runApprovalFlow`: deciding file by file

```ts
for (const g of groups) {
    while (true) {
        const opt = await select({
            message: chalk.bold(g.label),
            options: [
                { value: "accept", label: "Yes, save this change" },
                { value: "diff", label: "Show full diff", hint: g.patch ? "" : "N/A" },
                { value: "reject", label: "No, discard this change" },
            ],
        });

        if (isCancel(opt)) { /* reject what is still pending, then return */ }
        if (opt === "diff") {
            if (g.patch) console.log("\n" + colorizeDiff(g.patch, 2000) + "\n");
            continue;
        }
        // mark every action in the group approved or rejected
        break;
    }
}
```

**What it does:** For each group it asks about that one change.
- **Yes, save this change / No, discard this change** marks every action in the group, and `break` moves on to the next group.
- **Show full diff** prints the whole diff (up to 2000 lines), then `continue` shows the same menu again. The hint is `N/A` for folders and shell commands, which have no diff.
- **Esc / Ctrl+C** stops the review. Groups you have not decided yet are rejected. Groups you already accepted **stay accepted**.

At the very end the function returns `true` if at least one action is `approved`:

```ts
return tracker.getActions().some((a) => a.status === "approved");
```

**Why it's used in general:** A `while (true)` loop with `continue` and `break` is the classic shape for "keep asking until we get a final answer".

**Why it's used here:** Looking at the diff is not a decision, so the menu comes back afterwards.

---

### `isReadOnlyCommand(session, command)`

```ts
const cmd = command.trim();
// Chaining, piping and redirection can hide a second command.
if (/[;&|<>`]|\$\(/.test(cmd)) return false;
if (session.config.checkCommands.includes(cmd)) return true;
return READ_ONLY_PREFIXES.some((p) => startsWithWord(cmd, p));
```

**What it does:**
- If the command contains `;`, `&`, `|`, `<`, `>`, a backtick, or `$(`, it is never treated as read-only. Those characters can glue a second command on.
- The project's own check commands are allowed.
- Otherwise it must start with a known harmless prefix such as `git status`, `ls`, or `bun test`. `startsWithWord` makes sure `ls` matches `ls src` but not `lsblk`.

**Why it's used in general:** An **allow-list** ("only these are OK") is safer than a block-list ("everything except these").

**Why it's used here:** Commands that only look at things can run without bothering you.

---

### `approveCommand(session, command)`

```ts
console.log(
    `\n${chalk.yellow("▌")} ${chalk.bold("yuvi wants to run a command on your computer:")}\n  ${chalk.cyan(cmd)}`,
);
const choice = await select({
    message: "Allow this command?",
    options: [
        { value: "yes", label: "Yes, run it" },
        ...(chained ? [] : [{
            value: "always",
            label: `Yes, and don't ask again for "${prefix}" commands this session`,
        }]),
        { value: "no", label: "No, don't run it" },
    ],
});
if (isCancel(choice) || choice === "no") return false;
if (choice === "always") session.allowedCommands.add(prefix);
return true;
```

**What it does:**
- Before this snippet, three quick checks run: read-only commands pass, a prefix you already allowed this session passes, and with no real terminal the answer is `false`.
- Otherwise it prints a full sentence, "yuvi wants to run a command on your computer:", with the command on its own line in cyan.
- The menu offers **Yes, run it**, **Yes, and don't ask again for "…" commands this session**, and **No, don't run it**.
- The "don't ask again" option is left out for chained commands. `...(condition ? [] : [item])` is a neat trick for adding an array item only sometimes.
- `prefix` is the first one or two words, like `bun add` or `mkdir`, worked out by `commandPrefix`.

The whole prompt runs inside `session.ui.withPrompt(...)`, which pauses the spinner while you answer (see [ui.ts](ui.ts.md)).

**Why it's used in general:** "Ask once, remember for the session" balances safety with not nagging the user.

**Why it's used here:** A shell command can do anything on your machine, so it is asked about even in Auto mode.

---

### 🧠 Key takeaways
- Nothing reaches the disk without passing through this file.
- Changes are always shown first, with a one-line guide to reading the diff.
- Menu labels say what happens to your files: save all, decide file by file, or discard.
- Actions are grouped per file, so you answer once per file and see one net diff.
- Shell commands get their own question, unless they are on the read-only allow-list or you allowed that kind this session.
