# Raw mode and ANSI escape codes

Two ideas let a program build its own terminal interface: reading **every single key** (raw mode), and telling the terminal **where to draw** (ANSI escape codes).

## Raw mode: reading keys one at a time

Normally the terminal works in **line mode**. It collects what you type, lets you edit it with Backspace, and only hands the whole line to the program when you press Enter. It also handles Ctrl+C itself and stops the program.

In **raw mode** the terminal steps aside. Every key press goes straight to your program, and nothing is shown unless your program writes it.

```ts
process.stdin.setRawMode(true);   // every key comes to us
process.stdin.resume();           // start the flow
process.stdin.on("data", (chunk) => {
    const key = chunk.toString("utf8");
    // decide what this key means
});
```

An analogy: line mode is posting a letter (the post office delivers it when it is complete). Raw mode is a phone call (you hear every sound as it happens).

### What keys look like

Letters arrive as themselves. Special keys arrive as control characters or short sequences:

| Key | What arrives |
|---|---|
| Enter | `\r` |
| Backspace | `\u007f` (sometimes `\b`) |
| Ctrl+C | `\u0003` |
| Ctrl+D | `\u0004` |
| Ctrl+U | `\u0015` |
| Ctrl+W | `\u0017` |
| Esc | `\u001b` |
| Up / Down arrow | `\u001b[A` / `\u001b[B` |
| Shift+Tab | `\u001b[Z` |

Notice that arrows and Shift+Tab **start with the Esc character**. That is why code checks for the exact sequences first and for a lone `\u001b` after.

💡 **Tip:** In raw mode, Ctrl+C no longer stops your program. It is just a character. You must handle it yourself, and you must always switch raw mode off again (`setRawMode(false)`) when you are done.

💡 **Tip:** Raw mode only exists on a real terminal. Check `process.stdin.isTTY` first. If input is piped from a file or another program, it is `false`.

## ANSI escape codes: commands for the terminal

An escape code is a small string that begins with the Esc character (`\x1b`, the same as `\u001b`) followed by `[`. The terminal does not print it. It **obeys** it.

| Code | Meaning |
|---|---|
| `\r` | go to the start of the current line (not an escape code, but used alongside them) |
| `\x1b[2K` | erase the whole current line |
| `\x1b[J` | erase from the cursor to the end of the screen |
| `\x1b[3A` | move the cursor **up** 3 lines |
| `\x1b[3B` | move the cursor **down** 3 lines |
| `\x1b[3C` | move the cursor **right** 3 columns |

The number can be anything. `A`, `B`, `C` choose the direction.

The classic "redraw this line" recipe:

```ts
process.stdout.write("\r\x1b[2K" + newText);
```

Go to the start of the line, erase it, write the new content. Do this many times a second and you have a spinner or a progress bar.

Colours work the same way. Libraries like [chalk](chalk-terminal-colors.md) just wrap your text in colour escape codes for you.

## Where this project uses it

- [modes/agent/input.ts](../files/modes/agent/input.ts.md): the message box. Raw mode gives it Shift+Tab, history with Up / Down, and an instant `/` menu. Escape codes redraw only the input line or the hint bar.
- [modes/agent/ui.ts](../files/modes/agent/ui.ts.md): the spinner line that is erased and redrawn, and the key listener that lets you press Esc or type a correction while the agent works.

## 🧠 Key takeaways
- Raw mode delivers every key to your program at once; your program gives each key its meaning.
- Special keys arrive as control characters or sequences starting with Esc.
- ANSI escape codes move the cursor and erase text, so you can redraw parts of the screen in place.
- Always turn raw mode off again, and fall back to a simple prompt when there is no TTY.
