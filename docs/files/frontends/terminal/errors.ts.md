# frontends/terminal/errors.ts

**Purpose:** Turns a raw error into **plain words plus a next step** for the terminal. The core only says *which kind* of failure it was. This file decides what to tell you.

**Where it fits:** It calls `classifyError` from [core/errors.ts](../../core/errors.ts.md). It takes a [provider profile](../../core/llm/profiles.ts.md) so the advice names the right service. [renderer.ts](renderer.ts.md) calls it to draw the red error box. Telegram has its own version: [telegram/errors.ts](../telegram/errors.ts.md).

---

### `wordingFor()`: the messages, per provider

```ts
function wordingFor(provider: LLMProviderProfile): Wording {
    const { label, keysUrl, modelsUrl, billingUrl } = provider;
    return {
        auth_rejected: {
            problem: `${label} did not accept your API key.`,
            fix: `Type / and choose “Set API key” and paste a fresh key from ${keysUrl}`,
        },
        no_credits: {
            problem: `Your ${label} account has no credits left for this model.`,
            fix: `Add credits at ${billingUrl}, or type / → “Change AI model” and pick a cheaper one.`,
        },
        // ...one entry for every ErrorKind
    };
}
```

**What it does:** Builds a table with one `{ problem, fix }` pair for every `ErrorKind`. `const { label, keysUrl, ... } = provider` is **destructuring**: it pulls those fields out into local variables. Template strings (`` `...${label}...` ``) then put the provider's name and links into the text.
- Key, credits and model messages name the provider and link to its pages.
- General messages (network, timeout, rate limit, context too long) are the same for every provider.

**Why it's used in general:** Keeping user-facing text in one table makes it easy to read, change and later translate.

**Why it's used here:** With OpenAI in use, you see "OpenAI did not accept your API key" and a link to `platform.openai.com`, not OpenRouter's pages.

💡 **Tip:** `Wording` is `Record<ErrorKind, {...}>`. Because `Record` needs *every* key, TypeScript complains if a new `ErrorKind` is added without a message here.

---

### `explainError()`

```ts
export function explainError(
    raw: string,
    provider: LLMProviderProfile = profileFor("openrouter"),
): { problem: string; fix: string } {
    return wordingFor(provider)[classifyError(raw)];
}
```

**What it does:** Classifies the raw text, then looks up the wording for the given provider. If no provider is passed, it uses OpenRouter's profile.

**Why it's used in general:** A **default parameter** keeps old callers working while new callers can pass more detail.

**Why it's used here:** The renderer passes the active profile. Tests can call it with just a message.

---

### 🧠 Key takeaways
- The core classifies the error; this file words it for the terminal.
- The wording is built per provider, so names and links always match `YUVI_LLM`.
- `Record<ErrorKind, ...>` makes sure every error kind has a message.
- With no provider given, OpenRouter's wording is used.
