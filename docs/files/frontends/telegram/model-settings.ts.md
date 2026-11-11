# frontends/telegram/model-settings.ts

**Purpose:** Telegram's **model menus**: `/provider`, `/model` and `/effort`, shown as buttons. Each one saves your choice for next time. Keys are **never** typed in Telegram (they would stay in the chat history), so a provider without a key is refused, with advice on how to add one from your PC.

**Where it fits:** [commands.ts](commands.ts.md) runs these functions, passing the `modelMenu` context from [chat-controller.ts](chat-controller.ts.md). The option lists come from [core/llm/choices.ts](../../core/llm/choices.ts.md), the same lists the terminal's [model-menu.ts](../terminal/model-menu.ts.md) uses. Saving goes through [core/config.ts](../../core/config.ts.md).

---

### `ModelMenuContext` and `pick()`

```ts
export interface ModelMenuContext {
    chatId: number;
    settings: Settings;
    messenger: ChatMessenger;
    questions: Questions;
    log: Logger;
}

async function pick<T extends string>(ctx: ModelMenuContext, title: string, choices: Choice<T>[]): Promise<T | null> {
    const rows = choices.map((choice) => [{ label: buttonLabel(choice), value: choice.value }]);
    const { keyboard, answer } = ctx.questions.ask(ctx.chatId, rows);
    await ctx.messenger.send(title, { keyboard });
    return answer;
}
```

**What it does:** `pick` turns a list of choices into one button per row (label like "OpenAI · no key yet"), sends the title with those buttons, and waits for a press. `answer` is a promise that resolves to the pressed value, or `null` if cancelled.

**Why it's used in general:** In Telegram, a message can carry an **inline keyboard**: buttons under the message. Each button carries a hidden value sent back when pressed.

**Why it's used here:** All three menus need "show buttons, wait for one", so it's written once. `<T extends string>` keeps the answer typed: for the effort menu, `T` is `EffortChoice`.

---

### `changeProvider()`: `/provider`

```ts
// A login done in the terminal since the bot started counts, without a restart.
await settings.loadKeys();
const picked = await pick(ctx, title, providerChoices(settings));
if (!picked || picked === settings.llmProvider) return;
if (!settings.hasKey(picked)) {
    return void (await ctx.messenger.send(
        `✗ ${label} has no key yet, so nothing was changed. Keys are never set from Telegram. ` +
            "On your PC run <code>yuvi wakeup</code>, choose “Log in” and pick " + `${label} (yuvi checks the key), ...`,
    ));
}
settings.saveProvider(picked);
ctx.log.event("telegram.provider", { provider: picked });
```

**What it does:**
1. `loadKeys()` re-reads the settings file **and** every key in the OS credential vault ([core/config.ts](../../core/config.ts.md)). So if you log in to Gemini in the terminal *after* the bot started, the bot sees it. The terminal and the bot are separate programs with separate `Settings` objects; the vault is what they share.
2. Shows the providers as buttons, with "in use" / "no key yet" hints.
3. No key → a ✗ message telling you to run `yuvi wakeup` on your PC, choose "Log in" and pick that provider. Nothing changes.
4. Otherwise it switches, logs the event (only the provider name, never a key), and confirms: "✓ Now using **Claude** with `claude-sonnet-5-5`, saved."
5. If `.env` names a provider too, it adds a note that `.env` wins when the bot restarts.

**Why it's used in general:** Chat apps keep messages on their servers, and Telegram bot chats aren't end-to-end encrypted. Secrets should never travel through them.

**Why it's used here:** This is the main difference from the terminal: the terminal *asks* for a missing key, Telegram *refuses* and points you to the terminal.

---

### `changeModel()`: `/model`

```ts
let id = await pick(ctx, title, modelChoices(settings));
if (id === OTHER_MODEL) id = await askModelId(ctx);
if (!id || id === current) return;
if (!MODEL_ID.test(id)) return void (await ctx.messenger.send("✗ That does not look like a model id. Nothing was changed."));
settings.saveModel(id);
```

**What it does:** Buttons for the provider's suggested models, plus "Other…". "Other…" asks you to send an id as a message (`askModelId`), or `/cancel`. A typed id must match `MODEL_ID` (`/^[\w./:@-]{3,120}$/`: letters, digits, `_ . / : @ -`, 3 to 120 characters). Then it is saved for the provider in use.

**Why it's used here:** Text typed into a chat is untrusted input, so it is checked before it's saved. A sentence like "rm -rf everything please" has spaces and fails the check. `escapeHtml` is used on every value put into a message, so nothing can break the HTML.

---

### `changeEffort()`: `/effort`

```ts
const current = currentEffort(settings);
const picked: EffortChoice | null = await pick(ctx, title, effortChoices(settings));
if (!picked || picked === current) return;
saveEffort(settings, picked);
```

**What it does:** Buttons for `default`, `none … max` and `off`. The pick is saved; `default` clears it so each mode chooses again. It confirms with "✓ Effort set to **high**, saved." and the `.env` note if `YUVI_REASONING` is set there.

---

### 🧠 Key takeaways
- Three menus, all built from the shared lists in [core/llm/choices.ts](../../core/llm/choices.ts.md).
- `pick()` turns choices into inline buttons and waits for one press.
- Keys never go through Telegram; a provider without one is refused with advice.
- `loadKeys()` lets the bot see a terminal login without a restart.
- Typed model ids are checked with a regular expression before saving.
