# OpenRouter: one key, many AI models

**OpenRouter** is a service that sits in front of many AI providers (OpenAI, Anthropic, Google, open-source models, and more). You sign up once, get one API key, and can then pick any model by its ID, like `"openai/gpt-4o"` or `"openrouter/free"`.

Think of it as a **travel agent**. You tell one agent where you want to go, and they book whichever airline fits.

## How it plugs into the AI SDK

The package `@openrouter/ai-sdk-provider` is an adapter for the [AI SDK](ai-sdk-agents.md):

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const provider = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const model = provider("openrouter/free");
```

- `createOpenRouter(...)` makes a provider that knows your key.
- Calling `provider("<model id>")` gives back a model object the AI SDK can use.

## Why use it

- Try different models by changing one string, with no new SDK to learn.
- Free and cheap models are available, which is great while learning.

💡 **Tip:** Your API key is a password. Keep it in an [environment variable](environment-variables.md) (for example in `.env`, which is in `.gitignore`), never in the code.

**Used in:** [files/ai/ai.config.ts.md](../files/ai/ai.config.ts.md)
