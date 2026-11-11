---
description: Scan the codebase for architecture violations, ranked by severity.
---

Check the rules in `.claude/rules/architecture.md` and `code-style.md`. Change nothing.

1. Run `bun test core/__tests__/architecture.test.ts`.
2. Search (Grep tool, `.ts` files, skip `__tests__`):
   - `process.env` outside `core/config.ts`
   - in `modes/`: imports of `frontends/`, of another mode, of `chalk` or
     `@clack/prompts`, and any `console.`
   - in `core/`: imports of `modes/` or `frontends/`
   - module-level `let` (shared mutable state)
   - `new AiSdkLLMClient`, `new DuckDuckGo`, `new Tavily` outside `core/compose.ts`
     and `core/search/providers.ts`
   - `: any` and `as any`
3. Sizes: files over 400 lines, functions over 50 lines (`wc -l`, then read
   only the suspicious parts).

Report a table ranked **Critical** (layer or security break), **Important**
(SOLID, global state, oversize), **Minor**, with `file:line` and a one-line fix.
End with counts per severity.
