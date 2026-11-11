# README.md

**Purpose:** The project's **front page**. It introduces `yuvi` as an AI coding agent for the terminal, and tells a newcomer what it can do, how to install and configure it, and how the code is laid out.

**Where it fits:** It's the first thing people see on GitHub. It summarises what the source files do, mainly the agent files under `modes/agent/` (start with [orchestrator.ts](modes/agent/orchestrator.ts.md)). For the full learning guide, see [docs/README.md](../README.md).

---

### Intro and features

```md
# chai-openclaw (yuvi)

> **YUVI** — An AI-powered coding agent that lives in your terminal. ...

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Agent Mode** | Multi-step AI agent that can explore, analyze, and modify your codebase using a tool loop |
| **Approval-First** | All file/folder mutations and shell commands are staged and require explicit user approval before applying |
| **Diff Preview** | See unified diffs before accepting changes |
```

**What it does:** A one-line pitch (in a `>` quote block), then a table of the main features: agent mode, approval-first changes, the terminal UI, the codebase tools, skills, OpenRouter, and diff previews.

**Why it's used in general:** Readers decide in seconds whether a project is for them. A short pitch and a feature table answer "what is this?" quickly. Markdown tables are built with `|` between columns and a `---` row under the header.

**Why it's used here:** It states the project's main promise up front: the agent can change your code, but only after you approve. That idea is explained in [staged-changes-and-approval.md](../concepts/staged-changes-and-approval.md).

---

### Architecture

```
yuvi (CLI entry)
├── wakeup.ts           # ASCII banner + mode picker (CLI / Telegram*)
├── cli.ts              # Main CLI loop: Agent / Plan / Chat / Help
└── agent/
    ├── orchestrator.ts # Runs the AI agent loop (ToolLoopAgent from Vercel AI SDK)
    ├── agent-tools.ts  # Tool definitions (read_file, create_file, execute_shell, etc.)
    ├── tool-executor.ts# Safe execution sandbox + staging overlay
    ├── action-tracker.ts# Logs every action with status (pending/approved/rejected)
    ├── approval.ts     # Interactive review: accept all / review one-by-one / diff
    ├── diff-view.ts    # Unified diff formatting for previews
    └── types.ts        # TypeScript types for actions, config, status
```

**What it does:** A tree drawing of the main pieces, each with a one-line job description. A footnote says Telegram mode is a placeholder.

**Why it's used in general:** A small map helps contributors find the right file before they read any code.

**Why it's used here:** Each line matches a doc in this folder: [wakeup.ts](terminal-ui/wakeup.ts.md), [cli.ts](modes/cli.ts.md), [orchestrator.ts](modes/agent/orchestrator.ts.md), [agent-tools.ts](modes/agent/agent-tools.ts.md), [tool-executor.ts](modes/agent/tool-executor.ts.md), [action-tracker.ts](modes/agent/action-tracker.ts.md), [approval.ts](modes/agent/approval.ts.md), [diff-view.ts](modes/agent/diff-view.ts.md), and [types.ts](modes/agent/types.ts.md).

---

### Quick start: install, configure, run

```bash
bun install

# .env file in the project root
YUVI_LLM=openrouter                         # or openai
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxx
OPENROUTER_DEFAULT_MODEL=openrouter/auto
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
OPENAI_DEFAULT_MODEL=gpt-5-mini

bun run index.ts
```

**What it does:**
- **Prerequisites:** [Bun](../concepts/bun-runtime.md) and an API key from *either* [OpenRouter](../concepts/openrouter.md) (has free models) or OpenAI (prepaid credit).
- **Install:** clone the repo, then `bun install` downloads everything listed in [package.json](package.json.md).
- **Configure:** put your settings in a `.env` file. Bun loads it automatically. See [environment-variables.md](../concepts/environment-variables.md). `YUVI_LLM` picks the provider. You may set both keys; each provider keeps its own model setting ([provider-profiles.md](../concepts/provider-profiles.md)).
- **A note on cost:** with OpenAI the cost line shows $0, because OpenAI doesn't report a price per call. You check your spending on OpenAI's usage page instead.
- **Run:** `bun run index.ts` runs the entry file, [index.ts](index.ts.md). After `bun link`, the `yuvi` command works too ([package-json-bin.md](../concepts/package-json-bin.md)).

**Why it's used in general:** "Prerequisites → Install → Configure → Run" is the standard quick-start order. A newcomer can copy-paste from top to bottom.

