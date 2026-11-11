# frontends/telegram/chat-controller.ts

**Purpose:** Manages **one Telegram chat**: which mode is open, the session with it, and the turn that is running. It knows the `Mode` contract and nothing about any particular mode.

**Where it fits:** It uses [host.ts](host.ts.md) for the mode's host and a messenger to send replies. Settings come from [core/config.ts](../../core/config.ts.md) through `deps.core`. The commands in [commands.ts](commands.ts.md) call its methods; the model menus live in [model-settings.ts](model-settings.ts.md).

> This doc covers the parts that use the model provider. More sections will be added as the file changes.

---

### `modelMenu`: what the model menus need

```ts
/** What /provider, /model and /effort need (model-settings.ts). */
get modelMenu(): ModelMenuContext {
    const { chatId, core, questions } = this.deps;
    return { chatId, settings: core.settings, messenger: this.messenger, questions, log: core.log };
}
```

**What it does:** A **getter** that packs up exactly the five things the menus need: which chat, the settings, the messenger (to send messages), the questions helper (to wait for a button press or a reply), and the logger. `{ chatId, core, questions } = this.deps` is **destructuring**: it pulls three fields out of `deps` into local names.

**Why it's used in general:** Giving a helper a small "context" object, instead of the whole controller, is the **I** in SOLID (small interfaces): the helper can only touch what it was given.

**Why it's used here:** The controller was getting too big. Moving `/provider`, `/model` and `/effort` into [model-settings.ts](model-settings.ts.md) keeps this file focused on mode, session and turn. The controller only has to hand over the context.

---

### `refuseKey()`: keys never travel through the chat

```ts
async refuseKey(): Promise<void> {
    await this.messenger.send(
        "🔑 Keys are never set from Telegram: a key typed here would stay in the chat history. Log in on your PC: run yuvi wakeup in the terminal and choose “Log in”.",
    );
}
```

**What it does:** Sends one friendly message when someone tries to set a key in the chat (the hidden `/key` command in [commands.ts](commands.ts.md)). It explains *why* not, and points to the terminal's **Log in** menu item ([login.ts](../terminal/login.ts.md)).

**Why it's used in general:** Chat messages are kept on the chat service's servers. A secret pasted there stays there, even if you delete it later.

**Why it's used here:** The terminal can check a key and lock it in the OS credential vault. Telegram can't do that safely, so it simply says no and shows you the safe way.

---

### 🧠 Key takeaways
- One `ChatController` per chat; it only knows the `Mode` contract.
- The model menus are not in this file; it just provides `modelMenu`.
- Keys are refused in chat, with a pointer to logging in on your PC.
- A small context object keeps the menu code from depending on the whole controller.
