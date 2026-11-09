# Chalk: colouring terminal text

Terminals can show colours using hidden **ANSI escape codes**. These are special character sequences like `\x1b[36m`, which means "switch to cyan". Writing them by hand is ugly and easy to get wrong. **Chalk** writes them for you.

## Basic use

```ts
import chalk from "chalk";

console.log(chalk.green("Success!"));
console.log(chalk.bgCyan.black(" label "));   // chain styles
const paint = chalk.magenta;                  // a style is a function you can store
console.log(paint("hello"));
```

- Each style (`red`, `cyanBright`, `bold`, `bgBlue`, and so on) is a **function** that wraps text in the right codes.
- You can **chain** styles: `chalk.bold.underline.red(...)`.
- Since styles are just functions, you can keep them in an array and pick one later. That's how the banner gradient works in this project.

## Why it's used
Colour helps users scan output: green for success, red for errors, grey for hints. Almost every modern Node and Bun CLI uses chalk or something similar.

💡 **Tip:** Chalk v5 and newer is **ESM-only**, so you must use `import`, not `require`. That's fine here because the project uses [ES modules](es-modules.md). Chalk also turns colours off automatically when output isn't a real terminal, for example when it's piped to a file.

**Used in:** [files/terminal-ui/wakeup.ts.md](../files/terminal-ui/wakeup.ts.md)
