# core/llm/verify-key.ts

**Purpose:** Checks that a pasted API key **really works before it is saved**. It sends one tiny message ("Reply with the word OK.") with that key and tells the caller whether it worked, or what kind of failure it was. It never saves anything.

**Where it fits:** The terminal's [login.ts](../../frontends/terminal/login.ts.md) calls it (with a spinner) every time you paste a key. It builds the model client with `createCore` from `core/compose.ts`, the same way every mode does, picks the model with [core/config.ts](../config.ts.md), and sorts failures with `classifyError` from [core/errors.ts](../errors.ts.md).

---

### The limits and the `KeyCheck` result

```ts
const VERIFY_TIMEOUT_MS = 20_000;
const VERIFY_MAX_TOKENS = 16;

export type KeyCheck = { ok: true } | { ok: false; kind: ErrorKind };
```

**What it does:**
- `VERIFY_TIMEOUT_MS` (20 seconds) is long enough for a slow first reply, short enough not to leave you waiting. `20_000` is just `20000`; the `_` makes it easier to read.
- `VERIFY_MAX_TOKENS` asks for at most 16 tokens back, so the check costs almost nothing.
- `KeyCheck` is either `{ ok: true }` or `{ ok: false, kind }`, where `kind` is an error kind like `"auth_rejected"` or `"network"`.

**Why it's used in general:** This is a **discriminated union**: the `ok` field tells TypeScript which shape you have. After `if (!check.ok)`, TypeScript knows `check.kind` exists ([typescript-union-types.md](../../../concepts/typescript-union-types.md)).

**Why it's used here:** The core only says *what kind* of failure it was. The front end decides how to word it, the same split as for every other error in yuvi.

---

### `CoreMaker`: a seam for tests

```ts
export type CoreMaker = (settings: Settings) => Pick<Core, "llm">;
```

**What it does:** A function type: give it settings, get back something with an `llm`. `Pick<Core, "llm">` means "only the `llm` part of `Core`".

**Why it's used in general:** Asking for the *smallest* thing you need makes the function easy to fake ([typescript-interfaces-and-utility-types.md](../../../concepts/typescript-interfaces-and-utility-types.md)).

**Why it's used here:** The real default is `createCore`. Tests pass a maker that returns a `FakeLLM`, so they can check the request (model, `maxTokens`) without any network.

---

### `verifyKey()`

```ts
const profile = profileFor(provider);
const model = settings.modelId("main", provider);
// In memory only: no file, no vault, and this key alone.
const trial = new Settings({ YUVI_LLM: provider, [profile.keyEnv]: key, [profile.modelEnv]: model }, null);
try {
    await makeCore(trial).llm.complete({
        model,
        messages: [{ role: "user", content: "Reply with the word OK." }],
        maxTokens: VERIFY_MAX_TOKENS,
        timeoutMs: VERIFY_TIMEOUT_MS,
    });
    return { ok: true };
} catch (error) {
    return { ok: false, kind: classifyError(errorText(error)) };
}
```

**What it does:**
1. Finds the main model you'd use with that provider (your saved pick, or the default).
2. Builds a **throw-away** `Settings` that knows only this provider, this key and this model. The `null` file means memory only: nothing is written, and the real vault is never touched.
3. Sends one short message. Any reply at all means the key works.
4. If it throws, `classifyError` turns the message into a kind, and that is returned instead of thrown.

**Why it's used in general:** "Fail early" saves frustration: it's much nicer to hear "that key was rejected" right after pasting it than on your first real question.

**Why it's used here:** Using the same client every mode uses means the check fails for exactly the same reasons a real chat would. The throw-away settings keep your current provider and saved keys untouched, even while checking a key for a different provider.

💡 **Tip:** `{ [profile.keyEnv]: key }` is a computed property name: for Claude it becomes `{ ANTHROPIC_API_KEY: key }`.

---

### 🧠 Key takeaways
- One tiny, cheap model call proves a key works before it's saved.
- It uses a throw-away, memory-only `Settings`: nothing is saved and the vault isn't touched.
- Failures come back as a value (`{ ok: false, kind }`), not as a thrown error.
- `CoreMaker` lets tests swap in a fake model.
