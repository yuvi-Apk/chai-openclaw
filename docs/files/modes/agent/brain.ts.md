# modes/agent/brain.ts

**Purpose:** The **thinking part** of agent mode. It runs one full turn the way a careful engineer works: size up the task, do the work, have the result reviewed, let you approve it, run the project's checks, and repair the work if the checks fail.

**Where it fits:** [orchestrator.ts](orchestrator.ts.md) calls `runTurn()` for every message you send, and `compactHistory()` from the menu. This file gets its model from [ai/index.ts](../../ai/index.ts.md), prints everything through [ui.ts](ui.ts.md), and uses the tools from [agent-tools.ts](agent-tools.ts.md). It also uses `prompt.ts` (the system prompt), `memory.ts` (saved notes and conversations), `subagents.ts` (helper agents), and `repo-map.ts` (the project map) from the same folder. Concept: [AI SDK agents](../../../concepts/ai-sdk-agents.md).

---

### Task profiles

```ts
const PROFILES: Record<TaskKind, TaskProfile> = {
    question: { kind: "question", effort: "low", maxSteps: 30, requirePlan: false, gates: false },
    small_change: { kind: "small_change", effort: "medium", maxSteps: 40, requirePlan: false, gates: true },
    feature: { kind: "feature", effort: "high", maxSteps: 80, requirePlan: true, gates: true },
    debug: { kind: "debug", effort: "high", maxSteps: 60, requirePlan: false, gates: true },
    refactor: { kind: "refactor", effort: "high", maxSteps: 80, requirePlan: true, gates: true },
};
```

**What it does:** For each of the five kinds of task it stores four settings:
- `effort`: how hard the model should think.
- `maxSteps`: the most think-and-call-tool rounds allowed.
- `requirePlan`: must the agent write a plan before it may edit?
- `gates`: should the self-review and the checks run afterwards?

**Why it's used in general:** A lookup table (`Record`) replaces a tangle of `if` statements. To change behaviour, you change data.

**Why it's used here:** A quick question should be cheap and fast. A new feature deserves a plan, more steps, and a review.

---

### `triage(text, signal)`: what kind of task is this?

```ts
const result = await generateText({
    model: getAgentModel("fast"),
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    prompt:
        "Classify this request to a coding agent. Reply with exactly one word.\n" +
        "question     - wants an explanation or information; no code change\n" +
        // ...small_change, feature, debug, refactor...
        `Request: ${text.slice(0, 2000)}`,
});
const answer = result.text.toLowerCase();
const found = kinds.find((k) => answer.includes(k) || answer.includes(k.replace("_", " ")));
return found ?? triageByKeywords(text);
```

**What it does:**
- It asks the **fast** model to label your request with one word.
- `AbortSignal.any([...])` stops the call if you press Esc **or** if 20 seconds pass.
- It looks for one of the five kind names in the answer.
- If the model's answer is unclear, or the call fails, it falls back to `triageByKeywords`, which uses simple word patterns ("fix", "bug" → debug; "add", "create" → a change; and so on).

**Why it's used in general:** "Triage" comes from hospitals: a quick look to decide how much attention a case needs. Using a small model to route work to a big one is a common cost-saving pattern.

**Why it's used here:** The answer picks the profile above. Setting `YUVI_TRIAGE=off` skips the model call and uses keywords only.

---

### `runLoop`: building the agent

```ts
const agent = new ToolLoopAgent({
    model: getAgentModel("main"),
    instructions: state.instructions,
    tools: ctx.tools,
    stopWhen: stepCountIs(state.profile.maxSteps),
    ...(reasoning ? { reasoning } : {}),
    prepareStep: ({ messages, responseMessages }) => {
        // trim old tool results when the context is getting full...
        const locked =
            session.mode === "plan" ||
            (state.profile.requirePlan && session.todos.length === 0);
        return {
            ...(overridden ? { messages: next } : {}),
            ...(locked ? { activeTools: withoutEdits } : {}),
        };
    },
});
```

**What it does:**
- `ToolLoopAgent` runs the "think → call tool → read result → think again" loop.
- `stopWhen` is a safety brake from the task profile.
- `prepareStep` runs before **every** step and can adjust it:
  - When the model's memory is over 70% full (`COMPACT_AT`), bulky old tool results are trimmed.
  - The **plan gate**: in Plan mode, or when a plan is required and none exists yet, the editing tools are hidden (`activeTools: withoutEdits`). The model simply cannot edit.

