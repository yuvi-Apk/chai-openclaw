# package.json

**Purpose:** The project's **identity card**. It says what the project is called, how to run it, which command it installs (`yuvi`), and which libraries it needs.

**Where it fits:** `bun install` reads this file to download dependencies into `node_modules`. Its `"bin"` points at [index.ts](index.ts.md). TypeScript settings live separately in [tsconfig.json](tsconfig.json.md).

---

### Identity and module type

```json
"name": "chai-openclaw",
"module": "index.ts",
"type": "module",
"private": true,
```

**What it does:**
- `name`: the package name.
- `module`: the main entry file. Bun uses it as a hint.
- `type: "module"`: treat `.js`/`.ts` files as **ES Modules**, so `import` works and top-level `await` is allowed.
- `private: true`: a safety lock that blocks accidental publishing to npm.

**Why it's used in general:** Every JS/TS project has a package.json. `"type": "module"` is the modern default. See [concepts/es-modules.md](../concepts/es-modules.md).

**Why it's used here:** [index.ts](index.ts.md) uses `import` and a top-level `await program.parseAsync(...)`. Both need ES Module mode.

---

### Scripts

```json
"scripts": {
  "explain": "bash scripts/explain-staged.sh"
},
```

**What it does:** `bun run explain` runs the given shell command.

**Why it's used in general:** `scripts` are named shortcuts for long commands, such as `test`, `build`, or `dev`.

**Why it's used here:** This one runs the Code Buddy tooling that keeps these docs up to date. It's helper tooling, not part of `yuvi` itself.

---

### `bin`: the `yuvi` command

```json
"bin": {
  "yuvi": "./index.ts"
},
```

**What it does:** It says "when this package is linked or installed, create a terminal command called `yuvi` that runs `./index.ts`."

**Why it's used in general:** This is how tools like `prettier`, `tsc`, or `vite` become commands you can type. See [concepts/package-json-bin.md](../concepts/package-json-bin.md).

**Why it's used here:** It makes `yuvi wakeup` work from anywhere after `bun link`. It works together with the [shebang](../concepts/shebang.md) in index.ts.

---

### Dependencies

```json
"devDependencies": { "@types/bun": "latest" },
"peerDependencies": { "typescript": "^5" },
"dependencies": {
  "@clack/core": "^1.5.1",
  "@clack/prompts": "^1.8.1",
  "@openrouter/ai-sdk-provider": "^3.1.0",
  "@types/node": "^26.6.6",
  "ai": "^7.0.166",
  "chalk": "^6.0.1",
  "commander": "^15.1.0",
  "figlet": "^1.12.0",
  "marked": "^18.2.0",
  "marked-terminal": "^8.0.0",
  "prettier": "^3.9.10"
}
```

**What it does:**
- `devDependencies`: only needed while developing. `@types/bun` teaches TypeScript about Bun's built-in APIs.
- `peerDependencies`: "I expect TypeScript v5 to be available." It isn't bundled.
- `dependencies`: the libraries the app uses:
  - `commander`: parses CLI commands ([concepts/commander-cli.md](../concepts/commander-cli.md)). It is **used now** in index.ts.
  - `@clack/prompts` / `@clack/core`: nice interactive terminal menus. They power the "pick CLI or Telegram" menu ([concepts/clack-prompts.md](../concepts/clack-prompts.md)).
  - `figlet`: turns text into big ASCII-art letters for the `wakeup` banner ([concepts/figlet-ascii-art.md](../concepts/figlet-ascii-art.md)).
  - `chalk`: adds colours to terminal text, like the banner gradient and green/grey messages ([concepts/chalk-terminal-colors.md](../concepts/chalk-terminal-colors.md)).
  - `ai`: the AI SDK. It provides tools, models, and the `ToolLoopAgent` that runs agent mode ([concepts/ai-sdk-agents.md](../concepts/ai-sdk-agents.md)).
  - `@openrouter/ai-sdk-provider`: connects the AI SDK to [OpenRouter](../concepts/openrouter.md), the service that supplies the AI model.
  - `marked` + `marked-terminal`: turn the AI's Markdown replies into coloured terminal text ([concepts/marked-terminal.md](../concepts/marked-terminal.md)).
  - `@types/node`: type info for Node-style APIs like `process.argv`, `fs`, and `path`.
  - `prettier`: the code formatter ([concepts/prettier.md](../concepts/prettier.md)).

**Why it's used in general:** Listing dependencies with version ranges lets anyone run `bun install` and get compatible versions.

**Why it's used here:** `commander` runs the CLI in [index.ts](index.ts.md). `figlet`, `chalk`, and `@clack/prompts` together build the wakeup screen in [terminal-ui/wakeup.ts](terminal-ui/wakeup.ts.md) and the menus in [modes/cli.ts](modes/cli.ts.md). `ai` and `@openrouter/ai-sdk-provider` power agent mode in [modes/agent/orchestrator.ts](modes/agent/orchestrator.ts.md), and `marked` + `marked-terminal` print its answers in [terminal-ui/terminal-md.ts](terminal-ui/terminal-md.ts.md).

💡 **Tip:** `^1.8.1` means "1.8.1 or any newer **1.x** version", but never 2.0. The `^` allows safe minor updates.

💡 **Tip:** [agent-tools.ts](modes/agent/agent-tools.ts.md) imports `zod`, but zod isn't listed here. It's installed because `ai` needs it (zod is one of `ai`'s *peer dependencies*). Listing a package you import directly in your own `dependencies` makes that relationship explicit: `bun add zod`.

---

### 🧠 Key takeaways
- `"type": "module"` turns on `import` and top-level `await`.
- `"bin"` is what turns `index.ts` into the `yuvi` command.
- `dependencies` are needed at runtime; `devDependencies` are only for development.
- `figlet` (letters), `chalk` (colours), and `@clack/prompts` (menu) work as a team to build the wakeup screen.
- `ai` + `@openrouter/ai-sdk-provider` give `yuvi` its AI brain, and `marked` + `marked-terminal` make its replies look nice.
