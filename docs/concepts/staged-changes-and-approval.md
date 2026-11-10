# Staging changes and asking for approval

When you let an AI change files or run commands, you want a **"look before you leap"** step. The pattern used in `yuvi`'s agent mode has three stages:

```
1. STAGE    → the AI asks for a change; we write it down, but don't touch the disk
2. APPROVE  → show the user the list; they say yes or no to each
3. APPLY    → only the approved changes are written to disk / run
```

Think of it like an **online shopping cart**. Adding items doesn't charge you. You review the cart, remove what you don't want, and *then* check out.

You already know this pattern from Git: `git add` stages changes, and `git commit` makes them real.

## The pieces

- **An action log** (a list): every request is recorded with a `status`, such as `pending`, `approved`, `rejected`, or `executed`. Read-only actions (like reading a file) are logged as `executed` straight away, because they're harmless.
- **An overlay** (a "scratch copy"): a `Map` of *path → new content* for files that are staged but not yet written. When the AI reads a file it has already "changed", it sees the staged version. That keeps the AI's view consistent within one run.
- **A deleted set**: paths that are staged for deletion, so later reads act as if the file is already gone.
- **An approval step**: asks the user "approve all, review one by one, or cancel?". In a one-by-one review, changes are grouped per file, and each group can show a [diff](unified-diffs.md) before you accept or reject it. Every action ends up marked `approved` or `rejected`.
- **An apply step**: goes through the approved actions and does the real `mkdir`, `writeFile`, `rm`, or shell command.
- **A clear step**: throws away the overlay when you're done.

## Why "last write wins"

If the AI edits the same file three times, only the **final** version matters. The apply step sorts file actions by time and keeps the last one for each path, so the disk is written once with the end result.

💡 **Tip:** Path safety goes hand in hand with this pattern. Before touching any path, check that it stays *inside* the project folder, so `../../somewhere-else` can't sneak out.

**Used in:** [files/modes/agent/tool-executor.ts.md](../files/modes/agent/tool-executor.ts.md), [files/modes/agent/action-tracker.ts.md](../files/modes/agent/action-tracker.ts.md), [files/modes/agent/approval.ts.md](../files/modes/agent/approval.ts.md), [files/modes/agent/diff-view.ts.md](../files/modes/agent/diff-view.ts.md)
