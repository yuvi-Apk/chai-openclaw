# package.json `"bin"`

## What is it?
The `"bin"` field in package.json maps a **command name** to a **file**. When the package is installed or linked, that command becomes available in your terminal.

```json
"bin": {
  "yuvi": "./index.ts"
}
```

This says: "create a command `yuvi` that runs `./index.ts`."

## How it becomes a real command
1. You run `bun link` (or `npm link`, or install the package globally).
2. The package manager creates a small launcher file named `yuvi` in a folder on your `PATH`.
3. When you type `yuvi`, the launcher runs `index.ts`, using the [shebang](shebang.md) to know it needs [Bun](bun-runtime.md).

## Examples you already know
`tsc`, `prettier`, `vite`, and `eslint` are all just `bin` entries in their packages.

## 💡 Tips
- The target file needs a shebang, or the OS won't know how to run it.
- After you change `bin`, run `bun link` again.

## In this project
[package.json](../files/package.json.md) maps `yuvi` to [index.ts](../files/index.ts.md).
