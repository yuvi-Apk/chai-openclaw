# tsconfig.json

**Purpose:** It tells TypeScript **how to check your code**: which JavaScript features exist, how imports are resolved, and how strict to be.

**Where it fits:** Your editor and `tsc` read it when they check [index.ts](index.ts.md). [Bun](../concepts/bun-runtime.md) runs the `.ts` files directly, so this file is about **type checking**, not about building output.

---

### Environment and features

```json
"lib": ["ESNext"],
"target": "ESNext",
"module": "Preserve",
"moduleDetection": "force",
"jsx": "react-jsx",
"allowJs": true,
"types": ["bun"],
```

**What it does:**
- `lib` / `target: ESNext`: allow the newest JavaScript features.
- `module: Preserve`: keep `import`/`export` exactly as written, because Bun handles them.
- `moduleDetection: force`: treat every file as a module. This is what lets top-level `await` work.
- `jsx`: settings for JSX/React syntax. It isn't used yet, but it's a default from `bun init`.
- `allowJs`: `.js` files are allowed too.
- `types: ["bun"]`: load Bun's type definitions from `@types/bun`.

**Why it's used in general:** These options decide what code TypeScript accepts as valid.

**Why it's used here:** It matches Bun's modern setup, so `await program.parseAsync(...)` at the top of [index.ts](index.ts.md) type-checks cleanly. See [concepts/es-modules.md](../concepts/es-modules.md).

---

### Bundler mode

```json
"moduleResolution": "bundler",
"allowImportingTsExtensions": true,
"verbatimModuleSyntax": true,
"noEmit": true,
```

**What it does:**
- `moduleResolution: bundler`: find imports the way modern tools like Bun and Vite do.
- `allowImportingTsExtensions`: you may write `import x from "./file.ts"`.
- `verbatimModuleSyntax`: type-only imports must say `import type`, so nothing gets removed by surprise.
- `noEmit`: TypeScript only **checks**. It never writes `.js` files.

**Why it's used in general:** When a runtime or bundler runs your TS, the compiler is only a checker.

**Why it's used here:** Bun runs `index.ts` directly, so there's no build step and no `dist` folder.

---

### Strictness

```json
"strict": true,
"skipLibCheck": true,
"noFallthroughCasesInSwitch": true,
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"noUnusedLocals": false,
"noUnusedParameters": false,
"noPropertyAccessFromIndexSignature": false
```

**What it does:**
- `strict`: turns on all the main safety checks, such as no implicit `any` and null checks.
- `skipLibCheck`: don't type-check code inside `node_modules`. This is faster.
- `noFallthroughCasesInSwitch`: each `case` must `break` or `return`.
- `noUncheckedIndexedAccess`: `arr[0]` has the type `T | undefined`, because the item might not exist.
- `noImplicitOverride`: you must write `override` when replacing a parent class method.
- The three `false` flags are extra-strict rules that are left off.

**Why it's used in general:** Strict settings catch bugs while you type instead of when the program runs.

**Why it's used here:** It's a safety net while the project grows. Picture it as a spell-checker for logic.

💡 **Tip:** With `noUncheckedIndexedAccess`, something like `process.argv[2]` is `string | undefined`. Check it before you use it.

---

### 🧠 Key takeaways
- This file is about **checking** code. Bun does the running.
- `noEmit: true` means no compiled output is produced.
- `moduleDetection: force` plus ESNext allows top-level `await`.
- `strict` mode catches mistakes early.
