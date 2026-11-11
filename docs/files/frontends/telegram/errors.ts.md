# frontends/telegram/errors.ts

**Purpose:** The Telegram version of "explain this error in plain words". It turns a raw provider or network error into a short problem and a fix that makes sense *inside a chat*.

**Where it fits:** It uses `classifyError` from [core/errors.ts](../../core/errors.ts.md) and a [provider profile](../../core/llm/profiles.ts.md). [view/turn-view.ts](view/turn-view.ts.md) calls it through `errorHtml`. The terminal has its own wording in [terminal/errors.ts](../terminal/errors.ts.md).

---

### `bare()`: shorter links

```ts
/** Drop the scheme: Telegram links a bare host by itself and it reads shorter. */
const bare = (url: string) => url.replace(/^https?:\/\//, "");
```

**What it does:** A tiny [regular expression](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions) removes `http://` or `https://` from the start. `s?` means "an optional s", and `^` means "at the start".

**Why it's used here:** Telegram turns `platform.openai.com/...` into a link anyway, and on a phone screen shorter text is easier to read.

---

### `wordingFor()`: messages for a chat

```ts
function wordingFor(provider: LLMProviderProfile): Wording {
    const { label } = provider;
    return {
        auth_missing: {
            problem: `The ${label} key is missing or not accepted.`,
            fix: "Set the key on your PC (run yuvi in the terminal and choose “Set API key”), then restart the bot.",
        },
        no_credits: {
            problem: `The ${label} account has no credits left for this model.`,
            fix: `Add credits at ${bare(provider.billingUrl)}, or send /model and pick a cheaper one.`,
        },
        // ...one entry for every ErrorKind
    };
}
```

**What it does:** One `{ problem, fix }` per error kind, with the provider's name and links filled in. The fixes use Telegram commands like `/model`, `/compact` and `/new`.

**Why it's used in general:** The same problem needs different advice in different places. "Type /" makes sense in a terminal; "send /model" makes sense in a chat.

**Why it's used here:** Keys are **never** set from a chat, because a chat message isn't a safe place for a secret. So key problems always point you back to your PC.

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

**What it does:** Classify, then look up the wording for the given provider (OpenRouter if none is given).

**Why it's used here:** [host.ts](host.ts.md) passes `settings.llmProfile` down, so OpenAI users see OpenAI's billing page.

---

### 🧠 Key takeaways
- Same idea as the terminal version, but the advice fits a chat.
- Provider names and links come from the active profile.
- Links are shortened with `bare()` for phone screens.
- Key problems are always fixed on the PC, never in the chat.
