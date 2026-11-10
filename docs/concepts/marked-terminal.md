# Rendering Markdown in the terminal (`marked` + `marked-terminal`)

AI models usually answer in **Markdown**: `**bold**`, `# headings`, bullet lists, and code blocks. In a browser that looks lovely. In a terminal, you'd see the raw `**` and `#` symbols.

Two packages fix that:

- **`marked`**: a Markdown *parser*. It reads Markdown text and turns it into some output (HTML by default).
- **`marked-terminal`**: a *renderer* plug-in for `marked`. It swaps the HTML output for **ANSI-coloured terminal text**: bold stays bold, headings get colour, and code blocks get highlighted.

Think of `marked` as a translator, and `marked-terminal` as telling the translator "speak *terminal*, not *HTML*".

```ts
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal({ width: 80, reflowText: true }));

const pretty = marked.parse("# Hi\n\nThis is **bold**.", { async: false }) as string;
console.log(pretty);
```

- `marked.use(...)`: installs the plug-in. It changes `marked` globally, so do it **once**.
- `width` / `reflowText`: wrap long lines to fit the terminal.
- `{ async: false }`: asks `marked` for a plain string right away, instead of a Promise.

💡 **Tip:** `process.stdout.columns` tells you how wide the user's terminal is. It can be `undefined` when output isn't going to a real terminal (for example, when piped to a file), so always give it a fallback, like `?? 80`.

See also: [chalk-terminal-colors.md](chalk-terminal-colors.md) for what ANSI colours are.

**Used in:** [files/terminal-ui/terminal-md.ts.md](../files/terminal-ui/terminal-md.ts.md)
