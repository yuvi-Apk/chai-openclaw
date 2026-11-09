# 🍵 chai-openclaw — Start Here

Welcome! This folder is your **living textbook** for the project. Every doc here matches the code as it is *right now*.

## What is this project?

`chai-openclaw` is a small command-line tool (a **CLI**) called **`yuvi`**, written in **TypeScript** and run with **Bun**.

Right now `yuvi` has one command, `wakeup`. It shows a big colourful **YUVI** banner, then asks you how you want to talk to it:

- **CLI mode**: chat with `yuvi` in your terminal
- **Telegram mode**: talk to `yuvi` through a Telegram bot

Both modes print "coming soon..." for now. Think of it like a robot being built in stages. It can now open its eyes, light up its face, and ask you a question.

## How it works (simple flow)

```
You type:  yuvi wakeup
              │
              ▼
  Shebang (#!/usr/bin/env bun) tells the OS: "run this with Bun"
              │
              ▼
  index.ts builds a Commander "program" (name, description, version)
              │
              ▼
  program.parseAsync(process.argv) reads what you typed
              │
              ▼
  Finds "wakeup" → its async .action() calls wakeup() from terminal-ui/wakeup.ts
              │
              ▼
  showBanner(): figlet draws "YUVI", chalk paints a cyan→magenta gradient
              │
              ▼
  pickMode(): @clack/prompts menu → "cli" | "telegram" (or null if cancelled)
              │
              ▼
  Back in index.ts: cancelled → exit quietly; otherwise "… mode coming soon..."
```

## How to run it

```bash
bun install            # install dependencies
bun run index.ts wakeup  # run the wakeup command directly
bun link               # (optional) register the `yuvi` command on your machine
yuvi wakeup            # then run it like a real CLI
yuvi --help            # Commander generates help for free
yuvi --version         # prints 0.0.1
```

In the menu, use the **arrow keys** and **Enter** to choose. Press **Ctrl+C** or **Esc** to cancel.

## 📂 Map of the docs

### Files (one doc per source file)
- [files/index.ts.md](files/index.ts.md): the entry point. Sets up the `yuvi` program and its `wakeup` command, then routes to the chosen mode.
- [files/terminal-ui/wakeup.ts.md](files/terminal-ui/wakeup.ts.md): the wakeup screen. Gradient ASCII banner plus the CLI/Telegram mode picker.
- [files/package.json.md](files/package.json.md): project identity card: name, `bin`, scripts, and dependencies.
- [files/tsconfig.json.md](files/tsconfig.json.md): tells TypeScript how strict to be and which features to allow.
- [files/cspell.json.md](files/cspell.json.md): spell-checker settings and the project's custom word list.
- [files/README.md.md](files/README.md.md): the short root README created by `bun init`.
- [files/.gitignore.md](files/.gitignore.md): files Git should never track (like `node_modules` and `.env`).
- [files/.prettierrc.md](files/.prettierrc.md): Prettier formatting rules (quotes, semicolons, indent).
- [files/.prettierignore.md](files/.prettierignore.md): files Prettier should skip.

### Concepts (reusable ideas)
- [concepts/bun-runtime.md](concepts/bun-runtime.md): what Bun is and why it runs TypeScript directly.
- [concepts/shebang.md](concepts/shebang.md): the `#!` first line that makes a file executable.
- [concepts/commander-cli.md](concepts/commander-cli.md): building CLIs with the `commander` library.
- [concepts/package-json-bin.md](concepts/package-json-bin.md): how `"bin"` turns a file into a terminal command.
- [concepts/es-modules.md](concepts/es-modules.md): `import`/`export` and `"type": "module"`.
- [concepts/async-await.md](concepts/async-await.md): Promises, `await`, and top-level await.
- [concepts/typescript-union-types.md](concepts/typescript-union-types.md): `"cli" | "telegram"` types, `| null`, and type narrowing.
- [concepts/figlet-ascii-art.md](concepts/figlet-ascii-art.md): turning text into big ASCII-art banners.
- [concepts/chalk-terminal-colors.md](concepts/chalk-terminal-colors.md): colouring terminal output with `chalk`.
- [concepts/clack-prompts.md](concepts/clack-prompts.md): interactive menus with `@clack/prompts` (and handling cancel).
- [concepts/cspell.md](concepts/cspell.md): spell-checking code with CSpell.
- [concepts/prettier.md](concepts/prettier.md): automatic code formatting.
- [concepts/gitignore.md](concepts/gitignore.md): how ignore-file patterns work.
