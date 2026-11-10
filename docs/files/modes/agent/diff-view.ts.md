# modes/agent/diff-view.ts

**Purpose:** Two small helpers that turn the agent's staged file actions into a readable **diff**: one works out a file's overall *before* and *after* text, the other formats those two texts as a unified patch.

**Where it fits:** [approval.ts](approval.ts.md) calls both functions when it builds its review groups, so the "Show diff" option has something to display. The `ActionLog` type comes from [types.ts](types.ts.md). The diff itself is made by the `diff` package listed in [package.json](../../package.json.md). Concept: [unified-diffs.md](../../../concepts/unified-diffs.md).

---

### `formatPatch(filePath, before, after)`

```ts
import { createTwoFilesPatch } from "diff";

export function formatPatch(
    filePath: string,
    before: string,
    after: string,
): string {
    return createTwoFilesPatch(filePath, filePath, before, after, "", "", {
        context: 3,
    });
}
```

**What it does:** It hands two versions of a text to `createTwoFilesPatch` and gets back one string in **unified diff** format. The arguments, in order:
- `filePath`, `filePath`: the "old file name" and "new file name" for the patch header. They are the same, because the file isn't being renamed.
- `before`, `after`: the old text and the new text to compare.
- `""`, `""`: optional extra header text for each side (often a date). Left empty here.
- `{ context: 3 }`: show 3 unchanged lines around each change, so you can see where it sits.

**Why it's used in general:** Comparing two texts line by line is tricky to do well. The `diff` library does it for you and outputs the same format as `git diff`, which most developers can already read.

**Why it's used here:** Before you approve a change, you should be able to see exactly which lines the agent wants to add (`+`) and remove (`-`). This wrapper keeps the library call in one place, so the rest of the code just says `formatPatch(path, before, after)`.

---

### `composeBeforeAfter(sorted)`

```ts
export function composeBeforeAfter(sorted: ActionLog[]): {
    before: string;
    after: string;
} {
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    if (last.type === "file_delete")
        return { before: last.details.before ?? "", after: "" };
    const before =
        first.type === "file_create" ? "" : (first.details.before ?? "");
    const after = last.details.after ?? "";
    return { before, after };
}
```

**What it does:** It receives all the staged actions for **one file**, already sorted oldest → newest, and squashes them into a single before/after pair:
- It picks the `first` and `last` action. The `!` tells TypeScript "this item exists" (the caller never passes an empty list).
- **If the last action is a delete:** the file ends up gone. *Before* is the text that was deleted, *after* is empty.
- **Otherwise:**
  - *before* is empty if the first action created the file (it didn't exist yet). If not, it's the text the file had before the first edit.
  - *after* is the text left by the last action.
- `?? ""` means "if that detail is missing, use an empty string".

**Why it's used in general:** When something changes in several steps, people usually care about the **net effect**: where it started and where it ended. Squashing a history down to "first state → last state" is the same idea as squashing commits in Git.

**Why it's used here:** The agent might create a file, then modify it twice. Showing three separate diffs would be noisy. With this helper you see one diff from the file's real starting point to its final staged content, which matches what will actually be written. The apply step uses the same "last write wins" idea (see [staged-changes-and-approval.md](../../../concepts/staged-changes-and-approval.md)).

💡 **Tip:** The return type `{ before: string; after: string }` is written inline. Returning a small object is a neat way to hand back two values at once. The caller unpacks it with `const { before, after } = composeBeforeAfter(sorted)`.

---

### 🧠 Key takeaways
- `formatPatch` wraps the `diff` library and produces a `git diff`-style patch with 3 lines of context.
- `composeBeforeAfter` squashes many actions on one file into one net before/after pair.
- A created file starts from empty text; a deleted file ends as empty text.
- Keeping these helpers in their own file leaves [approval.ts](approval.ts.md) focused on asking questions.
