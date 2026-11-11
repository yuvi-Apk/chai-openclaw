# Architecture decisions

Rule: any architectural change (new layer, contract change, new pattern,
new tool permission or event type, new dependency) appends an entry here.
Newest at the bottom. Format: date, decision, reason. Never rewrite old
entries; add a new one that replaces them.

**D1 · 2026-11 · Three layers: `frontends` → `modes` → `core`.**
Agent and Chat were built separately and tangled with the terminal. Inward-only
imports, checked by `core/__tests__/architecture.test.ts`, keep them apart.

**D2 · 2026-11 · One mode contract in `core/mode.ts`.**
`Mode` / `ModeSession` / `ModeHost` / `ModeEvent` let any front end (terminal,
later Telegram) run any mode unchanged.

**D3 · 2026-11 · Modes emit events and ask through the host; they never print.**
Screen code inside agent logic blocked other front ends and tests without a TTY.

**D4 · 2026-11 · Registries for modes and providers.**
`modes/index.ts`, `LLM_PROVIDERS`, `SEARCH_PROVIDERS`: adding a variant is one
folder plus one line, no edits to existing code.

**D5 · 2026-11 · `Settings` object is the only reader of env and `~/.yuvi/settings.json`.**
`process.env` was used as a mutable global store in 9 files. Precedence:
saved this run > env > settings file > default.

**D6 · 2026-11 · `createCore()` is the single composition root, with lazy getters.**
One place chooses providers; tests pass fakes through its overrides.

**D7 · 2026-11 · Explicit tool permissions per mode (`grantTools`).**
Chat gets `web.search` and `web.fetch` only; the agent's file and shell actions
also need `host.confirm`. Least privilege by declaration.

**D8 · 2026-11 · One error family (`YuviError` + `classifyError`) in core; wording in the front end.**
Replaced plain `Error` plus text matching; each front end can word errors its own way.

**D9 · 2026-11 · API keys removed from shell command environments; secrets redacted everywhere.**
Commands the agent runs had access to `OPENROUTER_API_KEY` and `TAVILY_API_KEY`.

**D10 · 2026-11 · Web pages, files and command output are untrusted data.**
Wrapped with `wrapUntrusted` and covered by a system-prompt rule, against prompt injection.

**D11 · 2026-11 · Opt-in JSONL usage log (`YUVI_LOG=1`), metadata only.**
Usage tracking without storing message text or secrets.

**D12 · 2026-11 · Echo mode kept as a hidden example (`YUVI_DEV=1`).**
Proves "one folder + one line" and serves as the template for new modes.

**D13 · 2026-11 · No formatter hook; type-check is the lint.**
Prettier config (2 spaces) does not match the code (4 spaces); adding a linter
needs a new dependency. Revisit together with a one-time reformat.

**D14 · 2026-11 · The user makes all commits.**
Claude never runs `git commit` or `git push` in this repo.
