# core/llm/profiles.ts

**Purpose:** A small "address book" of model providers. For each provider (OpenRouter, OpenAI, Gemini, Claude) it says which environment variables hold the key and models, where they are saved in `~/.yuvi/settings.json`, the default models, which models to suggest in a menu, and the web pages a user may need (keys, models, billing).

**Where it fits:** [core/config.ts](../config.ts.md) reads a profile to find the right key and model. [core/llm/providers.ts](providers.ts.md) builds the actual model object. [core/llm/choices.ts](choices.ts.md) turns the profiles into menu options. The front ends ([terminal errors](../../frontends/terminal/errors.ts.md), [telegram errors](../../frontends/telegram/errors.ts.md), [prompts.ts](../../frontends/terminal/prompts.ts.md), [model-menu.ts](../../frontends/terminal/model-menu.ts.md), [model-settings.ts](../../frontends/telegram/model-settings.ts.md)) use the label and links to talk to the user. The idea behind it is explained in [concepts/provider-profiles.md](../../../concepts/provider-profiles.md).

---

### `LLMProviderProfile`: the shape of one profile

```ts
export interface LLMProviderProfile {
    label: string;
    keyEnv: string;
    modelEnv: string;
    fastModelEnv: string;
    savedKey: keyof UserSettings;
    savedModel: keyof UserSettings;
    savedFastModel: keyof UserSettings;
    defaultModel: string;
    defaultFastModel?: string;
    suggestedModels: string[];
    keysUrl: string;
    modelsUrl: string;
    billingUrl: string;
}
```

**What it does:** It lists every fact about a provider that the rest of the app needs:
- `label`: the friendly name, like `"Claude"`.
- `keyEnv`, `modelEnv`, `fastModelEnv`: the names of the environment variables to read.
- `savedKey`, `savedModel`, `savedFastModel`: the field names in the saved settings file.
- `defaultModel`: what to use when nothing is set.
- `defaultFastModel` (optional): a cheaper model for small jobs; without it, the main model is used.
- `suggestedModels`: the ids offered as buttons in the model menu, best first. You can still type any id.
- `keysUrl`, `modelsUrl`, `billingUrl`: links shown in help and error messages.

**Why it's used in general:** An interface describes the shape of an object, so TypeScript can check every profile has all the fields ([typescript-interfaces-and-utility-types.md](../../../concepts/typescript-interfaces-and-utility-types.md)).

**Why it's used here:** `keyof UserSettings` is a neat trick. It means "must be one of the field names of `UserSettings`". If someone types `"geminiKey"` by mistake (the real name is `geminiApiKey`), TypeScript stops them.

---

### `LLM_PROFILES`: the four entries

```ts
export const LLM_PROFILES: Record<string, LLMProviderProfile> = {
    openrouter: { label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY", savedKey: "apiKey",
                  defaultModel: "openrouter/free", /* ... */ },
    openai:     { label: "OpenAI", keyEnv: "OPENAI_API_KEY", defaultModel: "gpt-5-mini", /* ... */ },
    gemini:     { label: "Gemini", keyEnv: "GEMINI_API_KEY", defaultModel: "gemini-3.8-flash", /* ... */ },
    anthropic: {
        label: "Claude",
        keyEnv: "ANTHROPIC_API_KEY",
        defaultModel: "claude-sonnet-5-5",
        // Triage and summaries do not need Sonnet; Haiku is much cheaper.
        defaultFastModel: "claude-haiku-5-5",
        suggestedModels: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
        // ...saved names and links
    },
};
```

**What it does:** It maps a provider name (the value of `YUVI_LLM`, or the one picked in the menu) to its profile.
- OpenRouter keeps the old setting names (`apiKey`, `model`, `YUVI_MODEL_FAST`), so existing setups keep working.
- OpenAI, Gemini and Claude each get their own names (`OPENAI_DEFAULT_MODEL`, `geminiApiKey`, `ANTHROPIC_FAST_MODEL`, ...).
- Each `suggestedModels` list starts with that provider's `defaultModel` (a test checks this).

**Why it's used in general:** Putting differences in **data** instead of `if/else` code means adding a provider is "add one entry", not "edit five functions".

**Why it's used here:** It keeps each provider's settings separate. Switching provider swaps everything at once: key, model and links, so `openrouter/free` is never sent to Claude by accident. Many things follow from a profile automatically: the provider menu lists it, its key is hidden from shell commands, and errors name it.

💡 **Tip:** The provider name and the label can differ: the name is `anthropic` (the company, as in `ANTHROPIC_API_KEY`), while users see "Claude".

---

### `profileFor()`: find a profile safely

```ts
export const DEFAULT_PROFILE_NAME = "openrouter";

export function profileFor(provider: string): LLMProviderProfile {
    return LLM_PROFILES[provider] ?? (LLM_PROFILES[DEFAULT_PROFILE_NAME] as LLMProviderProfile);
}
```

**What it does:** Looks up the profile by name. If there is none (for example, a custom adapter called `"local"`), it falls back to OpenRouter's profile. `??` means "use the right side if the left side is `undefined` or `null`".

**Why it's used in general:** A lookup with a sensible fallback means callers never have to handle "not found" themselves.

**Why it's used here:** The project uses `noUncheckedIndexedAccess`, so `LLM_PROFILES[provider]` has the type `LLMProviderProfile | undefined`. The `as LLMProviderProfile` tells TypeScript "the default entry is definitely there", which is true because it is written just above.

---

### 🧠 Key takeaways
- A profile is plain data: env names, saved names, default models, suggestions and links for one provider.
- Four providers today: OpenRouter, OpenAI, Gemini and Claude (`anthropic`).
- A profile may name a cheaper `defaultFastModel` (Claude uses Haiku).
- Adding a provider = one entry here + one entry in [`LLM_PROVIDERS`](providers.ts.md) + its fields in `UserSettings`.
- `keyof UserSettings` lets TypeScript catch typos in saved-setting names.
