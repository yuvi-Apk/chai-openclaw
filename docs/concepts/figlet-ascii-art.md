# Figlet: big ASCII-art text

**Figlet** turns normal text into giant letters made of characters, like this:

```
██╗   ██╗██╗   ██╗██╗   ██╗██╗
╚██╗ ██╔╝██║   ██║██║   ██║██║
 ╚████╔╝ ██║   ██║██║   ██║██║
  ╚██╔╝  ██║   ██║╚██╗ ██╔╝██║
   ██║   ╚██████╔╝ ╚████╔╝ ██║
   ╚═╝    ╚═════╝   ╚═══╝  ╚═╝
```

It started as an old Unix program from the 1990s. The `figlet` npm package brings it to JavaScript.

## Basic use

```ts
import figlet from "figlet";

const art = figlet.textSync("Hello", { font: "ANSI Shadow" });
console.log(art);
```

- `textSync` returns the art as one string right away. There is also an async `text()` version.
- `font` picks a style. Figlet comes with hundreds of fonts, such as `"Standard"`, `"Slant"`, and `"ANSI Shadow"`.
- The result is one string with `\n` line breaks, so you can `split("\n")` it to style each line.

## Why CLIs use it
A banner makes a tool feel friendly and branded the moment it starts. It's pure decoration, but first impressions matter.

💡 **Tip:** Wide fonts can wrap and look broken in narrow terminal windows. Keep banner text short.

**Used in:** [files/terminal-ui/wakeup.ts.md](../files/terminal-ui/wakeup.ts.md)