**Why it's used in general:** Hiding a tool is stronger than asking the model nicely not to use it. `...(cond ? { key } : {})` adds a property to an object only when a condition is true.

**Why it's used here:** Plan mode's promise, "nothing is changed", is enforced by code and not just by wording.

---

### `runLoop`: keeping the console quiet while streaming

```ts
// The SDK prints stream errors with a stack trace to the console. The
// error is shown once, in plain words, by ui.errorBox instead.
const consoleError = console.error;
console.error = () => undefined;

try {
    // ...stream the agent...
} catch (error) {
    if (!state.controller.signal.aborted && !failed) failed = errorText(error);
} finally {
    console.error = consoleError;
    ui.onSteer = (text) => state.queuedSteers.push(text);
}
```

**What it does:**
- It saves the real `console.error` in a variable.
- It replaces `console.error` with a function that does nothing.
- In `finally`, which runs **whether the code succeeded or failed**, it puts the real one back.

**Why it's used in general:** In JavaScript, functions are values, so you can temporarily swap one out. `try` / `finally` is the safe way to do "change something, then always restore it".

**Why it's used here:** When a model call fails, the AI SDK prints a long technical stack trace. A beginner would see that *and* `yuvi`'s own message. Silencing it for the length of the run means the error appears **once**, in plain words.

💡 **Tip:** Always restore in `finally`, not after the `try`. If the restore line could be skipped by an error, the rest of the program would lose `console.error` for good.

---

### `runLoop`: reading the stream

```ts
for await (const raw of result.stream) {
    const part = raw as unknown as StreamPartLike & { /* usage, providerMetadata */ };
    ui.handlePart(part);

    if (part.type === "start-step") state.steps++;

    if (part.type === "tool-call") {
        const signature = `${part.toolName}:${JSON.stringify(part.input)}`;
        sameCallCount = signature === lastCall ? sameCallCount + 1 : 1;
        lastCall = signature;
        if (sameCallCount === 3) {
            // tell the agent to change approach
        }
    }
    // ...tool-error guard, finish-step token counting...
    if (part.type === "error") failed = errorText(part.error);
}
```

**What it does:**
- `agent.stream(...)` gives back the answer in small **parts** as they are produced. `for await` loops over them as they arrive ([async-await.md](../../../concepts/async-await.md)).
- Every part goes to `ui.handlePart`, which draws it ([ui.ts](ui.ts.md)).
- **Loop guards:** the exact same tool call three times in a row, or the same tool error twice in a row, triggers a `[harness]` message telling the agent to stop and try something different.
- `finish-step` parts carry token counts and cost, which are added to `session.usage`.
- An `error` part is not printed here. Its text is stored in `failed` for later.

**Why it's used in general:** Streaming makes long AI work feel alive. Loop guards are needed because models sometimes get stuck repeating themselves.

**Why it's used here:** `steering.steer(...)` slips a message into the running conversation. The same mechanism delivers corrections you type while the agent works.

---

### `runLoop`: how a run ends

```ts
if (state.controller.signal.aborted) {
    session.messages = [
        ...snapshot.messages,
        { role: "assistant", content: "(The user interrupted this run before it finished.)" },
    ];
    return "aborted";
}

if (failed) {
    ui.errorBox(failed);
    session.messages = [
        ...snapshot.messages,
        { role: "assistant", content: `(The run failed with an error: ${failed.slice(0, 300)})` },
    ];
    return "error";
}

return "done";
```

**What it does:** The loop ends in one of three ways:
- **aborted**: you pressed Esc. A short note is added to the conversation.
- **error**: something failed. `ui.errorBox(failed)` shows what went wrong, what to do about it, and the technical detail in small print. A note is added to the conversation.
- **done**: the agent finished normally.

**Why it's used in general:** Returning a small set of named outcomes (`"done" | "aborted" | "error"`) is clearer than `true` / `false`. It is a [union type](../../../concepts/typescript-union-types.md).

**Why it's used here:** The conversation history stays consistent even after a failure, so your next message works. The error is explained by `explainError` in [ui.ts](ui.ts.md).

---

### The gates: `selfReview` and `runChecks`

```ts
const diff = executor.turnDiff();
if (changedLineCount(diff) < 8) return "";
// ...
const report = await runSubagent(session, ctx.baseTools, {
    type: "reviewer",
    prompt: `The user asked:\n${request}\n\nThis diff was written for it ...`,
});
if (/^\s*LGTM\b/i.test(report) || report.includes("stopped without a report")) {
    ui.success("Self-review: no problems found.");
    return "";
}
```

