---
description: Make an architecture-aware plan for a feature. No code.
argument-hint: <what to build>
---

Plan this feature: $ARGUMENTS

Do not write or edit any code. Read `docs/progress.md`, then the rule files that
apply (`.claude/rules/architecture.md`, `solid-and-patterns.md`, and
`add-new-mode.md` / `security.md` when relevant). Open only the source files you need.

Reply with a short plan:

1. **Goal** in one or two sentences.
2. **Where it goes**: which layer and folder, and why that fits the architecture.
   If it does not fit, say so and stop with options.
3. **Steps**: small, each one testable, in order.
4. **Files**: new files and existing ones to touch. Prefer new modules over
   editing working code.
5. **Tests**: what each step adds (see `testing.md`).
6. **Risks / decisions for the user**: behaviour changes, new dependencies,
   new tool permissions or events.
7. **Docs**: `docs/decisions.md` entry text if architectural; docs to update.

Then wait for approval.
