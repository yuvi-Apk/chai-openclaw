# core/errors.ts

**Purpose:** One **family of errors** for the whole app, plus two helpers: one turns any thrown value into text, the other works out *what kind* of failure a provider error was.

**Where it fits:** The core and the modes throw these errors. The front ends ([terminal errors](../frontends/terminal/errors.ts.md), [telegram errors](../frontends/telegram/errors.ts.md)) call `classifyError` and then choose friendly words. This file never decides the wording; that belongs to the front end.

---

### The error family

```ts
export class YuviError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

export class ConfigError extends YuviError { }
export class BudgetError extends YuviError { }
export class ToolError extends YuviError { }
```

**What it does:** `YuviError` is the parent. `new.target.name` is the name of the class actually being created, so a `ConfigError` gets `name = "ConfigError"` without writing it by hand. The children are:
- `ConfigError`: a setting is missing or wrong (like an unknown `YUVI_LLM`).
- `BudgetError`: a message used too many model calls.
- `RateLimitError`: too many calls in the last minute (has a default message).
- `ToolError`: a mode used a tool it didn't declare, or a tool refused to run.

**Why it's used in general:** Custom error classes let callers react to one kind with `instanceof` and let the rest pass. See [typescript-classes.md](../../concepts/typescript-classes.md).

**Why it's used here:** Everything is still a `YuviError`, so a front end can tell "our own error" apart from a surprise crash.

---

### `errorText()`

```ts
export function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try { return JSON.stringify(error); } catch { return String(error); }
}
```

**What it does:** In JavaScript you can `throw` anything, not just `Error`s. This turns whatever was thrown into readable text.

**Why it's used here:** The value of a `catch` is `unknown` in strict TypeScript, so this helper narrows it safely.

---

### `classifyError()`: what went wrong?

```ts
if (
    has("invalid api key", "incorrect api key", "unauthorized", "user not found") ||
    // Anthropic, then Gemini.
    has("invalid x-api-key", "api key not valid", "api_key_invalid", "api key expired")
) {
    return "auth_rejected";
}
// OpenAI reports an empty balance as a 429, so this must come before rate limits.
if (
    has("402", "insufficient credits", "payment required", "more credits", "exceeded your current quota", "insufficient_quota") ||
    has("credit balance is too low")
) {
    return "no_credits";
}
if (has("429", "rate limit", "rate-limit", "too many requests", "resource_exhausted", "resource has been exhausted")) {
    return "rate_limited";
}
```

**What it does:** It lower-cases the raw message and looks for known phrases. `has(...)` is true if *any* of the words appear. The result is one `ErrorKind`, a [union type](../../concepts/typescript-union-types.md) like `"auth_missing"`, `"no_credits"`, `"rate_limited"`, `"model_not_found"`, `"network"` or `"unknown"`.

It knows the wording of all four providers:

| Kind | OpenRouter / OpenAI | Claude (Anthropic) | Gemini |
|---|---|---|---|
| key rejected | "invalid api key", "Incorrect API key provided" | "invalid x-api-key" | "API key not valid", "API key expired" |
| no credits | "402", "insufficient_quota" | "credit balance is too low" | — |
| rate limited | "429", "too many requests" | "429" | "RESOURCE_EXHAUSTED" |
| model not found | "does not exist or you do not have access" | — | "is not found for API version" |
| provider down | "500", "503", "overloaded" | "529 overloaded_error" | "503" |

When a check grows, a second `has(...)` is joined with `||` and a short comment says which provider it is for. That keeps each list readable.

**Why it's used in general:** Providers send long technical messages. Sorting them into a few buckets lets you show a short, helpful message.

**Why it's used here:** **The order matters.** OpenAI sends an empty balance as HTTP `429`, the same code as "too many requests". So the "no credits" check runs *before* the rate-limit check. Otherwise a user with no money would be told "wait a minute", which would never help.

💡 **Tip:** When checks can overlap, put the more specific one first. A comment explaining why stops someone from "tidying" the order later.

---

### 🧠 Key takeaways
- All app errors extend `YuviError`; `new.target.name` names them for free.
- `errorText` turns any thrown value into text.
- `classifyError` sorts raw messages from OpenRouter, OpenAI, Claude and Gemini into a few kinds.
- "No credits" is checked before "rate limited" because OpenAI uses 429 for both.
- The core classifies; the front ends choose the words.
