# modes/agent/ui.ts

**Purpose:** The **screen manager** of agent mode. Everything the agent prints while it works goes through the `AgentUI` class: the spinner, tool-call lines, the AI's thinking and answers, notes, and errors. It also turns raw technical errors into plain sentences with a next step.

**Where it fits:** [orchestrator.ts](orchestrator.ts.md) creates one `AgentUI` per session. [brain.ts](brain.ts.md) feeds it every part of the model's stream and calls `errorBox` when a run fails. [approval.ts](approval.ts.md) uses `colorizeDiff` and `withPrompt`. Markdown is rendered by [terminal-md.ts](../../terminal-ui/terminal-md.ts.md). Concepts: [chalk](../../../concepts/chalk-terminal-colors.md), [typescript-classes.md](../../../concepts/typescript-classes.md), [raw-mode-and-ansi-escapes.md](../../../concepts/raw-mode-and-ansi-escapes.md).

---

### Small formatting helpers

```ts
function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function short(value: unknown, max = 70): string {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
```

**What it does:**
- `formatTokens` turns `12345` into `12.3k` and `2500000` into `2.5M`.
- `short` squeezes all whitespace into single spaces and cuts long text, ending it with `…`.
- `formatDuration` (not shown) turns milliseconds into `45s` or `2m 5s`.

**Why it's used in general:** Tiny pure helpers like these keep display code readable. `1_000_000` is the same number as `1000000`; the underscores are only for human eyes.

**Why it's used here:** Terminal lines are short. Everything shown must fit on one line.

---

### `describeToolCall(toolName, input)`

```ts
switch (toolName) {
    case "read_file":
        return { verb: "Read", detail: short(f("path")), phase: "Exploring" };
    case "edit_file":
        return { verb: "Edit", detail: short(f("path")), phase: "Editing" };
    case "run_command":
        return { verb: "Run", detail: short(f("command"), 90), phase: "Running" };
    // ...one case per tool...
    default:
        return { verb: toolName, detail: short(JSON.stringify(input ?? {}), 80), phase: "Thinking" };
}
```

**What it does:** It turns a tool call into three things: a human `verb`, a short `detail`, and the `phase` to show in the spinner. `read_file {"path":"index.ts"}` becomes **Read** `index.ts`.

**Why it's used in general:** Raw JSON is for machines. A translation layer between internal names and display text is a standard UI habit.

**Why it's used here:** You watch lines like `● Read index.ts` and `● Run bun test` scroll by and can follow what the agent is doing. `summarizeToolResult` does the same for results (`⎿ 120 lines`).

---

### `colorizeDiff(patch, maxLines)`

```ts
const shown = lines.slice(0, maxLines).map((line) => {
    if (line.startsWith("+++") || line.startsWith("---")) return chalk.bold(line);
    if (line.startsWith("@@")) return chalk.cyan(line);
    if (line.startsWith("+")) return chalk.green(line);
    if (line.startsWith("-")) return chalk.red(line);
    return chalk.dim(line);
});
if (lines.length > maxLines) {
    shown.push(chalk.dim(`… ${lines.length - maxLines} more diff lines`));
}
```

**What it does:** It colours each line of a [unified diff](../../../concepts/unified-diffs.md): file headers bold, `@@` position markers cyan, added lines green, removed lines red, unchanged lines dim. Long diffs are cut at `maxLines` with a "… more diff lines" note.

**Why it's used in general:** Green for added and red for removed is the convention in Git and every code review tool.

**Why it's used here:** The order of the `if`s matters. `+++` must be checked before `+`, or file headers would be painted as added lines.

---

### The `AgentUI` class: spinner and `print`

```ts
print(text = ""): void {
    this.clearSpinner();
    process.stdout.write(text + "\n");
    this.drawSpinner();
}
```

**What it does:** The spinner is one line at the bottom, like `⠋ Thinking… · 12s · step 3 · 4.2k tok · esc to stop`. To print something, `print` erases the spinner line, writes the text, and draws the spinner again underneath.

