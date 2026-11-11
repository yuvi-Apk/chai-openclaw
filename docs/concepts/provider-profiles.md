# Provider profiles: supporting several services with data

## The problem

`yuvi` can talk to more than one AI service (OpenRouter, OpenAI, Gemini and Claude). Each one has:
- a different environment variable for its key,
- different model names,
- different web pages for keys, models and billing.

A naive approach puts `if (provider === "openai") ... else ...` everywhere: in settings, in error messages, in prompts. Every new provider means editing all of those places, and forgetting one is easy.

## The idea: describe the differences as data

Instead, write the differences down **once**, as a plain object per provider. This is a **profile**:

```ts
openai: {
    label: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_DEFAULT_MODEL",
    savedKey: "openaiApiKey",
    defaultModel: "gpt-5-mini",
    keysUrl: "https://platform.openai.com/api-keys",
}
```

Then code asks the profile instead of asking "which provider is it?":

```ts
const profile = settings.llmProfile;
const key = pick(profile.keyEnv, profile.savedKey);
const message = `${profile.label} did not accept your API key.`;
```

Think of a hotel key card: the door doesn't need code for each guest. It just reads the card.

## Profiles vs registries

The project uses two lists that work as a pair:

| List | Holds | Answers |
|---|---|---|
| `LLM_PROFILES` ([profiles.ts](../files/core/llm/profiles.ts.md)) | plain data | "What are this provider's settings and links?" |
| `LLM_PROVIDERS` ([providers.ts](../files/core/llm/providers.ts.md)) | functions | "How do I build a model for this provider?" |

Both are **registries**: lists of named options, picked by a setting (`YUVI_LLM`, or the provider picked in a menu). Adding a provider means adding one entry to each list (plus its saved fields in `UserSettings`). You don't need to edit working code, which is the "O" (open/closed) in SOLID.

Because so much is *derived* from the profiles, a new entry also gets, for free:
- a line in both front ends' provider menus ([choices.ts](../files/core/llm/choices.ts.md)),
- its key hidden from output and from shell commands (`Settings.SECRET_ENV_NAMES` is built from the profiles),
- error advice that uses its name and links.

That's the payoff of "data, not `if`s": the more code reads the list, the less there is to remember.

## Precedence: who wins?

When the same value can come from several places, you need a fixed order. In [core/config.ts](../files/core/config.ts.md):

1. a value saved **during this run** (you just pasted a key or picked a provider in a menu),
2. the **environment** (`.env`),
3. the **saved settings file** (`~/.yuvi/settings.json`),
4. the profile's **default**.

```ts
this.changed[saved] || this.env[envName] || this.saved[saved] || ""
```

`||` returns the first value that isn't empty, so the chain reads left to right like a priority list. The same order is used for the key, the models, the provider itself and the thinking effort.

One consequence worth knowing: a menu pick wins *now*, but at the next start `.env` beats the saved file. That's why the menus warn "`.env` sets this too" — remove the line from `.env` if you want the menu choice to stick.

## Where else you'll see this

- ESLint and Prettier configs pick rules by name from presets.
- Payment libraries keep one config object per gateway.
- Front-end themes are profiles: one object of colours per theme.

💡 **Tip:** Keep profiles as *data only*: strings, numbers, links. Once behaviour (functions) creeps in, it belongs in the registry next to it.
