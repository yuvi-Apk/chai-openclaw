---
paths:
  - "**/*.ts"
---

# SOLID and patterns

## SOLID, one rule each

- **S - one reason to change per module.** Example: the shell runner lives in
  `modes/agent/executor/shell.ts`, apart from file tools. `tool-executor.ts` still
  mixes paths, staging and search: split further rather than add to it.
- **O - extend by adding, not editing.** A new mode or provider is a new folder
  plus one line in `modes/index.ts`, `LLM_PROVIDERS` or `SEARCH_PROVIDERS`.
- **L - any implementation must work wherever its interface is used.** Example:
  `FakeLLM` (`core/testing.ts`) replaces `AiSdkLLMClient` in every test. Do not
  check concrete types or add methods callers need outside the interface.
- **I - small interfaces, optional extras.** `ModeSession` has optional
  `steer?`, `cycle?`, `files?`; a mode implements only what it uses. Split an
  interface before forcing empty methods on implementers.
- **D - depend on abstractions, inject them.** `createCore(settings, overrides)`
  builds `LLMClient`, `SearchProvider`, `PageFetcher`; modes receive them via
  `ModeHost`. Never `new` a provider inside a mode.

## Patterns already in use

| Pattern | Where | Use it when |
|---|---|---|
| Registry | `ModeRegistry`, `LLM_PROVIDERS`, `SEARCH_PROVIDERS` | adding a selectable variant |
| Composition root | `core/compose.ts` (`createCore`, lazy getters) | wiring services; nowhere else |
| Adapter behind interface | `core/llm/ai-sdk-client.ts`, `core/search/duckduckgo.ts`, `tavily.ts` | wrapping any external service |
| Host / port | `ModeHost` (emit, confirm, choose, ask) | a mode needs the user or the screen |
| Event stream + renderer | `ModeEvent` → `frontends/terminal/renderer.ts` | showing progress or output |
| Pipeline of stages | `modes/chat/pipeline.ts`, `modes/chat/stages/` | multi-step request processing |
| Factory | `createChatEngine`, `agentMode("ask" \| "plan")` | one implementation, several configs |
| Error family | `core/errors.ts` (`YuviError` + `classifyError`) | any failure a caller may handle |
| Test doubles | `core/testing.ts` | every test that needs a model or host |

## Rules

- No new pattern, framework or abstraction layer without a written reason in the
  plan and an entry in `docs/decisions.md`.
- No interface with a single implementation unless it is a boundary to an
  external service or needed for a test fake.
- DRY: before writing a helper, search `core/` (`format.ts`, `security/limits.ts`,
  `usage.ts`, `errors.ts`) for one that exists.
- No DI container, plug-in loader or global event bus.
