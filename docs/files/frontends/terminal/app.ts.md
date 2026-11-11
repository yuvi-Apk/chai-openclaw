# frontends/terminal/app.ts

**Purpose:** The terminal's **main menu**. It lists whatever modes are registered (without knowing any of them by name), plus **Log in**, **Log out**, **Help** and **Exit**. Before the menu, a user with no key is welcomed and logged in.

**Where it fits:** `index.ts` calls `runTerminal(registry)` when you choose CLI. Picking a mode runs it with [session-loop.ts](session-loop.ts.md). Logging in and out is [login.ts](login.ts.md). Settings and keys come from [core/config.ts](../../core/config.ts.md). Menus use [@clack/prompts](../../../concepts/clack-prompts.md); colours use [chalk](../../../concepts/chalk-terminal-colors.md).

---

### Menu values: `HELP`, `LOGIN`, `LOGOUT`, `EXIT`

```ts
const HELP = "__help__";
const LOGIN = "__login__";
const LOGOUT = "__logout__";
const EXIT = "__exit__";
```

**What it does:** Special values for the menu items that aren't modes. The double underscores make sure they can't clash with a real mode name like `"chat"`.

**Why it's used in general:** Naming "magic strings" once at the top means a typo becomes a compile error, not a silent bug.

---

### Start: load keys, warn, log in

```ts
const settings = new Settings();
await settings.loadKeys();
if (!settings.keyVaultWorks) {
    log.warn("This computer has no credential vault yuvi can use, so keys are kept in ~/.yuvi/settings.json.");
}
const modes = registry.list({ includeHidden: settings.devMode });
if (process.stdin.isTTY) await ensureLoggedIn(settings);
```

**What it does:**
1. Creates the settings and loads every provider's key from the [OS vault](../../../concepts/os-credential-vault.md). Old keys left in the settings file move into the vault here.
2. If the vault isn't usable on this machine, warns you that keys stay in the file.
3. Lists the modes; hidden ones (like Echo) only in dev mode (`YUVI_DEV=1`).
4. If a real person is at the keyboard, makes sure the provider in use has a key. A brand-new user sees "Welcome to yuvi!" and is asked to pick a provider and paste a key.

**Why it's used here:** Logging in *before* the menu means the first thing you try just works. `isTTY` is false in scripts, where nobody could answer.

---

### The menu loop

```ts
const picked = await select<string>({
    message: `What do you want to do? ${chalk.dim(`(${loginStatus(settings)})`)}`,
    options: [ /* ...modes, Log in, Log out, Help, Exit */ ],
});

if (isCancel(picked) || picked === EXIT) break;
if (picked === HELP) showHelp();
else if (picked === LOGIN) await logInTo(settings, undefined, true);
else if (picked === LOGOUT) await logOut(settings);
else {
    const mode = registry.get(picked);
    if (!mode) continue;
    await runModeSession(mode);
    // The session may have switched provider or logged in; show the latest.
    await settings.loadKeys();
    log.step(chalk.gray("Back to the menu."));
}
```

**What it does:**
- The question shows who you're logged in to, dimmed, like "(Logged in to Claude · claude-sonnet-5-5)".
- **Log in** calls `logInTo(settings, undefined, true)`: `undefined` means "use the default (real terminal) prompts", and `true` means "ask for a new key even if one exists", so you can change a key.
- **Log out** removes a saved key.
- A mode runs in its own session. When you come back, `loadKeys()` runs again, because the session uses its own `Settings` object and may have switched provider or logged in.

**Why it's used in general:** Passing `undefined` to a parameter makes JavaScript use its default value. It's how you skip a middle argument.

**Why it's used here:** The menu line always tells the truth about your login, even after you changed things inside a mode.

---

### 🧠 Key takeaways
- The menu lists modes from the registry; it knows none of them by name.
- Keys are loaded from the vault at start, and again after each mode session.
- A user with no key is welcomed and logged in before the menu appears.
- Log in and Log out are always one menu item away.
