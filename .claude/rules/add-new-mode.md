---
paths:
  - "modes/**"
  - "frontends/**"
  - "core/llm/**"
  - "core/search/**"
---

# Adding a mode, provider or front end

Worked code example: `docs/adding-a-mode.md`. Smallest real mode: `modes/echo/mode.ts`.
Always plan first and get approval.

## New mode (e.g. "summarise")

1. Create `modes/<name>/mode.ts` exporting a `Mode` (`core/mode.ts`):
   `name`, `label`, `description`, `tools` (least needed), `createSession(host)`.
2. Implement `ModeSession`: `handle(input, { signal })`, `commands()`,
   `welcome()`, `help()`, `status()`, `close()`. Optional: `steer`, `cycle`, `files`.
3. Output only through `host.emit(event)`; questions only through
   `host.confirm/choose/ask`. Stop when `signal` aborts.
4. Use `host.core.llm`, `.search`, `.pages`, `.settings`. Mode-specific settings
   get a loader like `modes/chat/config.ts` reading from `Settings`.
5. Register it: one `.register(<name>Mode)` line in `modes/index.ts`.
   Use `hidden: true` while unfinished.
6. Tests in `modes/<name>/__tests__/`: a turn with `FakeLLM` +
   `createRecordingHost`, each command, abort, and a refused undeclared tool.
7. Docs: add the mode to README modes list and `docs/ARCHITECTURE.md` tree;
   append to `docs/decisions.md` if it adds a tool permission or event type.

## New provider (model or search)

1. Implement `LLMClient`-compatible model factory or `SearchProvider` in
   `core/llm/` or `core/search/`, with a timeout on every network call.
2. Add one entry to `LLM_PROVIDERS` or `SEARCH_PROVIDERS`.
3. New settings (keys, URLs) only in `core/config.ts`; register any key as
   described in `.claude/rules/security.md` (Secrets).
4. Test it through the registry with a fake `fetch`; no real network.
5. Document the variable in the settings table of `docs/ARCHITECTURE.md`.

## New front end (e.g. Telegram)

1. Create `frontends/<name>/`; implement `ModeHost` (emit → messages,
   confirm/choose → buttons, ask → reply). `core/testing.ts` is the minimal host.
2. Build `createCore(new Settings())` once; one session per chat/user.
3. List modes from `modes/index.ts`; do not import mode internals.
4. Without an interactive user, `confirm` must refuse risky actions.
5. Start it from `index.ts` (one new command); tests with a fake transport.
6. Never change a mode to suit a front end; extend `ModeEvent` in core if needed
   and record it in `docs/decisions.md`.
