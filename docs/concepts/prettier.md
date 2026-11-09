# Prettier: automatic code formatting

## What is it?
**Prettier** is an "opinionated code formatter". You write code however you like, and Prettier rewrites the *layout* (quotes, spaces, line breaks, semicolons) into a consistent style.

It's like autocorrect for code style. It never changes what your code *does*, only how it *looks*.

## How it's configured
- **`.prettierrc`**: the style rules (quotes, indent size, and so on).
- **`.prettierignore`**: files to skip, using the same syntax as [.gitignore](gitignore.md).

## Common commands
```bash
bunx prettier --check .   # report files that aren't formatted
bunx prettier --write .   # format everything in place
```
Most editors (like VS Code with the Prettier extension) can also format on save.

## In this project
- Rules: [.prettierrc](../files/.prettierrc.md): double quotes, semicolons, 2-space indent.
- Skips: [.prettierignore](../files/.prettierignore.md).
- Installed through [package.json](../files/package.json.md).
