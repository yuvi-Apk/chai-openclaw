# frontends/telegram/chat-controller.ts

**Purpose:** Manages **one Telegram chat**: which mode is open, the session with it, and the turn that is running. It knows the `Mode` contract and nothing about any particular mode.

**Where it fits:** It uses [host.ts](host.ts.md) for the mode's host and a messenger to send replies. Settings come from [core/config.ts](../../core/config.ts.md) through `deps.core`.

> This doc covers the parts that use the model provider. More sections will be added as the file changes.

---

### `changeModel()`: the `/model` command

```ts
async changeModel(): Promise<void> {
    const { settings } = this.deps.core;
    await this.messenger.send(
        `Current model: <code>${escapeHtml(settings.modelId("main"))}</code>\nSend the new model id (from ${escapeHtml(settings.llmProfile.modelsUrl)}), or /cancel.`,
    );
    const id = (await this.deps.questions.text(this.deps.chatId))?.trim();
    if (!id) return;
    if (!MODEL_ID.test(id)) return void (await this.messenger.send("✗ That does not look like a model id. Nothing was changed."));
    settings.saveModel(id);
    await this.messenger.send(`✓ Model changed to <code>${escapeHtml(settings.modelId("main"))}</code> and saved.`);
}
```

**What it does:**
1. Shows the current model and links to the active provider's model list.
2. Waits for your reply. `?.trim()` only trims if a reply came back (`?.` is **optional chaining**).
3. Checks the reply looks like a model id (the `MODEL_ID` regular expression). If not, nothing changes.
4. Saves it with `saveModel`, which writes to the active provider's field, and confirms.

**Why it's used in general:** Text from a chat is untrusted input, so it is checked before use. `escapeHtml` stops it from breaking the HTML message.

**Why it's used here:** The link and the saved field both follow `YUVI_LLM`. So OpenAI users are sent to OpenAI's model page, and their choice doesn't overwrite the OpenRouter model.

---

### 🧠 Key takeaways
- One `ChatController` per chat; it only knows the `Mode` contract.
- `/model` checks the reply before saving it.
- The model is saved for the provider in use, with a link to that provider's model list.
