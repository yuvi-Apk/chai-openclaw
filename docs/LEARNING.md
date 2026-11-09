# 📚 chai-openclaw — Learning Journal

This file is written automatically by **Code Buddy** every time you commit.
Each entry explains *what* you built, *why* it exists, and *why* each tool/pattern is used —
like a teacher walking through your code. Newest entries are at the bottom.


---

<sub>🗓️ 2026-11-09 16:53</sub>

## Adding your first npm script: `explain`

### What you built

You added a `"scripts"` section to `package.json` with one entry called `explain`. Now, instead of typing `bash scripts/explain-staged.sh` every time, you can type a short command:

```bash
bun run explain
```

It works like a speed-dial button on a phone. You save a long number once under a short name, then press the name whenever you need it.

### The snippet, line by line

```json
"scripts": {
  "explain": "bash scripts/explain-staged.sh"
},
```

- `"scripts"`: a special field that package managers (npm, yarn, pnpm, and Bun) know how to read. Each key in it is a command name you choose.
- `"explain"`: the name you'll type after `bun run`.
- `"bash scripts/explain-staged.sh"`: the actual shell command that runs. Here it starts **bash** and runs your helper script. That script takes your staged changes and gets them explained, which is how this explanation was produced.

### What `scripts` is used for in general

Almost every JS/TS project has a `scripts` section. Common examples:

```json
"scripts": {
  "dev": "bun --watch index.ts",
  "test": "bun test",
  "format": "prettier --write .",
  "build": "bun build index.ts --outdir dist"
}
```

Scripts are useful for a few reasons:

1. **Short names for long commands.** You don't need to remember flags.
2. **A shared vocabulary.** Anyone who clones your repo can open `package.json` and see what they can run. `dev`, `test`, and `build` are names developers recognise straight away.
3. **Local tools work without global installs.** When a script runs, `node_modules/.bin` is added to the PATH. So `"format": "prettier --write ."` works even if Prettier is only installed in this project.

### Why it's used here

You're building a learning workflow around the `yuvi` CLI. There's a `.githooks/pre-commit` hook, a `scripts/explain-staged.sh` script, and a `teacher-prompt.md`. The `explain` script gives you a manual way to trigger that explainer whenever you want, separate from the automatic pre-commit hook. One piece of logic now has two entry points: the hook, and `bun run explain`.

### `scripts` vs `bin`: they look alike but do different jobs

Your `package.json` now has both fields, and they're easy to mix up:

```json
"scripts": { "explain": "bash scripts/explain-staged.sh" },
"bin":     { "yuvi": "./index.ts" }
```

| Field | Who uses it | How it's run |
|---|---|---|
| `scripts` | **You, the developer**, while working on the project | `bun run explain` |
| `bin` | **Users** who install your package | They type `yuvi` directly in their terminal |

So `scripts` are tools for building the project, and `bin` is the product you're shipping.

💡 **Tip: bash on Windows.** You're on Windows, and `bash` isn't built into Windows. It works here because Git for Windows installs Git Bash. If someone without Git Bash runs `bun run explain`, they'll get a "bash not found" error. This is a common cross-platform gotcha. Later you could rewrite the helper as a `.ts` file and run it with `bun scripts/explain-staged.ts`, which works the same on every OS.

💡 **Tip: commit the helper files too.** Only `package.json` is staged right now. `scripts/`, `.githooks/` and `.claude/` are still untracked. If you commit just this change, the `explain` command will point to a file that doesn't exist in the repo for anyone else who clones it.

💡 **Tip: shortcuts.** Bun lets you skip `run` for most script names, so `bun explain` usually works too. With npm, the full form is `npm run explain`.

### 🧠 What you learned
- The `scripts` field in `package.json` gives short names to shell commands, and you run them with `bun run <name>`.
- Scripts are the standard way JS/TS projects document and share developer tasks like `dev`, `test`, `build`, and `format`.
- `scripts` are for developers working on the project, while `bin` defines the commands your package's users get.
- While a script runs, project-local tools in `node_modules/.bin` are on the PATH automatically.
- Shell commands like `bash` may not exist on every OS, so cross-platform scripts often use the runtime itself (`bun some-file.ts`).

### ➡️ Natural next step
Add a `"dev": "bun --watch index.ts"` script so the `yuvi` CLI restarts every time you save. Then stage and commit your `scripts/` and `.githooks/` folders so the `explain` command works for anyone who clones the repo.

---

<sub>🗓️ 2026-11-09 16:57</sub>

## Building "Code Buddy": an automatic teacher that runs on every commit

### What you just built (the big picture)

This change doesn't add a feature to `yuvi` itself. It adds a **learning system around your project**. From now on, every time you run `git commit`:

