---
paths:
  - "**/__tests__/**"
  - "**/*.test.ts"
  - "core/testing.ts"
---

# Testing

## Layout and naming

- Runner: `bun test` (`import { test, expect, describe } from "bun:test"`).
- Tests live in `__tests__/` next to the code: `core/__tests__/`,
  `modes/<name>/__tests__/`, `frontends/terminal/__tests__/`.
- File name: `<area>.test.ts` (e.g. `executor.test.ts`, `pipeline.test.ts`).
- Test name says the behaviour: `test("refuses a path outside the workspace", ...)`.
- Shared helpers for one mode go in that folder's `helpers.test.ts` style file.

## What to fake

- Model: `FakeLLM` from `core/testing.ts`, or `MockLanguageModelV4` from `ai/test`
  for agent tool loops.
- User and screen: `createRecordingHost` (records events and confirmations).
- Settings: `testSettings({ YUVI_X: "1" })` (env map, no settings file); never the real environment or key file.
- Network: inject a fake `fetch` or a fake `SearchProvider` / `PageFetcher`.
- Files: a temp folder from `fs.mkdtempSync(os.tmpdir())`, removed afterwards.
- Do not mock what you own inside the unit under test; fake only boundaries.

## Required

- Every change ships with tests or updated tests.
- Every bug fix gets a regression test that fails before the fix.
- Mode changes: at least one end-to-end turn through `createRecordingHost`.
- Moved code keeps its tests and their assertions.
- No test may call a real model, search engine or web page, or need a key.

## Done means

`bun test` passes with 0 fail and `bunx tsc --noEmit -p .` reports 0 errors.
Report the counts in the summary. A skipped or flaky test is reported, never hidden.
