# The AI SDK (`ai` package): models, tools, and agents

The `ai` package (often called the **Vercel AI SDK**) is a toolkit for talking to large language models (LLMs) from TypeScript. It gives every AI provider the same shape, so you can swap OpenAI, Anthropic, OpenRouter, and others without rewriting your app.

Think of it as a universal power adapter. The plug (your code) stays the same, and only the adapter (the provider) changes.

## Three big ideas

### 1. A model
A model object says *which* AI brain to use. You get one from a **provider** package:

```ts
const provider = createOpenRouter({ apiKey: "..." });
const model = provider("some/model-id");
```

### 2. Tools
A **tool** is a function the AI is allowed to call. You describe it in plain words and give it an input schema, so the AI knows what arguments to send:

```ts
import { tool } from "ai";
import z from "zod";

const read_file = tool({
  description: "Read a text file from the workspace.",
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ path }) => readTheFile(path),
});
```

- `description`: the AI reads this to decide *when* to use the tool. Clear words matter.
- `inputSchema`: a [Zod schema](zod-schemas.md). The SDK checks the AI's arguments against it.
- `execute`: your real code. Whatever it returns is sent back to the AI as the tool's result.

### 3. An agent loop
An **agent** is a model that can call tools, read the results, and then decide what to do next, again and again. `ToolLoopAgent` runs that loop for you:

```ts
const agent = new ToolLoopAgent({
  model,
  instructions: "You are a helpful assistant.",
  tools: { read_file },
  stopWhen: stepCountIs(10),
});

const result = await agent.generate({ prompt: "What is in index.ts?" });
console.log(result.text);
```

The loop goes like this:

```
prompt → model thinks → calls a tool → gets the result → thinks again → ... → final text
```

- **`instructions`**: the "system prompt". Background rules the AI should always follow.
- **`stopWhen: stepCountIs(10)`**: a safety brake. Each think-and-call round is one *step*. After 10 steps, stop, even if the AI wants to keep going.
- **`generate`**: runs the whole loop and gives back the final `result` (with `result.text`).
- **`onStepFinish`**: an optional callback that runs after each step. It's handy for showing progress, such as "✓ read_file".

💡 **Tip:** The AI never runs your code directly. It only *asks* to call a tool, and the SDK runs `execute` for it. That is why you control exactly what the AI can and can't do.

**Used in:** [files/modes/agent/agent-tools.ts.md](../files/modes/agent/agent-tools.ts.md), [files/modes/agent/orchestrator.ts.md](../files/modes/agent/orchestrator.ts.md), [files/ai/ai.config.ts.md](../files/ai/ai.config.ts.md)
