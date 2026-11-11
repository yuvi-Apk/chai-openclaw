# Progress

Living note. Claude reads it at the start of a fresh session and updates it at
the end of every significant task. Keep under 50 lines: prune done items.

_Last updated: 2026-11-11_

## Status

- Refactor to `core/` → `modes/` → `frontends/terminal/` is done (branch
  `refactor/core-modes`, commit `bf8de8f`). 174 tests pass, tsc clean.
- Claude Code config added: `CLAUDE.md`, `.claude/rules/`, commands, agents,
  settings with a Stop hook that runs tests + tsc when `.ts` files changed.

## Just built

- Mode contract and registry; Agent, Plan, Chat, hidden Echo modes.
- Shared core: config, errors, log, usage, LLM and search adapters, security.

## Next

- User's manual check of the interactive terminal (input box, `/` menu,
  Shift+Tab, Esc/Ctrl+C, approvals, undo, `@file`).
- Split `modes/agent/tool-executor.ts` (paths, staging, search) and the long
  `runLoop` / `runTurn` in `modes/agent/brain.ts`.
- Telegram front end (implement `ModeHost`).

## Known issues

- Plan mode read-only list allows `git diff --output=` and `bunx tsc` without `--noEmit`.
- Workspace path check does not resolve symlinks.
- DNS check and fetch are separate in the page fetcher (rebinding gap).
- API key stored as plain text in `~/.yuvi/settings.json`.
- Dependencies use `^` ranges and `latest`; not pinned.
- Prettier config does not match the code; no linter.
- `docs/files/` documents removed paths (`ai/`, `terminal-ui/`).
- Tavily search untested with a real key.
