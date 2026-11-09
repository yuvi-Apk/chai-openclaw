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
  "@types/node": "^26.6.6",
  "commander": "^15.1.0",
  "figlet": "^1.12.0",
  "prettier": "^3.9.10"
}
```

**What it does:**
- `devDependencies`: only needed while developing. `@types/bun` teaches TypeScript about Bun's built-in APIs.
- `peerDependencies`: "I expect TypeScript v5 to be available." It isn't bundled.
- `dependencies`: the libraries the app uses:
  - `commander`: parses CLI commands ([concepts/commander-cli.md](../concepts/commander-cli.md)). It is **used now** in index.ts.
  - `@clack/prompts` / `@clack/core`: nice interactive terminal menus and inputs. Ready for the "pick CLI or Telegram" step.
  - `figlet`: turns text into big ASCII-art letters. Ready for the `wakeup` banner.
  - `@types/node`: type info for Node-style APIs like `process.argv`.
  - `prettier`: the code formatter ([concepts/prettier.md](../concepts/prettier.md)).

**Why it's used in general:** Listing dependencies with version ranges lets anyone run `bun install` and get compatible versions.

**Why it's used here:** The project installs tools ahead of time for the features it plans to build: banner, menu, and modes.

💡 **Tip:** `^1.8.1` means "1.8.1 or any newer **1.x** version", but never 2.0. The `^` allows safe minor updates.

---

### 🧠 Key takeaways
- `"type": "module"` turns on `import` and top-level `await`.
- `"bin"` is what turns `index.ts` into the `yuvi` command.
- `dependencies` are needed at runtime; `devDependencies` are only for development.
- `figlet` and `@clack/prompts` are installed for upcoming features.
