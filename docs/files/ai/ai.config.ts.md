# ai/ai.config.ts

**Purpose:** This file chooses **which AI brain** `yuvi` uses. It connects to [OpenRouter](../../concepts/openrouter.md) with your API key and gives back a ready-to-use model object.

**Where it fits:** It is re-exported by the barrel file [ai/index.ts](index.ts.md). The agent in [modes/agent/orchestrator.ts](../modes/agent/orchestrator.ts.md) calls `getAgentModel()` when it builds its `ToolLoopAgent`.

---

### Import

```ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
```

**What it does:** It pulls in the function that creates an OpenRouter **provider**.

**Why it's used in general:** The [AI SDK](../../concepts/ai-sdk-agents.md) talks to every AI company through a "provider" adapter package. You install the adapter for the service you want.

**Why it's used here:** `yuvi` uses OpenRouter, so one key unlocks many models, including free ones.

---

### `getAgentModel()`

```ts
export function getAgentModel() {
    const provider = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY || "",
    });
    const modelId = process.env.OPENROUTER_DEFAULT_MODEL || "openrouter/free";
    return provider(modelId);
}
```

**What it does:**
- `createOpenRouter({ apiKey })` builds a provider that will sign each request with your key. The key comes from the `OPENROUTER_API_KEY` [environment variable](../../concepts/environment-variables.md). If it's missing, it uses an empty string.
- `modelId` comes from `OPENROUTER_DEFAULT_MODEL`. If that isn't set, it falls back to `"openrouter/free"`.
- `provider(modelId)` turns the ID into a model object and returns it.

**Why it's used in general:** Wrapping model setup in one small function is a common habit. The rest of the app just asks for "the model" and never has to know about keys or IDs.

**Why it's used here:** It keeps all AI settings in one place. To try a different model, change `OPENROUTER_DEFAULT_MODEL` in your `.env` file. You don't need to touch the code.

💡 **Tip:** Bun reads `.env` automatically, so a `.env` file with `OPENROUTER_API_KEY=...` in the project folder is all you need. Keep that file out of Git (it already is, via [.gitignore](../.gitignore.md)).

---

### 🧠 Key takeaways
- A **provider** is the adapter, and a **model** is the specific brain you pick from it.
- Secrets and settings come from `process.env`, with friendly fallbacks.
- One function, `getAgentModel()`, is the single place the app gets its AI model.
