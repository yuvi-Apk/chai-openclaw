# 🍵 chai-openclaw — Start Here

Welcome! This folder is your **living textbook** for the project. Every doc here matches the code as it is *right now*.

## What is this project?

`chai-openclaw` is a command-line tool (a **CLI**) called **`yuvi`**, written in **TypeScript** and run with **Bun**.

`yuvi` has one command, `wakeup`. It shows a big colourful **YUVI** banner, then asks how you want to talk to it:

- **CLI mode** ✅: a menu in your terminal with **Agent**, **Plan**, **Chat**, **Help**, and **Exit**.
  - **Agent** is an AI helper (through [OpenRouter](concepts/openrouter.md)) that can read your project, search it, and *propose* file changes or shell commands. Proposed changes are **staged**. You then approve them all at once, or review them one by one with a [diff](concepts/unified-diffs.md) preview, and only the approved ones are applied.
  - **Chat** currently echoes your message back, and **Plan** is a placeholder.
- **Telegram mode**: still "coming soon...".

Think of it like a robot being built in stages. It can now wake up, show you a menu, and use a set of careful hands (the agent tools) that ask before touching anything.

## How it works (simple flow)

```
You type:  yuvi wakeup
              │
              ▼
  Shebang (#!/usr/bin/env bun) → Bun runs index.ts
              │
              ▼
  Commander parses "wakeup" → wakeup() (terminal-ui/wakeup.ts)
     banner (figlet + chalk) → pick mode (@clack/prompts)
              │
     ┌────────┴─────────┐
     ▼                  ▼
  "cli"             "telegram" → "coming soon..."
     │
     ▼
  runCliMode() (modes/cli.ts): menu loop
     │  Agent ─────────────────────────────────────────────┐
     │  Chat (echo) · Plan (placeholder) · Help · Exit     │
                                                           ▼
  runAgentMode() (modes/agent/orchestrator.ts)
     1. ask "You:" for a request
     2. build config + ActionTracker + ToolExecutor + tools
     3. ToolLoopAgent (AI SDK + OpenRouter model) thinks & calls tools
          read/list/search/analyze → run now, logged "executed"
          create/modify/delete/folder/shell → STAGED, logged "pending"
     4. print the answer as terminal Markdown (marked-terminal)
     5. runApprovalFlow() (modes/agent/approval.ts)
          "Approve and apply all" · "Review one by one" · "Cancel"
          one by one → per file / shell command: Accept · Show diff · Reject
     6. applyApprovedFromTracker() writes only the approved ones → clearStaging()
```

## How to run it

```bash
bun install              # install dependencies
# create a .env file with your OpenRouter key (Bun loads it automatically):
#   OPENROUTER_API_KEY=sk-or-...
#   OPENROUTER_DEFAULT_MODEL=openrouter/free   # optional
bun run index.ts wakeup  # run the wakeup command directly
bun link                 # (optional) register the `yuvi` command on your machine
yuvi wakeup              # then run it like a real CLI
yuvi --help              # Commander generates help for free
yuvi --version           # prints 0.0.1
```

In menus, use the **arrow keys** and **Enter**. Press **Ctrl+C** or **Esc** to cancel. In a text prompt, typing `exit` also leaves.

## 📂 Map of the docs

