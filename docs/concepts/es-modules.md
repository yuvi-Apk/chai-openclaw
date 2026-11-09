# ES Modules (`import` / `export`)

## What is it?
**ES Modules (ESM)** are the official JavaScript way to split code into files and share it.

```ts
// math.ts
export function add(a: number, b: number) { return a + b; }

// index.ts
import { add } from "./math.ts";
```

The older style, **CommonJS**, used `require()` and `module.exports`. You'll still see it in older code.

## How a project opts in
In package.json:
```json
"type": "module"
```
Now `.js`/`.ts` files are treated as ES Modules.

## Superpowers you get
- Clean `import { thing } from "package"` syntax.
- **Top-level `await`**: you can use `await` outside any function. See [async-await.md](async-await.md).
- Tools can analyse imports and remove unused code ("tree-shaking").

## In this project
- [package.json](../files/package.json.md) sets `"type": "module"`.
- [tsconfig.json](../files/tsconfig.json.md) uses `moduleDetection: "force"` and `module: "Preserve"`.
- [index.ts](../files/index.ts.md) uses `import { Command } from "commander"` and a top-level `await`.