**Why it's used in general:** Two things writing to the terminal at once produce torn, garbled lines. Sending **all** output through one method avoids that.

**Why it's used here:** The screen never looks frozen, and output never mixes with the spinner. `startRun` starts a timer that redraws the spinner every 90 ms, and `endRun` stops it.

---

### Typing while the agent works

```ts
private readonly onKey = (chunk: Buffer) => {
    const key = chunk.toString("utf8");
    if (key === "\u001b" || key === "\u0003") {
        this.onAbort?.();
        return;
    }
    if (key === "\r" || key === "\n") {
        const text = this.inputBuf.trim();
        this.inputBuf = "";
        if (text) {
            this.print(chalk.magenta(`  › you (mid-run): ${text}`));
            this.onSteer?.(text);
        }
        return;
    }
    // ...backspace, normal characters...
};
```

**What it does:** During a run the keyboard is in raw mode, and this handler sees every key.
- **Esc** or **Ctrl+C** calls `onAbort`, which stops the run.
- **Enter** sends what you typed to `onSteer`, which delivers it to the agent as a correction.
- Other keys build up `inputBuf`, shown at the end of the spinner line.

**Why it's used in general:** `this.onAbort?.()` uses **optional chaining**: call the function only if it exists. The class does not know *what* aborting means. The brain plugs that in.

**Why it's used here:** You are never locked out while the agent works. You can stop it or steer it.

---

### `withPrompt(fn)`

```ts
const run = async () => {
    this.flushStreams();
    this.suspended++;
    this.clearSpinner();
    const hadInput = this.inputAttached;
    this.detachInput();
    try {
        return await fn();
    } finally {
        this.suspended--;
        if (hadInput && this.running) this.attachInput();
        this.drawSpinner();
    }
};
const next = this.promptChain.then(run, run);
this.promptChain = next.catch(() => undefined);
return next;
```

**What it does:** It runs an interactive question (like the approval menu) safely:
- pause the spinner and release the keyboard,
- run the prompt,
- in `finally`, give everything back.

`promptChain` makes prompts wait in line. Each new one starts only after the previous one has finished.

**Why it's used in general:** Chaining Promises with `.then` is a simple way to build a queue ([async-await.md](../../../concepts/async-await.md)).

**Why it's used here:** A [clack prompt](../../../concepts/clack-prompts.md) and the spinner would fight over the same terminal line. Two prompts at once would be unusable.

---

### `handlePart(part)`: drawing the stream

```ts
case "tool-call": {
    this.flushStreams();
    const d = describeToolCall(part.toolName ?? "", part.input);
    this.setPhase(d.phase);
    if (part.toolName !== "todo_write") {
        this.print(`${chalk.cyan("●")} ${chalk.bold(d.verb)} ${d.detail}`.trimEnd());
        // remember the label for its result
    }
    break;
}
case "error":
    // The brain shows the error once, in plain words.
    this.flushStreams();
    break;
```

**What it does:** The brain passes in every part of the model's stream, and a `switch` decides how to draw each type:
- `reasoning-delta`: the model's thinking, shown as dim lines under `✻ thinking`.
- `text-delta`: the answer. Finished Markdown blocks are rendered as they complete.
- `tool-call` / `tool-result` / `tool-error`: a `●` line for the call and a `⎿` line for the outcome.
- `error`: it only flushes any half-printed text. It prints **no** error message of its own.

**Why it's used in general:** A `switch` on a `type` field is the standard way to handle a stream of different event kinds.

**Why it's used here:** The error case stays silent on purpose. [brain.ts](brain.ts.md) collects the error and shows it once through `errorBox`, so you never see the same failure twice.

---

### `errorBox(raw)`

```ts
errorBox(raw: string): void {
    const { problem, fix } = explainError(raw);
    const lines = [
        "",
        chalk.red.bold(`✗ ${problem}`),
        `  ${chalk.bold("What to do:")} ${fix}`,
    ];
    const detail = raw.replace(/\s+/g, " ").trim();
    if (detail && detail !== problem) {
        lines.push(chalk.dim(`  Technical detail: ${short(detail, 220)}`));
    }
    this.print(lines.join("\n"));
}
```

