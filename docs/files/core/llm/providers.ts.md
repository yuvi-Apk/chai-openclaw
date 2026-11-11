# core/llm/providers.ts

**Purpose:** The **factory** for AI models. It turns a model id like `"claude-sonnet-5-5"` into a model object the AI SDK can call, using whichever provider is in use right now.

**Where it fits:** It reads the provider, key and model ids from [core/config.ts](../config.ts.md), which gets them through [profiles.ts](profiles.ts.md). The composition root (`core/compose.ts`, `createCore`) builds one `Models` object and hands it to the modes. The model objects come from the [AI SDK](../../../concepts/ai-sdk-agents.md).

---

### `LLM_PROVIDERS`: the registry

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export const LLM_PROVIDERS: LLMProviderRegistry = {
    // The key is read on every call, so a key set mid-session works at once.
    openrouter: (settings) => (modelId) => createOpenRouter({ apiKey: settings.apiKey })(modelId),
    openai: (settings) => (modelId) => createOpenAI({ apiKey: settings.apiKey })(modelId),
    gemini: (settings) => (modelId) => createGoogleGenerativeAI({ apiKey: settings.apiKey })(modelId),
    anthropic: (settings) => (modelId) => createAnthropic({ apiKey: settings.apiKey })(modelId),
};
```

**What it does:** Each entry is a function that takes the settings and returns a "model maker" (a `ModelFactory`). The model maker takes a model id and returns a `LanguageModel`.
- `openrouter` uses the [OpenRouter](../../../concepts/openrouter.md) adapter (many models, one key).
- `openai` uses `@ai-sdk/openai`, straight to OpenAI.
- `gemini` uses `@ai-sdk/google` with a Google AI Studio key.
- `anthropic` uses `@ai-sdk/anthropic`, straight to Claude.

**Why it's used in general:** This is the **registry pattern**: a list of named options, picked by a setting. New options are added, old code isn't edited (the "O" in SOLID).

**Why it's used here:** All four adapters speak the same AI SDK language, so the rest of yuvi doesn't care which one is in use. `settings.apiKey` already returns the right key for the active provider, so the four lines look almost the same.

💡 **Tip:** The adapter is created inside the inner function, on every call. That's why a key you paste with "Log in / change key" works straight away, without a restart.

---

### `Models`: build by id or by role

```ts
constructor(private readonly settings: Settings, private readonly registry = LLM_PROVIDERS) {
    // Fail at start-up, not at the first message, when the provider is set wrongly.
    this.factory();
}

private factory(): ModelFactory {
    const name = this.settings.llmProvider;
    const provider = this.registry[name];
    if (!provider) throw new ConfigError(`Unknown model provider "${name}". Available: ...`);
    return provider(this.settings);
}

byId(modelId: string): LanguageModel { return this.factory()(modelId); }
forRole(role: ModelRole = "main"): LanguageModel { return this.byId(this.settings.modelId(role)); }
```

**What it does:**
- `factory()` looks up the provider **each time it is called**, using the current `settings.llmProvider`. If the name is unknown it throws a clear `ConfigError` listing the valid names.
- The constructor calls `factory()` once just to check, so a wrong `YUVI_LLM` fails at start-up.
- `byId(id)` builds a model by exact id. `forRole("main" | "fast")` asks the settings which id fits that role.

**Why it's used in general:** Failing early with a helpful message ("Available: openrouter, openai, gemini, anthropic") is much kinder than a confusing crash later.

**Why it's used here:** Because nothing is cached, switching provider in a menu (`settings.saveProvider("anthropic")`) changes the *next* model call, with no restart. The registry is a constructor parameter, so tests can pass a fake registry and never touch the network. See [typescript-classes.md](../../../concepts/typescript-classes.md) for parameter properties and injection.

---

### 🧠 Key takeaways
- `LLM_PROVIDERS` maps a provider name to a model maker.
- OpenRouter, OpenAI, Gemini and Claude are supported.
- `Models` looks the provider up on every call, so a menu switch works mid-session.
- An unknown provider still fails at start-up with a `ConfigError` and the list of valid ones.
- The key is read on every call, so a new key works at once.
