# async / await (and top-level await)

## The idea
Some work takes time: reading files, asking the user a question, or calling the Telegram API. JavaScript doesn't stop and wait. It hands you a **Promise**, an "I owe you" for a future result.

`await` means: "pause *here* until this Promise is ready, then continue."

Think of a restaurant buzzer. You order (start the task), get a buzzer (the Promise), and `await` is you waiting for it to buzz.

## Basic example
```ts
async function getName(): Promise<string> {
  return "yuvi";
}

async function main() {
  const name = await getName(); // waits for the Promise
  console.log(name);
}
```

- `async` marks a function that returns a Promise.
- `await` can only be used inside `async` functions, **or** at the top level of an [ES module](es-modules.md).

## Top-level await
In ES modules you can write `await` directly in the file:
```ts
await program.parseAsync(process.argv);
```
No wrapper function is needed.

## 💡 Tip
If you forget `await`, the code keeps going before the work is done. That's a classic source of "why did it print in the wrong order?" bugs.

## In this project
[index.ts](../files/index.ts.md) calls `await program.parseAsync(process.argv)` at the top level. This gets `yuvi` ready for `async` actions like interactive prompts (`@clack/prompts`) and Telegram calls. See [commander-cli.md](commander-cli.md).
