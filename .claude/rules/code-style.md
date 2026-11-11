---
paths:
  - "**/*.ts"
---

# Code style

## Naming

- Files: kebab-case (`page-fetcher.ts`, `session-loop.ts`).
- Types, classes, interfaces: PascalCase, no `I` prefix (`SearchProvider`).
- Functions and variables: camelCase, verbs for functions (`loadChatConfig`).
- Constants: UPPER_SNAKE_CASE with units in the name (`FETCH_TIMEOUT_MS`, `MAX_PAGE_CHARS`).
- No magic numbers or strings in logic; name them at the top of the file.

## Size

- File: aim under 300 lines, hard limit 400. Split by responsibility, not by line count.
- Function: aim under 30 lines, hard limit 50. Extract named helpers.
- Known oversize files (`modes/agent/tool-executor.ts`, `brain.ts`) must not grow;
  new logic for them goes into a new module.

## Formatting

- 4-space indent, double quotes, semicolons, trailing commas in multi-line lists.
- Prettier is not run automatically; match the surrounding code.

## Comments

- Short, plain-English comments that say why, not what.
- A one-line doc comment on each exported function, class and interface.

## Types

- Strict TS with `noUncheckedIndexedAccess`; handle `undefined` from index access.
- No `any`; use `unknown` and narrow. No non-null `!` unless the reason is obvious.
- Validate external data (env, JSON files, model tool input, HTTP) at the boundary,
  with zod where a schema helps; types inside are trusted after that.
- `import type` for type-only imports (`verbatimModuleSyntax` is on).

## Errors

- Throw from the `core/errors.ts` family (`YuviError`, `ConfigError`, `BudgetError`,
  `RateLimitError`, `ToolError`); add a subclass there if needed.
- Modes emit `{ type: "error" }` with raw text; front ends word it (`frontends/terminal/errors.ts`).
- Never swallow an error silently; a deliberate ignore gets a comment.

## Logging

- Only through the `Logger` from `host.core.log` (`core/log.ts`); no `console.*` in
  `core/` or `modes/`.
- Log metadata (step, model, tokens, ms), never message text or secrets.

## Dependencies

- Ask before adding one. Pin the exact version (no `^`, no `latest`).
