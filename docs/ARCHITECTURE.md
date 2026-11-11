# Architecture

yuvi is built in three layers. Each layer may only import from the layer
below it, and a test (`core/__tests__/architecture.test.ts`) fails if that
rule is broken.

```
index.ts                     starts a front end and hands it the mode registry
   │
   ▼
frontends/terminal/          reads input, shows output, asks the user questions
frontends/telegram/          the same job in a Telegram chat (messages and buttons)
   │   use only: core/ and modes/index.ts
   ▼
modes/                       the logic of each mode
   ├── index.ts              the registry: one register() line per mode
   ├── agent/                coding agent: reads, edits and runs things, with approval
   ├── chat/                 questions and answers, with web search when needed
   └── echo/                 example mode (hidden unless YUVI_DEV=1)
   │   a mode uses only: core/ and its own folder
   ▼
core/                        everything the modes share; imports nothing above it
```

## What lives where

| Folder / file | Job |
|---|---|
| `core/config.ts` | `Settings`: the only code that reads the environment and `~/.yuvi/settings.json`. Validates values and applies defaults. Keys come from `.env` or the OS credential vault (`loadKeys()`, through `core/security/key-store.ts`). Types are in `core/settings-types.ts`. |
| `core/llm/verify-key.ts` | Checks a pasted key with one tiny model call before it is saved. |
| `core/compose.ts` | `createCore(settings)`: builds the shared services (model client, search, page reader, logger). The one place providers are chosen. |
| `core/mode.ts` | The contract between modes and front ends: `Mode`, `ModeSession`, `ModeHost`, `ModeEvent`, `ModeRegistry`, tool permissions. |
| `core/llm/` | `LLMClient` interface, its AI SDK implementation, and the model provider registry. |
| `core/search/` | `SearchProvider` and `PageFetcher` interfaces, DuckDuckGo and Tavily adapters, the safe page fetcher, the search provider registry. |
| `core/security/` | Secret redaction, URL safety, untrusted-content wrapping, rate and budget limits. |
| `core/errors.ts` | One error family (`YuviError` and its subclasses) and `classifyError`. |
| `core/usage.ts`, `core/log.ts` | Token and cost records; the opt-in JSON-lines log. |
| `core/cache.ts`, `core/history.ts` | Cache and conversation-history interfaces with in-memory versions. |
| `core/testing.ts` | Test doubles: a scripted model and a host with no screen. |
| `modes/<name>/mode.ts` | The mode's entry point. Everything else in the folder is private to the mode. |
| `frontends/terminal/` | `app.ts` (main menu), `login.ts` (first-run welcome, log in with a key check, log out), `model-menu.ts` (provider, model, effort), `session-loop.ts` (runs any mode), `renderer.ts` (events to screen), `prompts.ts` (questions), `input.ts` (the input box). |
| `frontends/telegram/` | `app.ts` (start), `poller.ts` (fetch updates), `router.ts` (allowlist, PIN lock, rate limit), `chat-controller.ts` (one chat: mode, session, turn), `host.ts` (`ModeHost`), `confirm-view.ts` (approval buttons), `questions.ts` (one-time buttons), `lock.ts`, `files.ts`, `commands.ts`, `api/` (Bot API behind `TelegramApi`), `view/` (HTML, activity message, sending). |
| `core/security/path-safety.ts` | `resolveInside` and `isSensitivePath`: keep file access inside a folder and away from secrets files. |

## How a message flows

```
user types a message
   │
   ▼
front end (session-loop.ts)  ──  session.handle(text, { signal })
                                        │
                                        ▼
                               mode logic (brain.ts / pipeline.ts)
                                        │  uses host.core: model, search, settings
                                        │
        host.emit(event)  ◄─────────────┤  status, token, tool, sources, summary, error …
        host.confirm(...) ◄─────────────┤  "save these changes?", "run this command?"
        host.ask / choose ◄─────────────┘  a question back to the user
   │
   ▼
renderer.ts turns each event into lines on the screen
```

A mode never prints, never reads keys and never checks for a terminal. It
emits events and asks through the host. A front end never decides anything
about a task. That is what lets a Telegram front end reuse every mode
unchanged: it implements `ModeHost` (send events as messages, ask with
buttons) and calls the same `session.handle`.

## The contract in short

```ts
interface Mode {
    name: string; label: string; description: string;
    tools: ToolPermission[];          // "web.search" | "web.fetch" | "fs.read" | "fs.write" | "shell"
    createSession(host: ModeHost): ModeSession;
}

interface ModeSession {
    handle(input: string, options: { signal: AbortSignal }): Promise<void>;
    commands(): ModeCommand[];        // "/new", "Undo last change", …
    welcome(): Line[]; help(): Line[]; status(): ModeStatus;
    close(): Promise<void>;
}

interface ModeHost {
    core: Core;                       // limited to the tools the mode declared
    emit(event: ModeEvent): void;
    confirm(request): Promise<ConfirmReply>;
    choose(question, choices): Promise<string | null>;
    ask(question): Promise<string | null>;
}
```