1. Git runs a **pre-commit hook** before it saves the commit.
2. The hook runs a **shell script** (`scripts/explain-staged.sh`).
3. The script collects the changes you're about to commit and sends them, along with a **teacher prompt**, to the `claude` CLI.
4. Claude writes a lesson, and the script **appends it to `docs/LEARNING.md`** and adds that file to the same commit.

Think of it like a tutor looking over your shoulder. Each time you hand in homework (a commit), they write a note in your notebook explaining what you just did. Over time, `LEARNING.md` becomes a diary of everything you've built and learned.

There are four pieces, and each has one job:

| File | Job |
|---|---|
| `.githooks/pre-commit` | The trigger. Git calls it automatically. |
| `scripts/explain-staged.sh` | The worker. It gathers the diff, calls Claude and writes the doc. |
| `scripts/teacher-prompt.md` | The instructions. It tells Claude *how* to teach. |
| `.claude/agents/code-buddy.md` | The same teacher, available on demand inside Claude Code. |
| `package.json` → `scripts.explain` | A shortcut to run it by hand. |

---

### 1. The Git hook: `.githooks/pre-commit`

```bash
#!/usr/bin/env bash
# Runs Code Buddy before each commit so docs/LEARNING.md explains what you're committing.
bash "$(git rev-parse --show-toplevel)/scripts/explain-staged.sh" || true
exit 0
```

**What are Git hooks in general?**
Git hooks are scripts that Git runs automatically at certain moments, such as before a commit, before a push or after a merge. Teams commonly use them to run linters, formatters or tests before code gets committed. Tools like **Husky** and **lefthook** are popular in the JS world for managing them.

**Line by line:**
- `#!/usr/bin/env bash` is a **shebang**. It tells the operating system to run this file with `bash`. Writing `/usr/bin/env bash` instead of `/bin/bash` means "find bash wherever it's installed", which makes the script more portable.
- `git rev-parse --show-toplevel` prints the root folder of your repo. With it, the hook finds the script no matter which folder you commit from.
- `|| true` means "if the script fails, pretend it succeeded."
- `exit 0` matters most. A pre-commit hook that exits with a **non-zero** code **cancels the commit**. Ending with `exit 0` guarantees Code Buddy can never block you from committing.

**Why it's built this way here:** Code Buddy is a *helper*, not a gatekeeper. If Claude is slow, offline or broken, your commit should still go through. Lint hooks are usually *meant* to block bad commits; this one deliberately never does.

> 💡 **Tip:** Git doesn't look in `.githooks/` by default. It looks in `.git/hooks/`, which isn't shared with the repo. To tell Git to use your folder, run this once:
> ```bash
> git config core.hooksPath .githooks
> ```
> The diff also shows the file mode as `100644` (not executable). Git Bash on Windows is usually forgiving about this, but on macOS/Linux a hook has to be executable to run. You can mark it executable inside Git with `git update-index --chmod=+x .githooks/pre-commit`.

---

### 2. The worker script: `scripts/explain-staged.sh`

This is the heart of the change. Let's walk through it in pieces.

#### Safety settings and an escape hatch

```bash
set -euo pipefail

[ "${SKIP_BUDDY:-0}" = "1" ] && exit 0
```

- `set -euo pipefail` is often called **"bash strict mode"**:
  - `-e`: stop as soon as any command fails.
  - `-u`: treat an undefined variable as an error, so typos don't silently become empty strings.
  - `-o pipefail`: if any command in a pipe (`a | b | c`) fails, the whole pipe counts as failed.
- `${SKIP_BUDDY:-0}` means "use the value of `SKIP_BUDDY`, or `0` if it isn't set." The `:-` syntax is a **default value** in bash. You need it here because `-u` would otherwise complain about the unset variable.

This gives you a one-time off switch: `SKIP_BUDDY=1 git commit -m "quick fix"`.

#### Getting the diff, without the noise

```bash
DIFF="$(git diff --cached -- . ':!bun.lock' ':!docs/LEARNING.md' ':!*.lock' || true)"

if [ -z "$DIFF" ]; then
  exit 0
fi
```

- `git diff --cached` shows what's **staged**: the changes you `git add`-ed and are about to commit. Without `--cached`, you'd see unstaged changes instead.
- `':!bun.lock'` is a **pathspec exclusion**. The `:!` prefix means "everything except this."
- Excluding `docs/LEARNING.md` matters. Without it, Code Buddy would explain its own lesson file next time, which is pointless.
- `[ -z "$DIFF" ]` checks whether the string is empty. If nothing meaningful is staged, there's nothing to teach, so the script exits early.

#### Checking that the tool exists

```bash
if ! command -v claude >/dev/null 2>&1; then
  echo "[code-buddy] 'claude' CLI not found — skipping explanation."
  exit 0
fi
```

