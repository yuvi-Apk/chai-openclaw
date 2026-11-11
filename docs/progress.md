# Progress

Living note. Claude reads it at the start of a fresh session and updates it at
the end of every significant task. Keep under 50 lines: prune done items.

_Last updated: 2026-11-12_

## Status

- Layers `core/` → `modes/` → `frontends/{terminal,telegram}/` in place.
  334 tests pass, tsc clean.
- Telegram front end built (`yuvi telegram`), **not yet tried against the
  real Telegram service** (tests use a fake Bot API).

## Just built

- Four model providers: OpenRouter, OpenAI, Gemini (`GEMINI_*`), Claude
  (`ANTHROPIC_*`). Decisions D21–D22. None of the new ones tried with a real key.
- Switch provider / model / effort from the menus, mid-session: terminal `/`
  menu, Telegram `/provider`, `/model`, `/effort` (D23). `core/llm/choices.ts`.
- Log in / log out (D24): first-run welcome in `frontends/terminal/login.ts`,
  key checked by `core/llm/verify-key.ts`, kept in the OS vault via
  `Bun.secrets` (`core/security/key-store.ts`). Not yet tried by hand.

## Next

- User: run `yuvi wakeup` once (the old settings.json key moves to the vault),
  try Log out → Log in with a wrong key and a right one, then each provider.
  Remove `YUVI_LLM` and the `*_API_KEY` lines from `.env` to rely on login.
- Check `reasoning: "low"` works on Gemini and Claude; else `YUVI_REASONING=off`.
- Cost shows $0 except on OpenRouter: add a price table if an estimate is wanted.
- `classifyError` is 44 lines: turn the phrase lists into a table.
- User's manual check of the bot (README "Telegram") and of the terminal.
- Photos in Chat mode; voice notes; "turn finished" alert; daily spend cap.
- Split `modes/agent/tool-executor.ts` and the long `runLoop` / `runTurn` in
  `brain.ts`; move the agent's path check to `core/security/path-safety.ts`.

## Known issues

- Telegram: `frontends/telegram/chat-controller.ts` is 316 lines (aim is 300).
- `core/config.ts` is 311 lines (aim is 300): next split, the generic readers.
- Telegram: there is no "Run checks" quick button; the agent has no such command.
- Agent: a correction typed during an approval is dropped when the turn ends
  right after a rejection (Telegram works around it, the terminal does not).
- Plan mode read-only list allows `git diff --output=` and `bunx tsc` without `--noEmit`.
- Agent workspace path check does not resolve symlinks.
- DNS check and fetch are separate in the page fetcher (rebinding gap).
- No OS vault (Linux without libsecret): keys fall back to plain settings.json.
- Dependencies use `^` ranges and `latest`; not pinned. Tavily untested.
- Prettier config does not match the code; no linter. `docs/files/` lists removed paths.
