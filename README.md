# chai-openclaw (yuvi)

> **YUVI** — An AI-powered coding agent that lives in your terminal. Think of it as a local, privacy-respecting pair programmer that can read, write, and modify your codebase — but only after you approve every change.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Agent Mode** | Multi-step AI agent that can explore, analyze, and modify your codebase using a tool loop |
| **Approval-First** | All file/folder mutations and shell commands are staged and require explicit user approval before applying |
| **Rich Terminal UI** | Beautiful ASCII banner, interactive prompts (@clack/prompts), and Markdown rendering (marked-terminal) |
| **Codebase Tools** | Read, create, modify, delete files; list/search/analyze directories; execute shell commands |
| **Skills System** | Load and use `.md` skill files from `~/.cursor/skills-cursor` and `~/.claude/skills` |
| **OpenRouter Integration** | Uses any model available via OpenRouter (free or paid) |
| **Diff Preview** | See unified diffs before accepting changes |

---

## 🏗 Architecture

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

\* Telegram mode is a placeholder — not yet implemented.

---

## 🚀 Quick Start

### Prerequisites

- **Bun** ≥ 1.0 (the runtime & package manager)
- **OpenRouter API key** — get one at [openrouter.ai](https://openrouter.ai/keys)

### Install

```bash
# Clone the repo
git clone https://github.com/your-org/chai-openclaw.git
cd chai-openclaw

# Install dependencies
bun install
```

### Configure

Create a `.env` file in the project root:

```bash
# Required: Your OpenRouter API key
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxx

# Optional: Model to use (default: openrouter/free)
# See https://openrouter.ai/models for available models
OPENROUTER_DEFAULT_MODEL=openrouter/auto
```

> **Tip:** You can also export these in your shell profile (`.bashrc`, `.zshrc`, etc.) instead of using `.env`.

### Run

```bash
# Development (runs via bun directly)
bun run index.ts

# Or install globally via bun (after `bun link` or `bun install -g`)
yuvi
```

You'll see the **YUVI** banner, then pick **CLI** mode → **Agent** to start coding.

---

## 🎮 Usage

### Modes

| Mode | Description |
|------|-------------|
| **Agent** | Full agentic loop: you give a task, yuvi plans, uses tools, shows diffs, asks for approval, applies |
| **Plan** | (Planned) Read-only analysis & planning without mutations |
| **Chat** | Simple back-and-forth conversation (echoes for now; AI reply wiring TODO) |
| **Help** | Shows available commands |

### Example Agent Session

```
$ yuvi
   ███╗   ███╗ █████╗ ██████╗ ███████╗
   ████╗ ████║██╔══██╗██╔══██╗██╔════╝
   ██╔████╔██║███████║██████╔╝█████╗
   ██║╚██╔╝██║██╔══██║██╔══██╗██╔══╝
   ██║ ╚═╝ ██║██║  ██║██║  ██║███████╗
   ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
  chai code · open claw · learn

? How do you want to talk to yuvi? › CLI
✓ Starting CLI mode...

? What do you want to do? › Agent
You: Create a hello world TypeScript file that prints "Hello from yuvi!"

  ✓ create_file  {"path":"hello.ts","content":"console.log('Hello from yuvi!');\n"}
  ✓ execute_shell  {"command":"bun hello.ts"}

? Apply staged changes? › Review one by one
  hello.ts (file_create)
  ? hello.ts (file_create) › Accept
  Shell: bun hello.ts
  ? Shell: bun hello.ts › Accept

✓ Applied.

Hello from yuvi!
```

---

## 🛠 Available Tools (Agent Mode)

| Tool | Description | Requires Approval |
|------|-------------|-------------------|
| `read_file` | Read any text file in the workspace | ❌ |
| `create_file` | Stage a new file for creation | ✅ |
| `modify_file` | Stage a full-file replacement | ✅ |
| `delete_file` | Stage a file for deletion | ✅ |
| `create_folder` | Stage a directory tree (`mkdir -p`) | ✅ |
| `list_files` | List directory contents (optional recursive) | ❌ |
| `search_files` | Glob search + optional content filter | ❌ |
| `analyze_codebase` | File/directory counts & summary | ❌ |
| `execute_shell` | Queue a shell command for approval | ✅ |
| `list_skills` | List all `SKILL.md` files in skill roots | ❌ |
| `read_skill` | Read a specific skill file | ❌ |

> **Safety:** The agent runs in a sandbox. It cannot escape the workspace root (`process.cwd()`), and excluded paths (`node_modules`, `.git`, `dist`, `.env*`, `*.log`) are blocked by default.

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | ✅ | — | Your OpenRouter API key |
| `OPENROUTER_DEFAULT_MODEL` | ❌ | `openrouter/free` | Model identifier (see [OpenRouter models](https://openrouter.ai/models)) |
| `SKILLS_DIRS` | ❌ | — | Semicolon-separated extra directories to scan for `SKILL.md` files |

### Agent Config (in `modes/agent/types.ts`)

```ts
export const defaultAgentConfig = (): AgentConfig => ({
    codebasePath: process.cwd(),
    maxFileSizeToRead: 1024 * 1024,        // 1 MB
    excludePatterns: [
        'node_modules', '.git', 'dist', 'build',
        '.next', '*.log', '.env*'
    ],
    tools: {
        allowShellExecution: true,
        allowFileModification: true,
        allowFileCreation: true,
        allowFolderCreation: true,
    },
});
```

You can customize by importing and modifying before passing to `ToolExecutor`.

---

## 📦 Project Structure

```
chai-openclaw/
├── index.ts                 # CLI entry point (commander.js)
├── package.json             # Dependencies, scripts, bin entry "yuvi"
├── tsconfig.json            # TypeScript config (ES modules, strict)
├── bun.lock                 # Bun lockfile
├── .env                     # Your API keys (gitignored)
├── .gitignore
├── .prettierrc / .prettierignore
├── cspell.json              # Spell-check config
├── ai/
│   ├── index.ts             # Re-exports getAgentModel
│   └── ai.config.ts         # OpenRouter provider + model selection
├── terminal-ui/
│   ├── wakeup.ts            # Banner + mode picker
│   └── terminal-md.ts       # Markdown → ANSI renderer
├── modes/
│   ├── cli.ts               # Main CLI loop (Agent/Plan/Chat/Help)
│   └── agent/
│       ├── orchestrator.ts  # runAgentMode() - AI agent loop
│       ├── agent-tools.ts   # Tool definitions for AI SDK
│       ├── tool-executor.ts # Safe execution + staging overlay
│       ├── action-tracker.ts# Action log with status tracking
│       ├── approval.ts      # Interactive approval flow + diff
│       ├── diff-view.ts     # Unified diff formatting
│       └── types.ts         # ActionLog, AgentConfig, types
├── scripts/
│   ├── explain-staged.sh    # Helper: explain staged git changes
│   └── teacher-prompt.md    # Prompt template for AI teaching
└── docs/                    # (Ignored per your request — concept notes)
```

---

## 🧪 Development

### Scripts

```bash
# Install deps
bun install

# Run in dev mode
bun run index.ts

# Explain staged git changes (uses scripts/explain-staged.sh)
bun run explain

# Type-check
bunx tsc --noEmit

# Format
bunx prettier --write .
```

### Adding a New Tool

1. Add the tool definition in `modes/agent/agent-tools.ts`
2. Implement the executor method in `modes/agent/tool-executor.ts`
3. Add the `ActionType` in `modes/agent/types.ts` if it's a mutation
4. The approval flow will automatically handle it

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/amazing-feature`
3. Make your changes (follow the existing code style)
4. Run `bunx prettier --write .` and `bunx tsc --noEmit`
5. Commit with a clear message
6. Open a Pull Request

---

## 📄 License

MIT — feel free to use, modify, and distribute.

---

## 🙏 Acknowledgments

- **[Vercel AI SDK](https://sdk.vercel.ai/)** — `ToolLoopAgent`, `tool()`, streaming
- **[OpenRouter](https://openrouter.ai/)** — Unified LLM API
- **[@clack/prompts](https://github.com/clack/prompts)** — Beautiful terminal prompts
- **[figlet](https://github.com/patorjk/figlet.js)** — ASCII art banners
- **[marked + marked-terminal](https://github.com/markedjs/marked)** — Markdown in terminal
- **[diff](https://github.com/kpdecker/jsdiff)** — Unified diffs
- **[Bun](https://bun.sh/)** — Fast JS runtime & tooling

---

> **chai code · open claw · learn**  
> Built with curiosity. Powered by OpenRouter. Running on Bun.