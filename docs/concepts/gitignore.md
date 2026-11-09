# Ignore-file patterns (`.gitignore` style)

## What is it?
An ignore file lists patterns for files a tool should skip. Git uses `.gitignore`, and Prettier uses `.prettierignore` with the same rules.

## Pattern cheat sheet
| Pattern | Matches |
|---|---|
| `node_modules` | any file or folder named `node_modules`, anywhere |
| `/dist` | only `dist` at the project root |
| `dist/` | only folders named `dist` |
| `*.log` | any file ending in `.log` |
| `.env.*` | `.env.local`, `.env.test`, and so on |
| `# comment` | a comment line |
| `!keep.log` | **un**-ignore something matched earlier |

## 💡 Tips
- `.gitignore` only affects **untracked** files. If a file was already committed, remove it with `git rm --cached <file>`.
- `./path` is not standard ignore syntax. Use `/path` for "from the root".

## In this project
- [.gitignore](../files/.gitignore.md) keeps `node_modules`, build output, and `.env` secrets out of Git.
- [.prettierignore](../files/.prettierignore.md) keeps Prettier away from packages, YAML, and env files.