**What it does:**
- `selfReview` skips tiny changes (fewer than 8 changed lines). Otherwise it starts a second agent, the **reviewer**, which reads the diff with fresh eyes. "LGTM" ("looks good to me") means no problems. Anything else is returned as findings.
- `runChecks` runs each of the project's check commands (tests, type check, lint). It returns the output of the failing ones, or `""` when all pass.

**Why it's used in general:** A reviewer who did not write the code spots mistakes the author is blind to. Running tests after a change is the basic safety net of software work.

**Why it's used here:** Both happen automatically. The review happens *before* you see the changes, and the checks happen *after* you approve them.

---

### `runTurn`: telling you what it is about to do

```ts
const kind = session.mode === "plan" ? "feature" : await triage(userText, controller.signal);
state.profile = PROFILES[kind];
const kindLabel: Record<TaskKind, string> = {
    question: "Answering your question",
    small_change: "Making a small change",
    feature: "Building a feature — I will plan first",
    debug: "Finding and fixing the problem",
    refactor: "Restructuring code — I will plan first",
};
ui.print(
    chalk.dim(
        `  ◇ ${session.mode === "plan" ? "Plan mode — I will only read and write a plan" : kindLabel[kind]}`,
    ),
);
```

**What it does:**
- It runs triage (Plan mode skips it and always uses the `feature` profile).
- `kindLabel` maps each internal kind name to a friendly sentence.
- It prints one dim line: in Plan mode "Plan mode — I will only read and write a plan", otherwise the sentence for the kind.

**Why it's used in general:** Internal names like `small_change` are for code. A lookup table from internal name to display text keeps the two apart.

**Why it's used here:** You read "Finding and fixing the problem" and immediately know how `yuvi` understood your request. If it understood wrong, you can press Esc and rephrase.

---

### `runTurn`: work, then gates

```ts
while (true) {
    const outcome = await runLoop(session, ctx, state, input);
    if (outcome !== "done") break;

    // 1. self-review (once): findings → input = "...fix these"; continue
    // 2. checkpoint: show the changes, save the approved ones
    const applied = await session.checkpoint();
    // 3. run checks: pass → break
    //    fail → input = "...they FAILED: ..."; loop again (max 3 repair rounds)
}
```

**What it does:** After the agent finishes working, three gates follow. Each one can send the agent **back to work** by setting a new `input` and looping:
1. **Self-review**, once per turn. Findings go back to the agent to fix.
2. **Checkpoint**: you see the changes and choose what to save ([approval.ts](approval.ts.md)). Rejected files are reported to the agent.
3. **Verification**: the check commands run. On failure, the errors go back to the agent, up to `MAX_REPAIR_ROUNDS` (3) times.

The `finally` block at the end always stops the spinner, clears the key handlers, and saves the conversation to disk.

**Why it's used in general:** "Do, check, fix, repeat" with a maximum number of rounds is a robust pattern for any automated worker. The limit prevents endless loops.

**Why it's used here:** This loop is what turns a model that writes code into an agent that delivers **working** code.

---

### `compactHistory(session)`

```ts
const pruned = pruneToolOutputs(session.messages, 6);
const next = await summarizeHistory(pruned.messages, getAgentModel("fast"), session.abortSignal);
session.messages = next;
session.usage.lastInputTokens = 0;
const changed = next.length !== before || pruned.pruned > 0;
```

**What it does:** It trims old tool results, asks the fast model to summarise the older part of the conversation, and replaces the history with the shorter version. It returns `true` if anything actually changed.

**Why it's used in general:** Every model has a **context window**, a limit on how much text it can consider at once. Summarising old turns frees space.

**Why it's used here:** It runs automatically when the window is over 70% full, and by hand from the menu item **Free up memory**.

---

### 🧠 Key takeaways
- One turn = triage → work → self-review → your approval → checks → repair if needed.
- Task profiles decide effort, step limit, whether a plan is required, and whether gates run.
- The plan gate hides the editing tools, so "plan first" and Plan mode are enforced by code.
- Errors are shown once, in plain words: `console.error` is muted during the stream and `ui.errorBox` does the explaining.
- The turn starts with one friendly line that says how `yuvi` understood your request.
