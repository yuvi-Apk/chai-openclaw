# TypeScript union and literal types

In TypeScript, a type can be an exact value instead of a broad one like `string`. Joining a few of those with `|` (read it as "or") makes a **union of literal types**:

```ts
type Mode = "cli" | "telegram";

let m: Mode = "cli";       // ✅
m = "telegram";            // ✅
m = "telegrm";             // ❌ error: typo caught before you run anything
```

It's like a light switch with exactly two positions. You can't set it to "banana".

## Adding "or nothing"

```ts
function pick(): Mode | null { ... }
```

`Mode | null` means "a mode, or nothing". This is a clear way to say an action can end without an answer, for example when the user cancels.

## Narrowing

TypeScript follows your `if` checks and narrows the type:

```ts
const mode = await pick();     // Mode | null
if (!mode) return;             // handle null
mode;                          // now TypeScript knows: Mode
if (mode === "cli") { ... }    // here: exactly "cli"
```

## Why it's used
- It catches typos at compile time.
- Your editor autocompletes the allowed values.
- It documents the choices right in the code.

**Used in:** [files/terminal-ui/wakeup.ts.md](../files/terminal-ui/wakeup.ts.md), [files/index.ts.md](../files/index.ts.md)
