# frontends/telegram/host.ts

**Purpose:** What a mode sees of Telegram: the `ModeHost` of **one chat**. Events become an activity message that is redrawn while a turn runs, plus a final answer. Questions become buttons or a request for a reply.

**Where it fits:** It implements the `ModeHost` contract from `core/mode.ts`, so any mode can run in Telegram without knowing it. It builds a [TurnView](view/turn-view.ts.md) for each turn. [chat-controller.ts](chat-controller.ts.md) owns the chat around it.

> This doc covers the parts that use the model provider. More sections will be added as the file changes.

---

### Errors outside a turn

```ts
case "error":
    return [errorHtml(event.message, event.hint, this.core.settings.llmProfile)];
```

**What it does:** When an error event arrives outside a running turn, it is turned straight into an HTML block, worded for the active [provider profile](../../core/llm/profiles.ts.md).

**Why it's used here:** The host has access to `core.settings`, so it is the right place to pick up the profile and pass it down.

---

### `beginTurn()`

```ts
beginTurn(): void {
    this.turn = { view: new TurnView(this.core.settings.llmProfile), live: undefined, startedAt: this.clock.now() };
    void this.messenger.typing();
}
```

**What it does:** Starts a new turn: a fresh `TurnView` (given the provider profile), no live message yet, and the start time from an injected clock. Then it shows "typing…" in the chat. `void` says "start this promise, I don't need to wait for it".

**Why it's used in general:** Injecting a clock (instead of calling `Date.now()` directly) lets tests control time.

**Why it's used here:** Every turn's error advice matches `YUVI_LLM`, because the profile is passed in when the view is made.

---

### 🧠 Key takeaways
- `TelegramHost` is the `ModeHost` for one chat.
- It reads the provider profile from settings and passes it to the views.
- Time comes from an injected clock, which makes tests predictable.
