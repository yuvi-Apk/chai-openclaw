# cspell.json

**Purpose:** Settings for **CSpell**, a spell checker for code. It lists project words that are spelled correctly, even though a dictionary doesn't know them, so your editor stops underlining them.

**Where it fits:** It doesn't affect how `yuvi` runs. It only helps while you're writing code and docs. It sits next to other "helper" configs like [.prettierrc](.prettierrc.md). See [concepts/cspell.md](../concepts/cspell.md).

---

### Version and language

```json
"version": "0.2",
"language": "en",
```

**What it does:** `version` is the config format version CSpell expects. `0.2` is the current one. `language: "en"` means "check against English".

**Why it's used in general:** Every cspell config starts like this so the tool reads it correctly.

**Why it's used here:** All the code and docs in this project are in English.

---

### Custom words

```json
"words": [
  "appwrite", "megablog", "chai", "tinymce", "reduxjs",
  "bunfig", "tailwindcss", "dotenv", "exmple", "sgp",
  "yuvi", "openclaw"
],
```

**What it does:** It is a personal dictionary. Any word listed here is treated as correct.

**Why it's used in general:** Code is full of names like library names, brands, and abbreviations that no dictionary has. Without this list, you would see hundreds of false "spelling mistakes".

**Why it's used here:** `yuvi`, `openclaw`, and `chai` are this project's own names. Others, like `bunfig` and `dotenv`, are tool names. Some words, like `appwrite` and `megablog`, look carried over from another project, which is fine because the list is shared.

💡 **Tip:** Adding a word here hides the warning for that exact spelling everywhere. Only add words that are truly correct. Otherwise a real typo can hide behind it.

---

### Ignoring patterns and paths

```json
"ignoreRegExpList": ["\\b[0-9a-f]{20}\\b"],
"ignorePaths": ["node_modules", "dist", "bun.lock"]
```

**What it does:**
- `ignoreRegExpList`: skip any text matching this **regular expression**. Here that means a 20-character run of hex characters (`0-9`, `a-f`), like an ID or hash. `\\b` means "word boundary". The `\` is doubled because JSON strings need escaping.
- `ignorePaths`: don't spell-check these folders and files at all.

**Why it's used in general:** Random IDs and generated files aren't real words, and checking them just creates noise.

**Why it's used here:** `node_modules` (installed packages), `dist` (build output), and `bun.lock` (the lockfile) aren't written by you, so checking them is pointless.

---

### 🧠 Key takeaways
- CSpell catches typos in code. `cspell.json` tunes it for this project.
- `words` is your project dictionary for names like `yuvi` and `openclaw`.
- `ignoreRegExpList` and `ignorePaths` skip things that aren't real words.
- It's an editor helper. It doesn't change how the app runs.