The full definitions, with comments, are in `core/mode.ts`.

## Rules that keep it healthy

- **Tool permissions are explicit.** A mode lists its tools. Chat lists only
  `web.search` and `web.fetch`, so it cannot touch files or run commands.
  Reaching for an undeclared tool throws a `ToolError`.
- **Risky actions are confirmed.** The agent's file changes and shell
  commands go through `host.confirm`. With nobody to ask, they are refused.
- **Web content is data.** Search results and pages are wrapped by
  `core/security/untrusted.ts` and the model is told not to obey them.
- **Secrets stay put.** Keys come from `Settings`, are redacted from errors
  and logs, and are removed from the environment of shell commands.
- **No shared state between sessions.** Each `createSession` call gets its
  own history, caches and limits. `Settings` is an object, not a global.
- **Every network call has a timeout**, and model calls are retried by the
  AI SDK with growing pauses.

## Swapping a provider

| To change | Do this |
|---|---|
| Search engine | Write a class that implements `SearchProvider`, add one entry to `SEARCH_PROVIDERS` in `core/search/providers.ts`, set `YUVI_SEARCH=<name>`. |
| Model provider | Add one entry to `LLM_PROVIDERS` in `core/llm/providers.ts` that returns an AI SDK model for an id, one entry to `LLM_PROFILES` in `core/llm/profiles.ts` (key and model variables, saved fields, suggested models, links), and its saved fields to `UserSettings` in `core/config.ts`. Its key is then hidden from shell commands, and it appears in both front ends' provider menus, with no other change. |
| History or cache storage | Implement `HistoryStore` or `Cache` and pass it to `createChatEngine` in `modes/chat/factory.ts`. |
| Front end | Implement `ModeHost` and call `mode.createSession(host)`. `core/testing.ts` has the smallest working example. |

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `YUVI_LLM` | `openrouter`, or the one picked in the app | Model provider: `openrouter`, `openai`, `gemini` or `anthropic` |
| `OPENROUTER_API_KEY` | none | OpenRouter key. Every `*_API_KEY` is optional: logging in from the app keeps the key in the OS credential vault instead, and a key in `.env` wins over it |
| `OPENROUTER_DEFAULT_MODEL` | `openrouter/free` | Main model on OpenRouter |
| `YUVI_MODEL_FAST` | main model | Cheap OpenRouter model for triage, routing and summaries |
| `OPENAI_API_KEY` | none | OpenAI key, used when `YUVI_LLM=openai` (can also be saved from the app) |
| `OPENAI_DEFAULT_MODEL` | `gpt-5-mini` | Main model on OpenAI |
| `OPENAI_FAST_MODEL` | main model | Cheap OpenAI model for triage, routing and summaries |
| `GEMINI_API_KEY` | none | Google AI Studio key (can also be saved from the app) |
| `GEMINI_DEFAULT_MODEL` | `gemini-3.8-flash` | Main model on Gemini |
| `GEMINI_FAST_MODEL` | main model | Cheap Gemini model for triage, routing and summaries |
| `ANTHROPIC_API_KEY` | none | Claude key from platform.claude.com (can also be saved from the app) |
| `ANTHROPIC_DEFAULT_MODEL` | `claude-sonnet-5-5` | Main model on Claude |
| `ANTHROPIC_FAST_MODEL` | `claude-haiku-5-5` | Cheap Claude model for triage, routing and summaries |
| `YUVI_SEARCH` | `auto` | `auto`, `duckduckgo` or `tavily` |
| `TAVILY_API_KEY` | none | Enables Tavily search |
| `YUVI_REASONING` | per task, or the one picked in the app | Reasoning effort, or `off` |
| `YUVI_LOG` | off | `1` writes `~/.yuvi/logs/<date>.jsonl` (no message text, secrets redacted) |
| `YUVI_DEV` | off | `1` shows the example Echo mode |
| `YUVI_CONTEXT_WINDOW`, `YUVI_TRIAGE`, `YUVI_SELF_REVIEW`, `SKILLS_DIRS` | | Agent mode, see `modes/agent/types.ts` |
| `YUVI_CHAT_*` | | Chat mode limits, see `modes/chat/config.ts` |
| `TELEGRAM_BOT_TOKEN` | none | Bot token from @BotFather. Needed for `yuvi telegram` |
| `YUVI_TELEGRAM_USERS` | none | Comma-separated numeric Telegram user ids allowed to use the bot. Needed |
| `YUVI_TELEGRAM_PIN` | none | PIN that unlocks the bot, at least 6 characters. Needed |
| `YUVI_TELEGRAM_LOCK_MINUTES` | 15 | Lock again after this many minutes without a message |
| `YUVI_TELEGRAM_WORKSPACE` | start folder | Project folder the bot works in |
| `YUVI_TELEGRAM_PROJECTS` | none | `name=path;name=path`: folders offered by `/project` |

## Tests

`bun test` runs everything. Tests sit next to the code in `__tests__`
folders: the core alone, each mode with a scripted model and a host that has
no screen, and the terminal's output for a recorded run.