### Files (one doc per source file)
- [files/index.ts.md](files/index.ts.md): the entry point. Sets up the `yuvi` program and its `wakeup` command, then routes to the chosen mode.
- [files/terminal-ui/wakeup.ts.md](files/terminal-ui/wakeup.ts.md): the wakeup screen. Gradient ASCII banner plus the CLI/Telegram mode picker.
- [files/terminal-ui/terminal-md.ts.md](files/terminal-ui/terminal-md.ts.md): renders Markdown (like AI replies) as coloured terminal text.
- [files/modes/cli.ts.md](files/modes/cli.ts.md): CLI mode's menu loop (Agent, Plan, Chat, Help, Exit).
- [files/modes/agent/orchestrator.ts.md](files/modes/agent/orchestrator.ts.md): the conductor of agent mode. Asks, builds the agent, runs it, then approves and applies.
- [files/modes/agent/agent-tools.ts.md](files/modes/agent/agent-tools.ts.md): the AI's toolbox. Each tool's description and Zod input schema.
- [files/modes/agent/tool-executor.ts.md](files/modes/agent/tool-executor.ts.md): the real work behind each tool, plus safety guards, staging, and the apply step.
- [files/modes/agent/action-tracker.ts.md](files/modes/agent/action-tracker.ts.md): the action log. Records everything the agent did or wants to do.
- [files/modes/agent/approval.ts.md](files/modes/agent/approval.ts.md): the "are you sure?" step. Approve all, review one by one with diffs, or cancel.
- [files/modes/agent/diff-view.ts.md](files/modes/agent/diff-view.ts.md): helpers that turn staged file actions into one before/after diff per file.
- [files/modes/agent/types.ts.md](files/modes/agent/types.ts.md): shared types (`ActionLog`, `AgentConfig`) and the default agent config.
- [files/ai/ai.config.ts.md](files/ai/ai.config.ts.md): picks the AI model through OpenRouter, using environment variables.
- [files/ai/index.ts.md](files/ai/index.ts.md): barrel file that re-exports `getAgentModel`.
- [files/package.json.md](files/package.json.md): project identity card: name, `bin`, scripts, and dependencies.
- [files/tsconfig.json.md](files/tsconfig.json.md): tells TypeScript how strict to be and which features to allow.
- [files/cspell.json.md](files/cspell.json.md): spell-checker settings and the project's custom word list.
- [files/README.md.md](files/README.md.md): the root README. The project's front page with features, quick start, tools, and configuration.
- [files/.gitignore.md](files/.gitignore.md): files Git should never track (like `node_modules` and `.env`).
- [files/.prettierrc.md](files/.prettierrc.md): Prettier formatting rules (quotes, semicolons, indent).
- [files/.prettierignore.md](files/.prettierignore.md): files Prettier should skip.

### Concepts (reusable ideas)
- [concepts/bun-runtime.md](concepts/bun-runtime.md): what Bun is and why it runs TypeScript directly.
- [concepts/shebang.md](concepts/shebang.md): the `#!` first line that makes a file executable.
- [concepts/commander-cli.md](concepts/commander-cli.md): building CLIs with the `commander` library.
- [concepts/package-json-bin.md](concepts/package-json-bin.md): how `"bin"` turns a file into a terminal command.
- [concepts/es-modules.md](concepts/es-modules.md): `import`/`export` and `"type": "module"`.
- [concepts/barrel-files.md](concepts/barrel-files.md): `index.ts` files that re-export a folder's public pieces.
- [concepts/async-await.md](concepts/async-await.md): Promises, `await`, and top-level await.
- [concepts/typescript-union-types.md](concepts/typescript-union-types.md): `"cli" | "telegram"` types, `| null`, and type narrowing.
- [concepts/typescript-interfaces-and-utility-types.md](concepts/typescript-interfaces-and-utility-types.md): interfaces, `Omit`, `readonly` arrays, and `import type`.
- [concepts/typescript-classes.md](concepts/typescript-classes.md): classes, `private`/`readonly`, parameter properties, and dependency injection.
- [concepts/figlet-ascii-art.md](concepts/figlet-ascii-art.md): turning text into big ASCII-art banners.
- [concepts/chalk-terminal-colors.md](concepts/chalk-terminal-colors.md): colouring terminal output with `chalk`.
- [concepts/clack-prompts.md](concepts/clack-prompts.md): interactive menus and text inputs with `@clack/prompts` (and handling cancel).
- [concepts/marked-terminal.md](concepts/marked-terminal.md): rendering Markdown nicely in the terminal.
- [concepts/ai-sdk-agents.md](concepts/ai-sdk-agents.md): the `ai` package: models, tools, and the `ToolLoopAgent` loop.
- [concepts/zod-schemas.md](concepts/zod-schemas.md): describing and checking data shapes with Zod.
- [concepts/openrouter.md](concepts/openrouter.md): one API key for many AI models.
- [concepts/environment-variables.md](concepts/environment-variables.md): `process.env`, `.env` files, and keeping secrets out of code.
- [concepts/staged-changes-and-approval.md](concepts/staged-changes-and-approval.md): the stage → approve → apply safety pattern for AI agents.
- [concepts/unified-diffs.md](concepts/unified-diffs.md): reading `+`/`-` diffs and making them with the `diff` package.
- [concepts/node-fs-path.md](concepts/node-fs-path.md): files, paths, path-traversal guards, and running shell commands.
- [concepts/cspell.md](concepts/cspell.md): spell-checking code with CSpell.
- [concepts/prettier.md](concepts/prettier.md): automatic code formatting.
- [concepts/gitignore.md](concepts/gitignore.md): how ignore-file patterns work.
