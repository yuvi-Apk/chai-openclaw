# The OS credential vault (keeping secrets out of files)

Every modern operating system has a **safe box for passwords** built in:

| System | Name | Where to look |
|---|---|---|
| Windows | Credential Manager | Control Panel → Credential Manager → Windows Credentials |
| macOS | Keychain | the "Keychain Access" app |
| Linux | Secret Service (libsecret), e.g. GNOME Keyring or KWallet | "Passwords and Keys" (Seahorse) |

Apps put secrets there instead of writing them into text files. Git, the GitHub CLI, browsers and VS Code all do this.

## Why not just a text file?

A file like `~/.yuvi/settings.json` is plain text. Anyone or anything that can read your home folder can read it: a backup tool, a sync service, a script, or an AI agent that was told to "look around". The vault is different:

- It is **encrypted** with your login.
- It is unlocked only while you're logged in.
- Programs ask for a secret **by name**; they don't browse files.

An analogy: a text file is a key under the doormat. The vault is a safe that opens only when you're home.

## How a program talks to it

Each secret has two labels: a **service** (the app, like `"yuvi"`) and a **name** (which secret, like `"openai"`). In Bun this is built in:

```ts
await Bun.secrets.set({ service: "yuvi", name: "openai", value: "sk-..." });
const key = await Bun.secrets.get({ service: "yuvi", name: "openai" }); // string or null
await Bun.secrets.delete({ service: "yuvi", name: "openai" });
```

All three are [async](async-await.md), because they talk to the operating system.

## Things to plan for

- **No vault.** A Linux server may have no keyring service, so the call throws. Have a fallback (yuvi then uses the settings file and warns you).
- **Tests.** A test must never touch your real secrets. Hide the vault behind an interface and give tests an in-memory version.
- **Async reads.** Reading the vault on every use would make every getter `async`. Load the secrets once at start and keep a copy in memory.
- **Old data.** If an older version saved secrets in a file, move them into the vault on the next start and remove them from the file (a small *migration*).

## Where this project uses it

- [core/security/key-store.ts](../files/core/security/key-store.ts.md): `KeyStore`, `OsKeyStore` (Bun.secrets), `MemoryKeyStore` and `KeyRing`.
- [core/config.ts](../files/core/config.ts.md): `loadKeys()`, `saveApiKey()`, `forgetKey()` and `keySource()`.
- [frontends/terminal/login.ts](../files/frontends/terminal/login.ts.md): logging in and out saves to and removes from the vault.
- Related: [user-settings-file.md](user-settings-file.md) and [environment-variables.md](environment-variables.md).

## 🧠 Key takeaways
- The OS vault is an encrypted, per-user safe for secrets, built into every OS.
- Each secret is found by a service name plus a secret name.
- Put it behind an interface, so tests use memory and machines without a vault fall back.
- Load once, read from memory, and migrate old file secrets into it.
