# Shebang (`#!`)

## What is it?
A **shebang** is a special first line in a script file that starts with `#!`. It tells the operating system which program should run the file.

```ts
#!/usr/bin/env bun
```

Picture a note stuck on a parcel saying "deliver to Bun".

## How it works
- `#!`: the magic marker. The OS only checks the first two characters of the file.
- `/usr/bin/env`: a helper that searches your `PATH` for a program.
- `bun`: the program to find and use.

Using `env` instead of a fixed path like `/home/me/.bun/bin/bun` means it works on any machine, wherever Bun is installed.

## Common examples
```bash
#!/usr/bin/env node     # Node.js scripts
#!/usr/bin/env python3  # Python scripts
#!/bin/bash             # Bash scripts
```

## Rules to remember
- It must be the **very first line**, with nothing before it.
- On macOS and Linux, the file also needs execute permission (`chmod +x`). Package managers handle this for `bin` entries.
- On Windows, the OS ignores shebangs, but Bun and npm create wrapper scripts that read them.

## In this project
[index.ts](../files/index.ts.md) starts with `#!/usr/bin/env bun`, so the `yuvi` command (from [package.json bin](package-json-bin.md)) runs with [Bun](bun-runtime.md).