**What it does:** It prints an error in three layers:
1. `✗ <problem>` in bold red: what went wrong, in plain words.
2. `What to do: <fix>`: the next step.
3. `Technical detail: …` in dim text: the original message, cut to 220 characters.

`const { problem, fix } = ...` is **destructuring**: it pulls two fields out of the returned object in one line.

**Why it's used in general:** A good error message answers two questions: *what happened?* and *what can I do now?* The raw text is kept for people who want to search for it.

**Why it's used here:** Beginners get a clear action. Experienced users still get the real error. The simpler siblings `note` (yellow `◆`), `success` (green `✓`), and `failure` (red `✗`) print one-line messages.

---

### `explainError(raw)`

```ts
export function explainError(raw: string): { problem: string; fix: string } {
    const t = raw.toLowerCase();
    const has = (...words: string[]) => words.some((w) => t.includes(w));

    if (has("402", "insufficient credits", "payment required", "more credits")) {
        return {
            problem: "Your OpenRouter account has no credits left for this model.",
            fix: "Add credits at https://openrouter.ai/credits, or type / → “Change AI model” and pick a free one (for example openrouter/free).",
        };
    }
    // ...more checks...
    return {
        problem: "Something went wrong while talking to the AI.",
        fix: "Send your message again. If it repeats, type / → “Change AI model”, or start a new conversation.",
    };
}
```

**What it does:**
- It lower-cases the raw error, so matching ignores capital letters.
- `has(...words)` is a tiny helper: "does the error contain **any** of these words?" The `...words` is a **rest parameter**, which collects all arguments into an array.
- A chain of `if`s checks for known problems, top to bottom. The first match wins.
- The final `return` is a catch-all for anything unknown.

The problems it recognises, in order:

| The error mentions… | Plain meaning | Suggested step |
|---|---|---|
| no credentials, missing key, `401` | key missing or not accepted | menu → Set API key |
| invalid key, unauthorized | key rejected | paste a fresh key |
| `402`, credits | no credits left | add credits or pick a free model |
| `429`, rate limit | service busy | wait a minute and resend |
| no endpoints, tool use | model cannot use tools | choose a model with tool calling |
| model not found, `404` | wrong model name | enter a valid model id |
| context length | conversation too long | Free up memory or start a new conversation |
| fetch failed, network | cannot reach the service | check your internet |
| timeout | answer took too long | resend, or switch model |
| `500` / `502` / `503`, overloaded | problem on the service's side | resend in a moment |

**Why it's used in general:** Numbers like 401, 402, 429, and 500 are **HTTP status codes**, the web's standard way of saying what kind of failure happened. Mapping them to human sentences is a common job in any app that talks to an API.

**Why it's used here:** Every fix points at something `yuvi` actually offers, usually an item in the `/` menu from [orchestrator.ts](orchestrator.ts.md). The order matters: specific checks come before general ones, so a "401" about a key is not mistaken for something else.

---

### `errorText(error)`

```ts
export function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}
```

**What it does:** It turns *anything* that was thrown into a string: an `Error` gives its message, a string stays as it is, and other values are converted to JSON (or, if that fails, with `String`).

**Why it's used in general:** In JavaScript you can `throw` any value, so a `catch` variable has the type `unknown`. You must check what it is before using it.

**Why it's used here:** The rest of the app, including `explainError`, can always work with plain text.

---

### 🧠 Key takeaways
- All agent output goes through `AgentUI.print`, which keeps the spinner on the last line.
- Tool calls and results are translated into short human sentences.
- `withPrompt` pauses the spinner and queues prompts, so questions never collide with live output.
- `errorBox` shows an error once in three layers: the problem, what to do, and the technical detail.
- `explainError` is a first-match-wins list that maps raw API and network errors to a plain sentence and a next step.
