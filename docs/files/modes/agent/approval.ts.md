# modes/agent/approval.ts

**Purpose:** The **"are you sure?"** step of agent mode. It shows you what the agent staged, lets you approve everything, review changes one by one (with a diff), or cancel, and records your decision on every action.

**Where it fits:** [orchestrator.ts](orchestrator.ts.md) calls `runApprovalFlow(tracker)` after the agent finishes. This file reads the staged actions from the [ActionTracker](action-tracker.ts.md), uses [diff-view.ts](diff-view.ts.md) to build diffs, and prints them with [terminal-md.ts](../../terminal-ui/terminal-md.ts.md). The action shape (`ActionLog`) comes from [types.ts](types.ts.md). What it returns decides whether the orchestrator applies changes or throws them away. Background: [staged-changes-and-approval.md](../../../concepts/staged-changes-and-approval.md).

---

### The `ReviewGroup` shape

```ts
interface ReviewGroup {
    label: string;
    actionIds: string[];
    patch: string | null;
}
```

**What it does:** It describes **one thing you are asked about** during review:
- `label`: the text shown in the prompt, like `hello.ts (file_create)`.
- `actionIds`: every logged action that belongs to this question.
- `patch`: the diff text to show, or `null` when there is nothing to diff.

**Why it's used in general:** A small [interface](../../../concepts/typescript-interfaces-and-utility-types.md) gives a name to a bundle of data, so the rest of the code can pass it around safely. `string | null` is a [union type](../../../concepts/typescript-union-types.md) that says "maybe there is no value".

**Why it's used here:** The agent may touch the same file several times. You should answer **once per file**, not once per edit. A group ties those edits together, so one "Accept" approves all of them.

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
- It walks through every pending action.
- Shell commands (`tool_execute`) go into their own list, `shells`.
- Everything else (file and folder actions) goes into a `Map` keyed by path. All actions on `hello.ts` land in the same bucket.
- `byPath.get(key)!`: the `!` tells TypeScript "trust me, this exists". It's safe because the line above just created the bucket if it was missing.

**Why it's used in general:** "Group by key" with a `Map` is one of the most common data-shaping patterns: look up the bucket, create it if needed, push the item in.

**Why it's used here:** Files are reviewed per path, while each shell command is its own separate decision. Two different commands should never be approved with one click.

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

**What it does:** For each path (the paths are first sorted A→Z with `localeCompare`, so the review order is predictable):
- It sorts that path's actions **oldest first** using their timestamps.
- If every action is a folder creation, the group gets the label `Create folder: <path>` and no patch. A folder has no text to compare.
- Otherwise it asks [diff-view.ts](diff-view.ts.md) for the file's overall *before* and *after* text, and turns those into a patch.
- `kinds` collects the action types. `new Set(...)` removes duplicates, so two modifies show as `file_modify` once. A file that was created and then edited is labelled `hello.ts (file_create, file_modify)`.

After the files, each shell command becomes its own group:

```ts
for (const s of shells) {
    groups.push({
        label: `Shell: ${s.details.command ?? "(no command)"}`,
        actionIds: [s.id],
        patch: null,
    });
}
```

`??` means "use the right side if the left is `null` or `undefined`", so a missing command still gets a readable label.

**Why it's used in general:** Sorting by time before combining is how you squash a history into one net result. `Set` is the quick way to get unique values.

**Why it's used here:** You see **one net diff per file** (start → final result), no matter how many steps the agent took to get there. Shell commands come last, after the files they might depend on.

---

### `runApprovalFlow(tracker)`: the first question

```ts
const pending = tracker.getPendingMutations();

if (pending.length === 0) {
    console.log(
        chalk.dim("\nNo staged file, folder, or shell changes to review.\n"),
    );
    return false;
}

const choice = await select({
    message: "Apply staged changes?",
    options: [
        { value: "all", label: "Approve and apply all" },
        { value: "select", label: "Review one by one" },
        { value: "cancel", label: "Cancel" },
    ],
});
```

**What it does:**
- It asks the tracker for every staged action that is still `pending`.
- If there are none (the agent only read files, for example), it prints a dim note and returns `false`. There is nothing to apply.
- Otherwise it shows a clack [`select` menu](../../../concepts/clack-prompts.md) with three choices. The function is `async` and `await`s the answer ([async-await.md](../../../concepts/async-await.md)).

**Why it's used in general:** Offering a fast path ("yes to all") beside a careful path ("show me each one") is a common review design. Git has the same idea with `git add .` and `git add -p`.

