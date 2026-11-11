# How to add a new mode

A mode is one folder and one line in the registry. You do not edit the
core, the front end, or any other mode. `modes/echo/` is a complete working
example; read it alongside this guide.

## 1. Create the folder and `mode.ts`

```
modes/
└── summarise/
    └── mode.ts
```

```ts
// modes/summarise/mode.ts
import type { Mode, ModeHost, ModeSession } from "../../core/mode";

class SummariseSession implements ModeSession {
    constructor(private readonly host: ModeHost) {}

    async handle(input: string, options: { signal: AbortSignal }): Promise<void> {
        const { host } = this;
        host.emit({ type: "status", text: "Summarising" });

        const reply = await host.core.llm.stream(
            {
                model: host.core.settings.modelId("fast"),
                system: "Summarise the text in three short bullet points.",
                messages: [{ role: "user", content: input }],
                maxTokens: 400,
                signal: options.signal,
            },
            (text) => host.emit({ type: "token", text }),
        );

        host.emit({ type: "token", text: "", end: true });
        host.emit({ type: "answer", text: reply.text, kind: "answer" });
        host.emit({ type: "summary", parts: [`${reply.inputTokens + reply.outputTokens} tokens`] });
    }

    commands() { return []; }
    welcome() { return ["", "  Paste some text and I will summarise it."]; }
    help() { return ["Summarise mode turns long text into three bullet points."]; }
    status() { return { label: "Summarise", detail: "", tone: "accent" as const }; }
    async close() {}
}

export const summariseMode: Mode = {
    name: "summarise",
    label: "Summarise",
    description: "turn long text into three bullet points",
    tools: [],                      // list every tool the mode needs
    commandStyle: "typed",
    createSession: (host) => new SummariseSession(host),
};
```

## 2. Register it

Add one line to `modes/index.ts`:

```ts
    .register(summariseMode)
```

It now appears in the terminal menu, and in any other front end.

## 3. Test it without a screen

```ts
import { createCore } from "../../../core/compose";
import { createRecordingHost, FakeLLM, testSettings } from "../../../core/testing";
import { summariseMode } from "../mode";

test("it summarises", async () => {
    const core = createCore(testSettings(), { llm: new FakeLLM(() => "- one\n- two\n- three") });
    const host = createRecordingHost({ core, grants: summariseMode.tools });
    await summariseMode.createSession(host).handle("long text…", { signal: new AbortController().signal });
    expect(host.answerText()).toBe("- one\n- two\n- three");
});
```

## What a mode may and may not do

| Do | Do not |
|---|---|
| Report everything with `host.emit(event)` | Print, use `console.log`, or import `chalk` |
| Ask with `host.confirm`, `host.choose`, `host.ask` | Read keys or check for a terminal |
| Take the model, search and settings from `host.core` | Read `process.env` or create a provider yourself |
| Import from `core/` and your own folder | Import from another mode or from `frontends/` |
| Stop when `options.signal` is aborted | Keep state in module-level variables (sessions must not share anything) |

The import rules are enforced by `core/__tests__/architecture.test.ts`.

## Using tools

List what you need in `tools`. Anything not listed is refused at run time.

| Permission | Gives you |
|---|---|
| `web.search` | `host.core.search.search(query, limit, signal)` |
| `web.fetch` | `host.core.pages.fetchText(url, signal)` (public http/https only) |
| `fs.read`, `fs.write`, `shell` | Granted flags in `host.grants`; your mode does the file or shell work in `host.workspace` and must call `host.confirm` before it changes anything |

Wrap anything that comes from the web with `wrapUntrusted` from
`core/security/untrusted.ts` and add `UNTRUSTED_RULE` to your system prompt.

## Events you can emit

| Event | Use it for |
|---|---|
| `status` | what you are doing now ("Searching") |
| `token` | a piece of the answer; send `end: true` when it is complete |
| `answer` | the full reply, for front ends that do not stream; `kind: "clarify"` for a question back |
| `tool` | a tool call (`phase: "call"`) and its outcome (`"result"` or `"error"`) |
| `notice` | a short note, success or failure |
| `line` | a ready-made line, with optional emphasis |
| `sources` | numbered web sources |
| `todos` | a plan with item states |
| `summary` | the closing line of a turn |
| `error` | a failure as raw text; the front end words it for the user |

## Commands

Return them from `commands()`. Each has a typed name (`/new`), a menu label,
a hint and a `run(arg)` function. `run` can return `"exit"` to leave the
mode, or `{ submit: text }` to send `text` as a message. The front end adds
`/model`, `/key`, `/help` and `/exit` itself.
