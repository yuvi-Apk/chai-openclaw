# Unified diffs (and the `diff` package)

A **diff** shows the difference between two versions of a text. The **unified** format is the one `git diff` prints, and it's the most common way developers review changes.

Think of it like a teacher's **red pen**: it doesn't rewrite your whole essay, it just marks which lines go and which lines come in.

## How to read one

```diff
--- hello.ts
+++ hello.ts
@@ -1,3 +1,3 @@
 const name = "yuvi";
-console.log("Hello");
+console.log("Hello from " + name);
 export {};
```

- `--- hello.ts` / `+++ hello.ts`: the old file and the new file.
- `@@ -1,3 +1,3 @@`: a **hunk header**. It says "this chunk covers 3 lines starting at line 1 in the old file, and 3 lines starting at line 1 in the new file".
- A line starting with `-` was **removed**.
- A line starting with `+` was **added**.
- A line starting with a space is unchanged. These are **context** lines, shown so you can tell where the change sits.

A changed line appears as a `-` line followed by a `+` line. A brand-new file is all `+` lines. A deleted file is all `-` lines.

## Making one in code

The [`diff`](https://github.com/kpdecker/jsdiff) package (also called jsdiff) compares texts for you:

```ts
import { createTwoFilesPatch } from "diff";

const patch = createTwoFilesPatch(
    "hello.ts",      // old file name
    "hello.ts",      // new file name
    oldText,
    newText,
    "",              // old header (optional, e.g. a date)
    "",              // new header (optional)
    { context: 3 },  // unchanged lines to show around each change
);
```

It returns the patch as one string, ready to print.

💡 **Tip:** More `context` makes a diff easier to place but longer to read. 3 lines is the same default Git uses.

💡 **Tip:** In Markdown, a code fence marked ` ```diff ` tells renderers the block is a diff, and many of them colour `+` and `-` lines.

**Used in:** [files/modes/agent/diff-view.ts.md](../files/modes/agent/diff-view.ts.md), [files/modes/agent/approval.ts.md](../files/modes/agent/approval.ts.md)
