# frontends/telegram/view/turn-view.ts

**Purpose:** Decides **what one turn looks like in Telegram**. Mode events are folded into two things: an "activity" message that shows the work as it happens (status, thinking, tool calls, plan), and the final answer. This class only builds text; sending it is someone else's job.

**Where it fits:** [host.ts](../host.ts.md) creates one `TurnView` per turn and feeds it events. Errors are worded by [errors.ts](../errors.ts.md).

> This doc covers the parts that use the model provider. More sections will be added as the file changes.

---

### The constructor and `apply()`

```ts
/** @param provider names the model provider in error advice */
constructor(private readonly provider?: LLMProviderProfile) {}

apply(event: ModeEvent): void {
    switch (event.type) {
        // ...status, tool, todos, answer, summary...
        case "error":
            this.errors.push(errorHtml(event.message, event.hint, this.provider));
            return;
    }
}
```

**What it does:** The view can be given the active [provider profile](../../../core/llm/profiles.ts.md). `apply` takes one event at a time and updates the view's state. An `error` event becomes a ready-made HTML block that names the right provider.

**Why it's used in general:** A `switch` on `event.type` is the standard way to handle a [union type](../../../../concepts/typescript-union-types.md): TypeScript knows which fields each case has.

**Why it's used here:** Keeping "build the text" apart from "send the message" makes the view easy to test with no network. A test can do `new TurnView(profileFor("openai"))` and check the HTML.

---

### `errorHtml()`

```ts
export function errorHtml(raw: string, hint?: string, provider?: LLMProviderProfile): string {
    const { problem, fix } = explainError(raw, provider);
    const lines = [`✗ <b>${escapeHtml(problem)}</b>`, `<b>What to do:</b> ${escapeHtml(fix)}`];
    const detail = raw.replace(/\s+/g, " ").trim();
    if (detail && detail !== problem) lines.push(`<i>Technical detail: ${short(detail, ERROR_DETAIL_MAX_CHARS)}</i>`);
```

**What it does:** Builds a Telegram HTML error: a bold problem, a "What to do" line, and a shortened technical detail in italics. `escapeHtml` makes sure characters like `<` in the error can't break the message.

**Why it's used here:** The provider passes straight through to `explainError`, so OpenAI users see OpenAI's billing link, not OpenRouter's.

---

### 🧠 Key takeaways
- `TurnView` turns events into Telegram text; it never sends anything.
- The provider profile is injected through the constructor.
- `errorHtml` escapes the text and words it for the active provider.