**Why it's used here:** Small, obvious changes can be approved in one keypress. Bigger ones can be inspected one at a time.

---

### `runApprovalFlow(tracker)`: cancel or approve all

```ts
if (isCancel(choice) || choice === "cancel") {
    for (const a of pending) tracker.updateActionStatus(a.id, "rejected", false);
    return false;
}

if (choice === "all") {
    for (const a of pending) tracker.updateActionStatus(a.id, "approved", true);
    return true;
}
```

**What it does:**
- **Cancel** (the menu option, or Ctrl+C / Esc, which `isCancel` detects): every pending action is marked `rejected`, and the function returns `false`.
- **Approve and apply all**: every pending action is marked `approved`, and the function returns `true`.

`updateActionStatus(id, status, userApproved)` writes the decision into the log.

**Why it's used in general:** Recording the decision on each item, instead of only returning yes/no, leaves a clear trail of what the user actually agreed to.

**Why it's used here:** The apply step in [tool-executor.ts](tool-executor.ts.md) only writes actions whose status is `approved`. So these status updates are what really unlock (or block) each change. The returned boolean tells the orchestrator whether to run the apply step at all.

---

### `runApprovalFlow(tracker)`: review one by one

```ts
for (const g of groupPending(pending)) {
    while (true) {
        const opt = await select({
            message: chalk.bold(g.label),
            options: [
                { value: "accept", label: "Accept" },
                { value: "diff", label: "Show diff", hint: g.patch ? "" : "N/A" },
                { value: "reject", label: "Reject" },
            ],
        });
        // ...handle opt (below)...
    }
}
```

**What it does:** For each review group it shows a menu with the group's label in bold ([chalk](../../../concepts/chalk-terminal-colors.md)) and three options: **Accept**, **Show diff**, **Reject**. When the group has no patch (folders and shell commands), the diff option shows the hint `N/A`.

The `while (true)` loop keeps asking about the **same** group until you make a final choice.

```ts
if (isCancel(opt)) {
    for (const a of pending) tracker.updateActionStatus(a.id, "rejected", false);
    return false;
}

if (opt === "diff") {
    if (g.patch) {
        console.log(
            "\n" + renderTerminalMarkdown("```diff\n" + g.patch + "\n```\n") + "\n",
        );
    }
    continue;
}

for (const id of g.actionIds) {
    tracker.updateActionStatus(
        id,
        opt === "accept" ? "approved" : "rejected",
        opt === "accept",
    );
}
break;
```

**What it does:**
- **Ctrl+C / Esc** in the middle of a review rejects **everything**, including groups you accepted earlier, and returns `false`. Cancel means "apply nothing".
- **Show diff** wraps the patch in a Markdown ` ```diff ` code fence and prints it through `renderTerminalMarkdown`. Then `continue` jumps back to the top of the loop, so the same menu appears again.
- **Accept / Reject** marks every action in the group, and `break` leaves the loop to move on to the next group.

**Why it's used in general:** A `while (true)` loop with `continue` and `break` is the classic shape for "keep asking until we get a final answer". Some options (like "show me more info") shouldn't end the question.

**Why it's used here:** Looking at the diff is not a decision. After reading it, you still need to accept or reject, so the menu comes back. Reusing the Markdown renderer means the diff is printed as a tidy code block with no extra display code. See [unified-diffs.md](../../../concepts/unified-diffs.md) for how to read the output.

---

### `runApprovalFlow(tracker)`: the final answer

```ts
return tracker.getActions().some((a) => a.status === "approved");
```

**What it does:** After every group is decided, it returns `true` if **at least one** action ended up `approved`, and `false` otherwise. `.some()` stops as soon as it finds a match.

**Why it's used in general:** `some` answers "is there any item like this?" without writing a loop.

**Why it's used here:** If you rejected every group, there is nothing to apply. The orchestrator then just clears the staging area.

💡 **Tip:** The return type is lowercase `Promise<boolean>`. Lowercase `boolean` is the simple true/false type you almost always want. See [typescript-interfaces-and-utility-types.md](../../../concepts/typescript-interfaces-and-utility-types.md).

---

### 🧠 Key takeaways
- This is the "checkout" step of stage → approve → apply: nothing reaches the disk without a decision here.
- Three paths: approve all, review one by one, or cancel (which rejects everything).
- Actions are grouped per file path, so you answer once per file and see one net diff. Each shell command is its own group.
- The decision is stored on each action (`approved` / `rejected`), and the apply step only touches approved ones.
- The function returns `true` only when at least one action was approved.
