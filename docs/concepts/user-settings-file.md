# User settings files (config in the home folder)

Many command-line tools remember your personal settings in a small file inside your **home folder**. Git has `~/.gitconfig`, npm has `~/.npmrc`, and `yuvi` has `~/.yuvi/settings.json`.

## Why the home folder?

The `~` sign means "my home folder": `C:\Users\you` on Windows, `/home/you` on Linux, `/Users/you` on macOS.

Compare the two places a setting can live:

| Place | Scope | Good for |
|---|---|---|
| `.env` or a config file **in the project** | this one project | things that differ per project |
| a file **in the home folder** | every project, for this user | personal things: your API key, your favourite model |

An analogy: a project file is a note pinned to one office door. A home-folder file is a note in your own wallet. It goes wherever you go.

## Finding the home folder in code

```ts
import path from "node:path";
import { homedir } from "node:os";

const settingsFile = path.join(homedir(), ".yuvi", "settings.json");
```

`homedir()` gives the right folder on every operating system. `path.join` uses the right slash. Never hard-code `C:\Users\...`. See [node-fs-path.md](node-fs-path.md).

The leading dot in `.yuvi` is a convention: on Linux and macOS, names that start with a dot are hidden from normal file listings.

## The read → merge → write pattern

To change one setting without losing the others:

```ts
const next = { ...readSettings(), ...patch };          // old values, new ones on top
fs.mkdirSync(path.dirname(file), { recursive: true }); // make the folder if needed
fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
```

And to read safely when the file may not exist yet:

```ts
try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
    return {};   // no file yet is normal
}
```

## Layers: who wins?

Tools usually read settings from several places and let the **most specific** one win. In `yuvi` the order is:

1. [Environment variables](environment-variables.md) (including the project's `.env`)
2. `~/.yuvi/settings.json`
3. Built-in defaults

So a project can still override your personal choice when it needs to.

## Keeping secrets safe

A settings file with an API key is sensitive.

- `mode: 0o600` means "only the owner can read and write". This works on Linux and macOS. Windows mostly ignores it and relies on your user folder's own protection.
- The file is outside every project, so it cannot be committed to Git by accident.
- It is still plain text. Anyone who can log in as you can read it.

## Where this project uses it

- [ai/ai.config.ts](../files/ai/ai.config.ts.md): `readUserSettings`, `saveUserSettings`, and `applyUserSettings`.
- [modes/agent/orchestrator.ts](../files/modes/agent/orchestrator.ts.md): asks for your key on first run and saves your model choice from the menu.

## 🧠 Key takeaways
- Per-user settings live in a hidden folder in the home directory and work in every project.
- Use `homedir()` and `path.join` to build the path.
- Update with read → merge → write, and treat a missing file as empty settings.
- Settings come in layers: environment first, user file second, defaults last.
