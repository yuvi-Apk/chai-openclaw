# Commander: building CLIs

## What is it?
[`commander`](https://github.com/tj/commander.js) is the most popular library for building command-line tools in JavaScript/TypeScript. You describe your commands, and it handles reading what the user typed.

Think of it as a **receptionist**: it listens to what you ask for (`yuvi wakeup`) and sends you to the right room, which is your `.action()` function.

## The basic pattern
```ts
import { Command } from "commander";

const program = new Command();

program.name("mytool").description("What it does").version("1.0.0");

program
  .command("greet <name>")          // sub-command with a required argument
  .option("-l, --loud", "shout it") // an optional flag
  .action((name, options) => {
    const msg = `Hello, ${name}`;
    console.log(options.loud ? msg.toUpperCase() : msg);
  });

await program.parseAsync(process.argv);
```

## What you get for free
- `--help` / `-h`: auto-generated help text from your descriptions.
- `--version` / `-V`: available if you call `.version()`.
- Error messages for unknown commands or missing arguments.

## Key pieces
| Piece | Meaning |
|---|---|
| `.command("x")` | adds a sub-command, as in `tool x` |
| `.argument("<a>")` / `<a>` in the name | a required value (`[a]` makes it optional) |
| `.option("-f, --flag")` | an optional flag |
| `.action(fn)` | the code that runs for that command |
| `.parse()` / `.parseAsync()` | reads `process.argv` and runs the matching action |

Use `parseAsync` when any action is `async`. See [async-await.md](async-await.md).

## In this project
[index.ts](../files/index.ts.md) creates the `yuvi` program and a `wakeup` command, then calls `parseAsync(process.argv)`.
