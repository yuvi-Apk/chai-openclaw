# Bun runtime

## What is it?
**Bun** is a JavaScript/TypeScript **runtime**: the engine that actually runs your code outside a browser. It's an alternative to Node.js.

Think of it as an all-in-one kitchen appliance. It runs code, installs packages (`bun install`), runs scripts (`bun run`), runs tests, and bundles code.

## Why people use it
- **Runs TypeScript directly.** There's no `tsc` build step, so `bun index.ts` just works.
- **Fast.** It starts quickly and installs packages quickly.
- **Node-compatible.** Most npm packages, like `commander`, work as they are.

## Handy commands
```bash
bun install          # install dependencies from package.json
bun run index.ts     # run a file
bun run explain      # run a script from package.json
bun link             # make package.json "bin" commands available globally
bunx prettier .      # run a package's CLI without installing it globally
```

## In this project
- `yuvi` runs on Bun, thanks to the [shebang](shebang.md) `#!/usr/bin/env bun` in [index.ts](../files/index.ts.md).
- [tsconfig.json](../files/tsconfig.json.md) has `noEmit: true` because Bun runs the `.ts` files itself.
