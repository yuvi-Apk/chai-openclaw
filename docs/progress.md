# Progress

Living note. Claude reads it at the start of a fresh session and updates it at
the end of every significant task. Keep under 50 lines: prune done items.

_Last updated: 2026-11-11_

## Status

- Layers `core/` → `modes/` → `frontends/{terminal,telegram}/` in place.
  270 tests pass, tsc clean.
- Telegram front end built (`yuvi telegram`), not yet committed and **not yet
  tried against the real Telegram service** (tests use a fake Bot API).

## Just built

- OpenAI as a second model provider (`YUVI_LLM=openai`, `OPENAI_API_KEY`,
  `OPENAI_DEFAULT_MODEL`, `OPENAI_FAST_MODEL`), `core/llm/profiles.ts`,
  provider-aware key prompt and error advice. Decision D21. Not yet tried
  with a real OpenAI key. 281 tests pass, tsc clean.

- `frontends/telegram/` (polling, PIN lock, approvals, files, photos) and its
  core support (`HandleOptions.images`, `path-safety.ts`). Decisions D15–D20.

## Next

- User: copy the new variables into `.env`, set `YUVI_LLM=openai`, try a Chat
  question and an Agent change. Maybe a `/` menu item to switch provider.
- OpenAI cost shows $0: add a price table if an estimate is wanted.

- User's manual check of the bot (README "Telegram"): unlock, Chat, an Agent
  change with Approve/Reject, `/stop`, a photo, a file upload, `/file`.
- User's manual check of the interactive terminal (unchanged, still open).
- Photos in Chat mode; voice notes; "turn finished" alert; daily spend cap.
- Split `modes/agent/tool-executor.ts` and the long `runLoop` / `runTurn` in
  `brain.ts`; move the agent's path check to `core/security/path-safety.ts`.

## Known issues

- Telegram: `frontends/telegram/chat-controller.ts` is 322 lines (aim is 300).
- Telegram: there is no "Run checks" quick button; the agent has no such command.
- Agent: a correction typed during an approval is dropped when the turn ends
  right after a rejection (Telegram works around it, the terminal does not).
- Plan mode read-only list allows `git diff --output=` and `bunx tsc` without `--noEmit`.
- Agent workspace path check does not resolve symlinks.
- DNS check and fetch are separate in the page fetcher (rebinding gap).
- API key stored as plain text in `~/.yuvi/settings.json`.
- Dependencies use `^` ranges and `latest`; not pinned.
- Prettier config does not match the code; no linter. `docs/files/` lists removed paths.
- Tavily search untested with a real key.
