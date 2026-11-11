# chai-openclaw (yuvi)

> **YUVI** — An AI-powered coding agent that lives in your terminal. Think of it as a local, privacy-respecting pair programmer that can read, write, and modify your codebase — but only after you approve every change.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Agent Mode** | Multi-step AI agent that can explore, analyze, and modify your codebase using a tool loop |
| **Chat Mode** | Ask questions; yuvi searches the web only when the answer needs fresh facts, and cites its sources |
| **Approval-First** | All file/folder mutations and shell commands are staged and require explicit user approval before applying |
| **Rich Terminal UI** | Beautiful ASCII banner, interactive prompts (@clack/prompts), and Markdown rendering (marked-terminal) |
| **Codebase Tools** | Read, create, modify, delete files; list/search/analyze directories; execute shell commands |
| **Skills System** | Load and use `.md` skill files from `~/.cursor/skills-cursor` and `~/.claude/skills` |
| **OpenRouter Integration** | Uses any model available via OpenRouter (free or paid) |
| **Diff Preview** | See unified diffs before accepting changes |

---

## 🏗 Architecture

Three layers, each importing only from the one below it:

```
index.ts                 starts a front end with the list of modes
frontends/terminal/      reads input, shows output, asks questions
frontends/telegram/      the same from a Telegram chat on your phone
modes/                   agent/ · chat/ · echo/ (example), one folder each
core/                    settings, model client, search, security, the Mode contract
```

A mode never prints and a front end never decides anything: they talk
through events and questions defined in `core/mode.ts`. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and
[docs/adding-a-mode.md](docs/adding-a-mode.md) to add a mode.

---

## 📱 Telegram

Use yuvi from your phone. The bot runs on your PC (which must stay on) and
works on the project folder there; Telegram is only the screen and keyboard.
No server or public address is needed.

1. In Telegram, open **@BotFather**, send `/newbot` and copy the token.
2. Open **@userinfobot** to see your numeric user id.
3. Add to `.env`:

   ```bash
   TELEGRAM_BOT_TOKEN=123456:your-token
   YUVI_TELEGRAM_USERS=your-numeric-id
   YUVI_TELEGRAM_PIN=choose-6-or-more-characters
   ```

4. In your project folder run `yuvi telegram` (or `yuvi wakeup` → Telegram).
5. Open your bot in Telegram, send `/unlock` and then your PIN, then `/start`.

| In the chat | What it does |
|---|---|
| `/start`, `/menu` | Pick Agent, Plan or Chat |
| a message | Runs a turn; steps and (folded) thinking show live, then the answer |
| a message while yuvi works | Passed to the agent as a correction |
| `/stop` | Stop the running turn |
| Approve / Reject / Pick files / Reject + tell yuvi | Decide on each change; nothing is saved without a tap |
| `/cycle`, `/mode` | Switch Ask, Auto, Plan |
| `/undo`, `/new`, `/resume`, `/compact`, `/cost` | Same as in the terminal |
| a photo with a caption | Ask about a screenshot (Agent and Plan) |
| a file | Saved into the project after you confirm (`uploads/`, or the folder named in the caption) |
| `/file <path>` | Sends a project file to you |
| `/project` | Switch between folders listed in `YUVI_TELEGRAM_PROJECTS` |
| `/thinking on\|off`, `/model`, `/help` | Display and model settings |
| `/lock`, `/unlock` | Lock now; unlock with your PIN |

Safety: only the listed user ids are served, in private chats. The bot starts
locked and locks again after 15 quiet minutes. Five wrong PINs block guessing.
Messages sent while the bot was off are dropped. Keys are never accepted in
chat, and secret files (`.env`, keys) are never sent or overwritten. Bot chats
are not end-to-end encrypted, so do not paste secrets into them.

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
| `OPENROUTER_API_KEY` | ✅ | — | Your OpenRouter API key (can also be saved from inside the app) |
| `OPENROUTER_DEFAULT_MODEL` | ❌ | `openrouter/free` | Model identifier (see [OpenRouter models](https://openrouter.ai/models)) |
| `YUVI_MODEL_FAST` | ❌ | main model | Cheap model for triage, routing and summaries |
| `TAVILY_API_KEY` | ❌ | — | Use Tavily for web search instead of DuckDuckGo |
| `YUVI_LOG` | ❌ | off | `1` writes a usage log to `~/.yuvi/logs/` (no message text, secrets redacted) |
| `SKILLS_DIRS` | ❌ | — | Semicolon-separated extra directories to scan for `SKILL.md` files |
| `TELEGRAM_BOT_TOKEN` | Telegram | — | Bot token from @BotFather |
| `YUVI_TELEGRAM_USERS` | Telegram | — | Numeric Telegram user ids allowed to use the bot, comma-separated |
| `YUVI_TELEGRAM_PIN` | Telegram | — | PIN that unlocks the bot (6+ characters) |
| `YUVI_TELEGRAM_LOCK_MINUTES` | ❌ | `15` | Lock again after this many quiet minutes |
| `YUVI_TELEGRAM_WORKSPACE` | ❌ | start folder | Project folder the bot works in |
| `YUVI_TELEGRAM_PROJECTS` | ❌ | — | `name=path;name=path` for `/project` |

All settings are read in one place, `core/config.ts`. The full list is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#settings).

---

## 📦 Project Structure

```
chai-openclaw/
├── index.ts                 # CLI entry point (commander.js)
├── core/                    # Shared by every mode; imports nothing above it
│   ├── config.ts            # Settings: the only reader of the environment
│   ├── compose.ts           # createCore(): builds the shared services
│   ├── mode.ts              # Mode contract, events, registry, tool permissions
│   ├── errors.ts, usage.ts, log.ts, format.ts, cache.ts, history.ts
│   ├── llm/                 # LLMClient, AI SDK client, model provider registry
│   ├── search/              # Search providers, safe page fetcher
│   ├── security/            # Redaction, URL safety, untrusted content, limits
│   └── testing.ts           # Scripted model and a host with no screen
├── modes/
│   ├── index.ts             # The registry: one line per mode
│   ├── agent/               # mode.ts, brain.ts, agent-tools.ts, tool-executor.ts, approval.ts, …
│   ├── chat/                # mode.ts, pipeline.ts, stages/, prompts.ts, config.ts
│   └── echo/                # Example mode (shown with YUVI_DEV=1)
├── frontends/
│   ├── terminal/            # app.ts, session-loop.ts, renderer.ts, prompts.ts, input.ts, …
│   └── telegram/            # app.ts, router.ts, chat-controller.ts, host.ts, api/, view/, …
├── scripts/                 # explain-staged.sh, teacher-prompt.md
└── docs/                    # ARCHITECTURE.md, adding-a-mode.md, concept notes
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

# Run the tests
bun test

# Type-check
bunx tsc --noEmit

# Format
bunx prettier --write .
```

### Adding a New Mode

One folder and one line in `modes/index.ts`. See [docs/adding-a-mode.md](docs/adding-a-mode.md).

### Adding a New Tool (Agent Mode)

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