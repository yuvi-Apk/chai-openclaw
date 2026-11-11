---
description: Review the current git changes against the project rules.
---

Review the uncommitted changes (`git status`, `git diff`, `git diff --cached`).
If there are none, review the last commit (`git show HEAD`).

Delegate the review to the `code-reviewer` agent, passing the list of changed
files. Then run `bun test` and `bunx tsc --noEmit -p .` yourself.

Report, most severe first:

- Findings as `file:line - problem - suggested fix`, grouped as
  **Must fix** (bugs, architecture or security breaks, missing tests) and
  **Should fix** (SOLID, duplication, style).
- Test and type-check results with counts.
- One line verdict: ready / not ready.

Do not change any files.
