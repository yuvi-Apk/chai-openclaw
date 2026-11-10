# Environment variables (`process.env`)

**Environment variables** are named settings that live *outside* your code, in the shell or system that starts your program. Your code reads them through `process.env`.

Think of them as **sticky notes on the fridge**. The program reads them when it starts, and you can change the notes without rebuilding the fridge.

## Reading them

```ts
const key = process.env.OPENROUTER_API_KEY || "";
const model = process.env.OPENROUTER_DEFAULT_MODEL || "openrouter/free";
```

- `process.env.NAME` is a `string`, or `undefined` if it isn't set.
- `|| "fallback"` means "if it's missing or empty, use this default instead".

## Setting them

- In a `.env` file in the project folder:
  ```
  OPENROUTER_API_KEY=sk-or-...
  ```
  **Bun loads `.env` automatically**, so there's no need for the `dotenv` package. See [bun-runtime.md](bun-runtime.md).
- Or just for one run, in the shell: `OPENROUTER_API_KEY=... yuvi wakeup` (Bash).

## Why use them

- **Secrets stay out of Git.** `.env` is listed in [.gitignore](gitignore.md).
- **The same code works in different places.** Your laptop and a server can use different settings.

💡 **Tip:** `process.cwd()` is a related idea. It's the folder the program was *started from*, not the folder where the code file lives.

**Used in:** [files/ai/ai.config.ts.md](../files/ai/ai.config.ts.md), [files/modes/agent/tool-executor.ts.md](../files/modes/agent/tool-executor.ts.md), [files/modes/agent/types.ts.md](../files/modes/agent/types.ts.md)
