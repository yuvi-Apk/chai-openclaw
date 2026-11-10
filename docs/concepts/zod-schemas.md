# Zod: describing the shape of data

**Zod** is a library for describing what data *should* look like, and then checking real data against that description.

TypeScript types disappear when the code runs. Zod schemas stay around at runtime, so they can actually check data that comes from outside, like user input, a web request, or an AI.

Think of a schema as a **form with labelled boxes**. Zod checks that every box is filled in with the right kind of thing.

## The basics

```ts
import z from "zod";

const Input = z.object({
  path: z.string().describe("Relative file path"),
  recursive: z.boolean().optional().default(false),
});

Input.parse({ path: "src" });          // ✅ { path: "src", recursive: false }
Input.parse({ path: 42 });             // ❌ throws: expected string
```

- `z.object({...})`: an object with these keys.
- `z.string()`, `z.boolean()`: the kind of value in each box.
- `.optional()`: this key may be missing.
- `.default(x)`: if it's missing, use `x`.
- `.describe("...")`: a human-friendly note. AI tools pass this note to the model, so it understands each argument.
- `z.object({})`: an empty object, for "this takes no arguments".

## Why AI tools use it

When an AI calls a tool, it sends arguments as JSON. Zod makes sure those arguments are the right shape *before* your code runs. It also turns the schema into a description the AI can read. See [ai-sdk-agents.md](ai-sdk-agents.md).

💡 **Tip:** Zod also gives you a TypeScript type for free. The `execute` function's arguments are typed automatically from the schema, so you don't write the type twice.

**Used in:** [files/modes/agent/agent-tools.ts.md](../files/modes/agent/agent-tools.ts.md)
