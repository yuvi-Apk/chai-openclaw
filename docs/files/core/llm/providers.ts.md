# core/llm/providers.ts

**Purpose:** The **factory** for AI models. It turns a model id like `"gpt-5-mini"` into a model object the AI SDK can call, using whichever provider `YUVI_LLM` picks.

**Where it fits:** It reads the key and model ids from [core/config.ts](../config.ts.md), which gets them through [profiles.ts](profiles.ts.md). The composition root (`core/compose.ts`, `createCore`) builds one `Models` object and hands it to the modes. The model objects come from the [AI SDK](../../../concepts/ai-sdk-agents.md).

---

### `LLM_PROVIDERS`: the registry

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export const LLM_PROVIDERS: LLMProviderRegistry = {
    // The key is read on every call, so a key set mid-session works at once.
    openrouter: (settings) => (modelId) => createOpenRouter({ apiKey: settings.apiKey })(modelId),
    openai: (settings) => (modelId) => createOpenAI({ apiKey: settings.apiKey })(modelId),
};
```

**What it does:** Each entry is a function that takes the settings and returns a "model maker" (a `ModelFactory`). The model maker takes a model id and returns a `LanguageModel`.
- `openrouter` uses the [OpenRouter](../../../concepts/openrouter.md) adapter.
- `openai` uses the official `@ai-sdk/openai` adapter, which talks straight to OpenAI.

**Why it's used in general:** This is the **registry pattern**: a list of named options, picked by a setting. New options are added, old code isn't edited (the "O" in SOLID).

**Why it's used here:** Both adapters speak the same AI SDK language, so the rest of yuvi doesn't care which one is in use. `settings.apiKey` already returns the right key for the active provider, so both lines look almost the same.

💡 **Tip:** The adapter is created inside the inner function, on every call. That's why a key you paste with "Set API key" works straight away, without a restart.

---

### `Models`: build by id or by role

```ts
constructor(private readonly settings: Settings, registry = LLM_PROVIDERS) {
    const provider = registry[settings.llmProvider];
    if (!provider) {
        throw new ConfigError(`Unknown model provider "${settings.llmProvider}". Available: ...`);
    }
    this.build = provider(settings);
}

forRole(role: ModelRole = "main"): LanguageModel {
    return this.build(this.settings.modelId(role));
}
```

**What it does:** On creation it finds the provider named by `YUVI_LLM`. If it doesn't exist, it throws a clear `ConfigError` that lists the available names. `byId(id)` builds a model by exact id. `forRole("main" | "fast")` asks the settings which model id fits that role.

**Why it's used in general:** Failing early with a helpful message ("Available: openrouter, openai") is much kinder than a confusing crash later.

**Why it's used here:** The registry is a constructor parameter, so tests can pass a fake registry and never touch the network. See [typescript-classes.md](../../../concepts/typescript-classes.md) for parameter properties and injection.

---

### 🧠 Key takeaways
- `LLM_PROVIDERS` maps a provider name to a model maker.
- OpenRouter and OpenAI are both supported; `YUVI_LLM` chooses.
- `Models` throws a `ConfigError` for an unknown provider, with the list of valid ones.
- The key is read on every call, so a new key works at once.
