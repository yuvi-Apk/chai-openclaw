# frontends/telegram/app.ts

**Purpose:** Starts the **Telegram bot**. It runs on your PC, asks Telegram for new messages and answers them; the phone is only the screen and keyboard.

**Where it fits:** `index.ts` calls `runTelegram(registry)`. It reads the Telegram settings, loads the API keys through [core/config.ts](../../core/config.ts.md), builds the shared services, and hands each update to the router. Keys are never set from Telegram; you log in on your PC with [login.ts](../terminal/login.ts.md).

> This doc covers the start-up checks. More sections will be added as the file changes.

---

### Start-up: a key must be there first

```ts
await settings.loadKeys();
if (!settings.hasKey(settings.llmProvider)) {
    console.error(
        `There is no ${settings.llmProfile.label} key yet. Run "yuvi wakeup", choose CLI and log in, then start the bot again.`,
    );
    return;
}
```

**What it does:** After the Telegram settings load, it reads every provider's key from the [OS vault](../../../concepts/os-credential-vault.md) (`loadKeys()`). If the provider in use still has no key, it prints how to log in from the terminal and stops, before connecting to Telegram at all.

**Why it's used in general:** Checking what you need *before* you start (a "pre-flight check") gives a clear message instead of a confusing failure later.

**Why it's used here:** Without a key, every chat message would fail. Since keys must never be typed into Telegram, the only fix is on the PC, so the bot says so right away. `loadKeys()` is needed because the vault is async and `Settings` can't read it in its constructor.

---

### 🧠 Key takeaways
- The bot loads keys from the vault before it starts.
- No key for the provider in use → a clear "log in with `yuvi wakeup`" message, and the bot doesn't start.
- Keys are only ever set on the PC, never through Telegram.
