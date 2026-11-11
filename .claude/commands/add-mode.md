---
description: Scaffold a new mode following the add-new-mode checklist.
argument-hint: <mode-name> [what it does]
---

Add a new mode: $ARGUMENTS

1. Read `.claude/rules/add-new-mode.md`, `modes/echo/mode.ts` and `core/mode.ts`
   (types only). Read `docs/adding-a-mode.md` only if you need the code example.
2. Show a short plan: name, label, what `handle` does, the `tools` it needs
   (least possible), its commands, and whether it starts `hidden: true`.
   Wait for approval.
3. After approval, create:
   - `modes/<name>/mode.ts` exporting `<name>Mode: Mode`
   - `modes/<name>/__tests__/mode.test.ts` (turn with `FakeLLM` +
     `createRecordingHost`, commands, abort)
   - one `.register(<name>Mode)` line in `modes/index.ts`
4. Run `bun test` and `bunx tsc --noEmit -p .`.
5. Update docs per the checklist and `docs/progress.md`; append to
   `docs/decisions.md` only if a new permission or event type was added.
