# modes/agent/orchestrator.ts

**Purpose:** The **conductor** of agent mode. It asks you for a request, builds the AI agent with its tools, lets it work, shows you the answer, and then goes through approval and applying changes.

**Where it fits:** [modes/cli.ts](../cli.ts.md) calls `runAgentMode()` when you pick **Agent**. It brings together:
- [types.ts](types.ts.md) for the config
- [action-tracker.ts](action-tracker.ts.md) for the log
- [tool-executor.ts](tool-executor.ts.md) for the real work
- [agent-tools.ts](agent-tools.ts.md) for the toolbox
- [ai/index.ts](../../ai/index.ts.md) for the model
- [terminal-ui/terminal-md.ts](../../terminal-ui/terminal-md.ts.md) for pretty output
- [approval.ts](approval.ts.md) for the yes/no step

Concept: [AI SDK agents](../../../concepts/ai-sdk-agents.md).

---

### Asking for the request

```ts
export async function runAgentMode() {
    log.step(chalk.gray("Running agent mode..."));

    const message = await text({
        message: "You:",
        placeholder: "type something to yuvi...",
        validate: (value) => (!value || !value.trim() ? "Say something first!" : undefined),
    });

    if (message == "exit") return false;
    if (isCancel(message)) return false;
```

**What it does:** It prints a grey step marker, then asks you to type a request using clack's [`text` prompt](../../../concepts/clack-prompts.md). Empty input is refused. Typing `exit` or cancelling ends agent mode early.

**Why it's used in general:** Check the input first, and only then do the expensive work. This is called an **early return**.

**Why it's used here:** There's no point setting up an AI agent if the user has nothing to ask.

---

### Building the parts

```ts
const config = defaultAgentConfig();
const tracker = new ActionTracker();
const executor = new ToolExecutor(config, tracker);
const tools = createAgentTools(executor);
```

**What it does:** It creates each piece and connects them:
- the config (workspace root, limits, and switches)
- a fresh, empty action log
- an executor that uses the config and writes into the log
- the toolbox, wired to that executor

**Why it's used in general:** This is **dependency injection**: build small pieces and hand them to each other, instead of each piece secretly making its own. See [typescript-classes.md](../../../concepts/typescript-classes.md).

**Why it's used here:** Everything shares the *same* tracker, so the approval step sees exactly what the tools staged. Each run starts clean.

---

### Creating the agent

```ts
const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(10),
    instructions: [
        `workspace root: ${config.codebasePath}`,
        "All mutations (file/folder creation, modification, deletion) must be approved by the user before they are applied.",
    ].join("\n"),
    tools,
})
```

**What it does:**
- `model`: the AI brain from [ai.config.ts](../../ai/ai.config.ts.md).
- `stopWhen: stepCountIs(10)`: the agent may do at most 10 think-and-call rounds.
- `instructions`: the system prompt. It tells the AI where the workspace is and that changes need approval.
- `tools`: the toolbox.

**Why it's used in general:** `ToolLoopAgent` runs the "think → call tool → read result → think again" loop for you.

**Why it's used here:** It turns `yuvi` from a chatbot into a helper that can actually look at and propose changes to your project.

---

### Running it and showing progress

```ts
const result = await agent.generate({
    prompt: message.trim(),
    onStepFinish: ({ toolCalls }) => {
        for (const tc of toolCalls) {
            const preview = JSON.stringify(tc.input).slice(0, 160);
            console.log(
                chalk.green("  ✓"),
                chalk.bold(String(tc.toolName)),
                chalk.dim(preview + (preview.length >= 160 ? "..." : "")),
            );
        }
    },
});

if (result.text?.trim()) console.log(renderTerminalMarkdown(result.text));
```

**What it does:**
- `generate` sends your request and runs the whole agent loop.
- After every step, `onStepFinish` prints one line per tool call: a green ✓, the tool name in bold, and a dim preview of its input. The preview is cut to 160 characters, with `...` added if it was cut.
- At the end, if the AI wrote a final answer, it prints it as nicely formatted Markdown.

**Why it's used in general:** Live progress makes long AI work feel less like a frozen screen.

**Why it's used here:** You can *see* the agent working (`✓ read_file {"path":"index.ts"}`) before deciding whether to trust its changes.

---

### Approve, apply, clean up

```ts
const ok = await runApprovalFlow(tracker);
if (!ok) return executor.clearStaging();

const { errors } = executor.applyApprovedFromTracker();

if (errors.length) {
    console.log(chalk.red("\nSome operations reported errors:\n"));
    for (const e of errors) console.log(chalk.red(`  • ${e}`));
}
else {
    console.log(chalk.green('\n✓ Applied.\n'));
}

executor.clearStaging()
```

**What it does:**
- It hands the tracker to [approval.ts](approval.ts.md), which lets you approve all changes, review them one by one, or cancel. If nothing was approved (the answer is `false`), it throws away the staged changes and stops.
- Otherwise `applyApprovedFromTracker()` writes or runs every action whose status is `approved`, and collects any error messages.
- It shows the errors in red, or a green "✓ Applied."
- Finally it clears the staging area.

**Why it's used in general:** This is the final **apply** part of the [stage → approve → apply](../../../concepts/staged-changes-and-approval.md) pattern. Collecting errors (instead of crashing on the first one) lets the rest still finish.

**Why it's used here:** The AI's proposed changes become real only at this point, and only the approved ones.

---

### 🧠 Key takeaways
- The orchestrator does five things: ask → build parts → run agent → show answer → approve and apply.
- All the parts share one tracker, so approval sees exactly what was staged.
- `stepCountIs(10)` is a safety brake on the agent loop.
- `onStepFinish` gives live "✓ tool" progress lines.
