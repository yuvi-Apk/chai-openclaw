# CSpell: spell-checking your code

**CSpell** is a spell checker made for code. It understands `camelCase` and `snake_case`, so it splits `getUserName` into `get`, `User`, and `Name` and checks each part. It runs in your editor (for example, the "Code Spell Checker" VS Code extension) or from the command line (`npx cspell "**/*.ts"`).

## Why bother?
Typos in code are sneaky. A misspelled variable might still "work", but it confuses readers and breaks searches. A typo in user-facing text looks unprofessional. CSpell catches both while you type.

## The config file
CSpell looks for a `cspell.json` file in your project. Common keys:

| Key | Meaning |
|---|---|
| `version` | Config format version (use `"0.2"`). |
| `language` | Dictionary language, such as `"en"`. |
| `words` | Your project's "these are correct" list. |
| `ignorePaths` | Files and folders to skip entirely. |
| `ignoreRegExpList` | Regex patterns to skip, such as hashes and IDs. |

💡 **Tip:** In VS Code, you can right-click an underlined word and choose "Add to workspace dictionary". That updates `cspell.json` for you.

**Used in:** [files/cspell.json.md](../files/cspell.json.md)
