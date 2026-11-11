---
paths:
  - "core/**"
  - "modes/**"
  - "frontends/**"
  - "index.ts"
---

# Architecture

Human overview with diagrams: `docs/ARCHITECTURE.md`. This file is the rule set.

## Layers and allowed imports

| Layer | Role | May import |
|---|---|---|
| `index.ts` | starts a front end | `frontends/*`, `modes/index.ts`, `core/` |
| `frontends/<name>/` | transport: input, output, questions | `core/`, `modes/index.ts`, own folder |
| `modes/index.ts` | registry | each `modes/<name>/mode.ts`, `core/` |
| `modes/<name>/` | business logic of one mode | `core/`, own folder |
| `core/` | contracts, shared services, adapters | `core/` only |

`core/__tests__/architecture.test.ts` enforces this. Never add an exception to it;
fix the import instead.

## Boundaries

- `core/mode.ts` is the only contract between modes and front ends
  (`Mode`, `ModeSession`, `ModeHost`, `ModeEvent`, `ModeCommand`).
- A front end never decides task logic; a mode never knows which front end runs it.
- Only `core/config.ts` reads the environment or `~/.yuvi/settings.json`.
- Only `core/compose.ts` (`createCore`) picks and builds providers. Modes get
  services from `host.core`.
- Files inside `modes/<name>/` other than `mode.ts` are private to that mode.
- External services (model, search, pages) sit behind interfaces in `core/llm/types.ts`
  and `core/search/types.ts`. New services follow the same shape.

## Tool permissions

- A mode declares `tools: ToolPermission[]`; `grantTools` refuses anything else.
- Chat: `web.search`, `web.fetch` only. Agent: `fs.read`, `fs.write`, `shell`.
  Plan: read-only. Never widen a mode's tools as a side effect of another change.

## Coupling

- One mode or provider must be removable by deleting its folder and its registry line.
- No shared state between sessions: everything per session is built in `createSession`.
- Shared code moves to `core/` only when two or more modes need it.

## When a change does not fit

If a request needs a lower layer to import a higher one, a mode to reach
another mode, or a new global, stop and explain the conflict and options
before writing code. Record the agreed outcome in `docs/decisions.md`.