**Why it's used here:** Agent mode can't work without an API key, so the README makes that step impossible to miss.

💡 **Tip:** The program's one command is `wakeup`. Run `bun run index.ts wakeup` (or `yuvi wakeup`) to see the banner. With no command, Commander prints the help text.

---

### Usage: modes and an example session

```
? Apply staged changes? › Review one by one
  ? hello.ts (file_create) › Accept
  ? Shell: bun hello.ts › Accept

✓ Applied.
```

**What it does:** A table lists the four menu choices (Agent, Plan, Chat, Help) and says honestly which ones are finished. Then a sample session shows a whole agent run: banner → pick CLI → pick Agent → type a task → tool calls → approval → "✓ Applied."

**Why it's used in general:** An example transcript shows what using the tool *feels* like. It often teaches more than a paragraph of description.

**Why it's used here:** It shows the approval step from [approval.ts](modes/agent/approval.ts.md) in action: one question per file and one per shell command.

---

### Available tools and safety

```md
| Tool | Description | Requires Approval |
|------|-------------|-------------------|
| `read_file` | Read any text file in the workspace | ❌ |
| `create_file` | Stage a new file for creation | ✅ |
| `execute_shell` | Queue a shell command for approval | ✅ |
```

**What it does:** It lists every tool the AI can call and whether it needs your approval. Reading, listing, searching, and analysing run straight away. Creating, modifying, deleting, making folders, and shell commands are staged first. A safety note adds that the agent stays inside the workspace folder and skips excluded paths such as `node_modules`, `.git`, and `.env*`.

**Why it's used in general:** When a tool can change files, users want to know exactly what it may do before they trust it.

**Why it's used here:** The tools are defined in [agent-tools.ts](modes/agent/agent-tools.ts.md), and the guards live in [tool-executor.ts](modes/agent/tool-executor.ts.md).

---

### Configuration

```md
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `YUVI_LLM` | ❌ | `openrouter` | Model provider: `openrouter` or `openai` |
| `OPENROUTER_API_KEY` | with OpenRouter | — | Your OpenRouter API key |
| `OPENROUTER_DEFAULT_MODEL` | ❌ | `openrouter/free` | Model identifier |
| `OPENAI_API_KEY` | with OpenAI | — | Your OpenAI API key |
| `OPENAI_DEFAULT_MODEL` | ❌ | `gpt-5-mini` | Model identifier |
| `OPENAI_FAST_MODEL` | ❌ | main model | Cheap OpenAI model for triage, routing and summaries |
```

**What it does:** One table lists the environment variables. The "Required" column says "with OpenRouter" or "with OpenAI", because you only need the key for the provider you picked. Below it, the README shows `defaultAgentConfig()`: the workspace root, the 1 MB read limit, the excluded patterns, and the on/off switches for each kind of tool.

**Why it's used in general:** A config reference table saves people from hunting through source code to find what they can change.

**Why it's used here:** The variables are read in one place, [core/config.ts](core/config.ts.md), using the names from [core/llm/profiles.ts](core/llm/profiles.ts.md). The config object lives in [types.ts](modes/agent/types.ts.md).

---

### Project structure, development, and contributing

```bash
bun run explain          # explain staged git changes
bunx tsc --noEmit        # type-check
bunx prettier --write .  # format
```

**What it does:**
- **Project structure:** a full folder tree with a short comment per file.
- **Development:** handy commands. `bunx` runs a package's command without a global install. `tsc --noEmit` checks types without writing output files, and `prettier --write .` formats the code ([prettier.md](../concepts/prettier.md)).
- **Adding a new tool:** four steps: define it in `agent-tools.ts`, implement it in `tool-executor.ts`, add an `ActionType` in `types.ts` if it changes things, and the approval flow picks it up.
- **Contributing, License, Acknowledgments:** how to send changes (fork → branch → pull request), the MIT license, and thanks to the libraries used.

**Why it's used in general:** These are the standard closing sections of an open-source README. They turn a reader into a possible contributor.

**Why it's used here:** The "Adding a New Tool" recipe is a good summary of how the agent files work together.

---

### 🧠 Key takeaways
- The README is the project's front page: pitch, features, quick start, and reference tables.
- Its main message is **approval-first**: the agent stages changes, and you decide.
- Setup needs three things: Bun, `bun install`, and an OpenRouter or OpenAI key in `.env` (`YUVI_LLM` picks which).
- The root README is the overview. The `docs/` folder holds the deeper, file-by-file explanations.