`command -v claude` asks the shell whether it can find a program called `claude`. `>/dev/null 2>&1` throws away all output, since you only care about yes or no. This is a standard way to check for a dependency in shell scripts. Here it means a teammate (or a CI server) without Claude installed can still commit normally.

#### Building the prompt and calling Claude

```bash
DIFF="$(printf '%s' "$DIFF" | head -c 60000)"
...
if ! LESSON="$(printf '%s' "$INPUT" | claude -p 2>/dev/null)" || [ -z "$LESSON" ]; then
  echo "[code-buddy] Couldn't generate an explanation — commit continues anyway."
  exit 0
fi
```

- `head -c 60000` keeps only the first 60,000 characters. A huge diff (say, a generated file) would be slow and expensive to send, so it gets trimmed.
- `printf '%s'` is a safer `echo`. It prints the text exactly as-is, even if it starts with `-` or contains backslashes.
- `claude -p` runs Claude in **print mode**: it reads a prompt, prints one answer and exits. That makes it usable inside scripts.
- `$( ... )` is **command substitution**. It runs a command and captures its output into a variable, here `LESSON`.

The `INPUT` variable glues together three things: the teacher prompt, the list of project files (`git ls-files`) and the diff wrapped in a ```` ```diff ```` block. That's how Claude gets both the instructions and the context.

#### Writing to the learning journal

```bash
{
  printf '\n---\n\n'
  printf '<sub>🗓️ %s</sub>\n\n' "$(date '+%Y-%m-%d %H:%M')"
  printf '%s\n' "$LESSON"
} >> "$DOC"

git add "$DOC"
```

- `{ ... } >> file` groups several commands and **appends** all their output to the file at once. A single `>` would *overwrite* the file instead.
- Each entry gets a divider (`---`) and a timestamp, so the journal reads like a diary.
- `git add "$DOC"` stages the updated journal, so the lesson goes into **the same commit** as the code it explains. Your history and your notes stay in sync.

Earlier in the script, a **heredoc** (`cat > "$DOC" <<'EOF' ... EOF`) creates the file with a nice header the first time. Quoting it as `'EOF'` stops bash from expanding `$variables` inside, so the text is written exactly as typed.

---

### 3. The teacher prompt: `scripts/teacher-prompt.md`

This file holds the instructions you're reading the output of right now. Keeping the prompt in its **own file**, rather than buried in the shell script, is a common pattern called **separating configuration from code**. You can tweak the teaching style (simpler English, more analogies, shorter lessons) without touching any bash.

---

### 4. The Claude Code agent: `.claude/agents/code-buddy.md`

```markdown
---
name: code-buddy
description: Teacher-style explainer for this project. Use when the user asks to explain code...
tools: Read, Glob, Grep, Bash, Edit, Write
---
```

The block between the `---` lines is **YAML frontmatter**, which is metadata at the top of a Markdown file. Many tools use it, such as static site generators like Astro and Next.js MDX, and here Claude Code. This file defines a **subagent** you can call on during interactive Claude Code sessions, for example "explain `index.ts` to me."

The hook gives you **automatic** lessons. The agent gives you **on-demand** lessons. Both point to the same teaching rules in `teacher-prompt.md`, so they stay consistent.

---

### 5. The npm script shortcut

```json
"scripts": {
  "explain": "bash scripts/explain-staged.sh"
},
```

The `scripts` field in `package.json` holds named shortcuts for commands. Every JS project uses it for things like `dev`, `build` and `test`. Now `bun run explain` lets you preview a lesson for your staged changes **without committing**. That's handy when you want to understand something before you lock it in.

Notice it sits right next to your `bin` field (`"yuvi": "./index.ts"`). `scripts` holds commands *for you, the developer*. `bin` declares commands *your package provides to users*.

---

### 🧠 What you learned
- **Git hooks** run scripts automatically at points like pre-commit. Exiting with a non-zero code blocks the commit, so `exit 0` makes a hook "advisory only."
- **Bash strict mode** (`set -euo pipefail`) plus `${VAR:-default}` makes shell scripts fail loudly on real mistakes but still handle optional settings gracefully.
- `git diff --cached` shows *staged* changes, and pathspecs like `':!file'` exclude noise.
- **CLI tools can be chained in scripts.** Piping text into `claude -p` is the same idea as piping into `grep` or `jq`.
- Keeping prompts and config in **separate files** makes them easy to change without editing code.
- `package.json` `scripts` are developer shortcuts, while `bin` defines the commands your package ships to users.

### ➡️ Natural next step
Run `git config core.hooksPath .githooks` so Git actually uses your hook. Then go back to building `yuvi`, for example by adding argument parsing to `index.ts` so `yuvi --help` prints something. Your first real feature lesson will show up in `LEARNING.md`.
