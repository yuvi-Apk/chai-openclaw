# modes/agent/orchestrator.ts

**Purpose:** The **conductor** of agent mode. It makes sure you have an API key, builds the session and its tools, greets you, and then runs the main loop: read your message, open the menu, or hand the message to the brain.

**Where it fits:** [modes/cli.ts](../cli.ts.md) calls `runAgentMode()` when you pick **Agent**. It brings together:
- [input.ts](input.ts.md) for the message box
- [brain.ts](brain.ts.md) for running one turn of the agent
- [ui.ts](ui.ts.md) for everything printed while the agent works
- [approval.ts](approval.ts.md) for the save / discard step
- [ai/index.ts](../../ai/index.ts.md) for the model id and your saved settings
- [types.ts](types.ts.md), [action-tracker.ts](action-tracker.ts.md), [tool-executor.ts](tool-executor.ts.md), [agent-tools.ts](agent-tools.ts.md) for the session parts
- `subagents.ts`, `repo-map.ts`, and `memory.ts` in the same folder for helper agents, the project map, and saved conversations

Concepts: [AI SDK agents](../../../concepts/ai-sdk-agents.md), [staged changes and approval](../../../concepts/staged-changes-and-approval.md).

---

### `MODES` and `MODE_INFO`

```ts
const MODES: AgentMode[] = ["ask", "auto-edit", "plan"];

const MODE_INFO: Record<AgentMode, { name: string; meaning: string; paint: (s: string) => string }> = {
    ask: {
        name: "Ask mode",
        meaning: "I ask before I change files or run commands",
        paint: chalk.green,
    },
    "auto-edit": {
        name: "Auto mode",
        meaning: "I change files without asking; commands still ask",
        paint: chalk.yellow,
    },
    plan: { name: "Plan mode", meaning: "I only read and write a plan; nothing is changed", paint: chalk.blue },
};
```

**What it does:**
- `MODES` lists the three modes in the order Shift+Tab cycles through them.
- `MODE_INFO` is a lookup table. For each mode it stores a friendly `name`, a one-sentence `meaning`, and a `paint` function (a [chalk](../../../concepts/chalk-terminal-colors.md) colour).

**Why it's used in general:** `Record<Key, Value>` is a TypeScript [utility type](../../../concepts/typescript-interfaces-and-utility-types.md) for "an object with exactly these keys". If a new mode is added to `AgentMode` and forgotten here, the code will not compile.

**Why it's used here:** The mode is explained in four places: the welcome text, the hint bar, the help text, and the mode picker. They all read from this one table, so the wording and colour always match.

---

### `HELP`

```ts
const HELP = [
    chalk.bold("How to use yuvi"),
    "",
    `${chalk.cyan("Type a message")}   say what you want in plain words, then press Enter`,
    `${chalk.cyan("/")}                open the menu (mode, model, undo, new chat, …)`,
    `${chalk.cyan("Shift+Tab")}        switch mode: Ask → Auto → Plan`,
    // ...@file, Up / Down, Esc, Ctrl+C...
    chalk.bold("Modes"),
    ...MODES.map((m) => `${MODE_INFO[m].paint("●")} ${MODE_INFO[m].name.padEnd(10)} ${MODE_INFO[m].meaning}`),
].join("\n");
```

**What it does:** It builds the help text once, as an array of lines joined with newlines. The first part lists the keys. The second part lists the modes, generated from `MODE_INFO` with `.map()`. `padEnd(10)` adds spaces so the meanings line up in a column.

**Why it's used in general:** Building multi-line text as an array plus `.join("\n")` is easier to read and edit than one giant string.

**Why it's used here:** There are no commands to memorise. The help teaches a few keys and points to the menu for everything else.

---

### `footer(session, width)`: the hint bar

```ts
const info = MODE_INFO[session.mode];
const head = `  ● ${info.name}: ${info.meaning}`;
const hints = ["shift+tab switch mode", "/ menu", "? help", "@file attach", "ctrl+c exit"];
let plain = head;
const used: string[] = [];
for (const hint of hints) {
    if ((plain + " · " + hint).length > width) break;
    plain += " · " + hint;
    used.push(hint);
}
const shownHead = head.length > width ? head.slice(0, width - 1) + "…" : head;
return info.paint(shownHead) + chalk.dim(used.map((h) => ` · ${h}`).join(""));
```

**What it does:**
- `head` says which mode is active and what it means.
- The loop adds hints one by one, **as long as the line still fits** in `width` characters. The first hint that would not fit stops the loop.
- If even the head is too long, it is cut and ends with `…`.
- The head is painted in the mode's colour and the hints are dim.

**Why it's used in general:** Terminals come in many widths. Measuring the *plain* text before adding colour is important, because colour codes are invisible characters that would spoil the count.

**Why it's used here:** [input.ts](input.ts.md) draws this line under the message box. The most useful hints come first, so a narrow window loses the least important ones.

---

### `createSession(mode)`: building the parts

```ts
const tracker = new ActionTracker();
const executor = new ToolExecutor(config, tracker);
const ui = new AgentUI();

const session: AgentSession = {
    config, mode, tracker, executor, ui,
    messages: [],
    todos: [],
    usage: { inputTokens: 0, outputTokens: 0, lastInputTokens: 0, cost: 0 },
    allowedCommands: new Set(),
    verifiedSeq: 0,
    checkpoint: async () => { /* next section */ },
};
```

**What it does:** Before this snippet it loads the config and the project's **check commands** (saved ones from `.yuvi/config.json`, or detected once and then saved). Then it creates the log, the executor, and the UI, and puts them all in one `session` object together with the conversation, the plan, token usage, and the commands you allowed.

**Why it's used in general:** This is **dependency injection**: build small pieces and hand them to each other. See [typescript-classes.md](../../../concepts/typescript-classes.md).

**Why it's used here:** Every part of agent mode receives the same `session`, so they all see the same log, the same mode, and the same conversation.

---

### `checkpoint`: save what you approved

```ts
checkpoint: async () => {
    if (!executor.hasStaged()) return { applied: [], rejected: [], errors: [] };
    await ui.withPrompt(() =>
        runApprovalFlow(tracker, { autoApprove: session.mode === "auto-edit" }),
    );
    const rejected = executor.revertRejected();
    const { errors, applied } = executor.applyApprovedFromTracker();
    if (applied.length) {
        ui.success(
            `Saved ${applied.length} file${applied.length === 1 ? "" : "s"}: ${applied.join(", ")}` +
            chalk.dim("  (menu → Undo last change to roll back)"),
        );
    }
    if (rejected.length) ui.note(`Discarded, files unchanged: ${rejected.join(", ")}`);
    for (const e of errors) ui.failure(`Could not save a file: ${e}`);
    return { applied, rejected, errors };
},
```

**What it does:**
- Nothing staged → return empty lists.
- It runs the [approval flow](approval.ts.md) inside `ui.withPrompt`, which pauses the spinner. In Auto mode, changes are approved automatically.
- `revertRejected()` drops what you said no to. `applyApprovedFromTracker()` writes what you said yes to.
- Then it reports in plain words: **"Saved 2 files: …"** with a reminder that the menu can undo it, **"Discarded, files unchanged: …"**, and **"Could not save a file: …"** for each error.

**Why it's used in general:** This is the *apply* part of stage → approve → apply. Returning the three lists lets the caller react to what really happened.

**Why it's used here:** The [brain](brain.ts.md) calls `session.checkpoint()` after the agent finishes working, and uses the result to tell the AI which changes you rejected.

---

### `attachMentions(session, message)`

```ts
for (const match of message.matchAll(/(?:^|\s)@([\w./\\-]+)/g)) {
    const rel = match[1]!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    try {
        const content = session.executor.readFile(rel);
        attachments.push(`[Attached file: ${rel}]\n${content}`);
        session.ui.print(chalk.dim(`  ⎿ attached ${rel}`));
    } catch {
        session.ui.note(`Could not attach @${rel}: no such file in this project.`);
    }
}
```

**What it does:**
- The regular expression finds every `@something` that starts the message or follows a space. `match[1]` is the path after the `@`.
- A `Set` called `seen` skips a file mentioned twice.
- If the file can be read, its content is added to the end of your message and a dim "attached" line is printed.
- If it cannot be read, you get a note: "Could not attach @…: no such file in this project."

**Why it's used in general:** `matchAll` with the `g` flag is the modern way to loop over every match of a pattern.

**Why it's used here:** Writing `@src/app.ts` saves the AI a step, because the file is already in the message. A typo in the path is reported instead of being silently ignored.

---

### `setupApiKey()`

```ts
const key = await password({
    message: "Paste your OpenRouter key (Esc to skip):",
    validate: (value) =>
        value && value.trim().length < 20 ? "That looks too short to be a key." : undefined,
});
if (isCancel(key) || !String(key ?? "").trim()) return false;
saveUserSettings({ apiKey: String(key).trim() });
log.success("Key saved. You are ready to go.");
return true;
```

**What it does:**
- Before the prompt, `log.info` prints three numbered steps: open openrouter.ai/keys, create a key, paste it.
- `password` is a clack [prompt](../../../concepts/clack-prompts.md) like `text`, but it hides what you type.
- `validate` refuses anything shorter than 20 characters with a friendly message.
- Esc or an empty answer returns `false` ("skipped").
- Otherwise `saveUserSettings` stores the key in `~/.yuvi/settings.json` and starts using it at once.

**Why it's used in general:** Secrets should never be echoed to the screen, where they could end up in a screenshot or a screen share.

**Why it's used here:** A new user does not need to know what a `.env` file is. `yuvi` walks them through getting a key and remembers it. See [ai.config.ts](../../ai/ai.config.ts.md) and [openrouter.md](../../../concepts/openrouter.md).

---

### `chooseMode(session)` and `chooseModel(session)`

```ts
const picked = await select<AgentMode>({
    message: "Which mode?",
    initialValue: session.mode,
    options: MODES.map((m) => ({
        value: m,
        label: MODE_INFO[m].name,
        hint: MODE_INFO[m].meaning,
    })),
});
if (isCancel(picked)) return;
session.mode = picked;
```

**What it does:** `chooseMode` shows a list of the three modes. Each one has its name as the label and its meaning as the hint. The current mode is pre-selected with `initialValue`. `select<AgentMode>` tells TypeScript the answer is an `AgentMode`.

`chooseModel` works the same way with a `text` prompt. It shows the current model, tells you where to find model ids, and saves your answer with `saveUserSettings({ model })`. Esc or an empty answer keeps the current model.

**Why it's used in general:** A list with explanations beats asking the user to type a name they have to remember.

**Why it's used here:** These are the "long way" to change mode or model, reached from the menu. Shift+Tab is the short way for modes.

---

### `openMenu(session)`: the `/` menu

```ts
const action = await select<MenuAction>({
    message: "Menu",
    options: [
        { value: "mode", label: "Switch mode", hint: `now: ${MODE_INFO[session.mode].name}` },
        { value: "undo", label: "Undo last change", hint: "put files back as they were" },
        { value: "clear", label: "Start a new conversation", hint: "yuvi forgets this chat" },
        { value: "resume", label: "Continue last conversation", hint: "from the previous session" },
        { value: "model", label: "Change AI model", hint: `now: ${getModelId("main")}` },
        // ...Set API key, Free up memory, Show usage, Show check commands, Help, Exit agent, Back
    ],
});
if (isCancel(action) || action === "back") return "handled";
```

**What it does:** It shows one menu with everything you can do besides sending a message. Every option has a plain label and a hint. Esc or **Back** closes the menu. A `switch` then runs the chosen action:

| Menu item | What happens |
|---|---|
| Switch mode | `chooseMode` |
| Undo last change | `executor.undoLast()` puts files back, and a `[harness]` note tells the AI to re-read them |
| Start a new conversation | empties `messages` and `todos` |
| Continue last conversation | loads the saved conversation for this project |
| Change AI model | `chooseModel` |
| Set API key | `setupApiKey` |
| Free up memory | `compactHistory` summarises a long chat |
| Show usage | tokens read and written, cost, and how full the model's memory is |
| Show check commands | the commands `yuvi` runs after changing code |
| Help | prints `HELP` |
| Exit agent | returns `"exit"` |

The function returns `"exit"` only for **Exit agent**, and `"handled"` for everything else.

**Why it's used in general:** `MenuAction` is a [union of string literals](../../../concepts/typescript-union-types.md). Inside the `switch`, TypeScript knows every possible value. A menu is **discoverable**: users can see what exists without reading documentation.

**Why it's used here:** Everything is one keypress (`/`) away, and the wording avoids jargon: "Free up memory" instead of "compact", "Put back as before" instead of "restored".

💡 **Tip:** The undo case pushes a message into `session.messages` that starts with `[harness]`. That is `yuvi` itself speaking to the AI, so the AI does not keep believing its old edit is still in the file.

---

### `showWelcome(session, codeFiles)`

```ts
console.log(
    [
        "",
        chalk.bold.cyan("  yuvi is ready") + chalk.dim(`  ·  ${getModelId("main")}  ·  ${codeFiles} code files in this project`),
        "",
        "  Tell me what you want in plain words and press Enter. For example:",
        chalk.dim("    • explain what this project does"),
        chalk.dim("    • add a button that clears the form"),
        chalk.dim("    • find out why the tests fail and fix it"),
        "",
        `  ${info.paint(`● ${info.name}`)} ${chalk.dim(`— ${info.meaning}`)}`,
        chalk.dim("  I always show you a change before saving it, and you can undo it from the menu."),
    ].join("\n"),
);
```

**What it does:** It prints a short greeting: the model in use, how many code files were found, three example requests, the active mode with its meaning, and a promise that changes are shown first and can be undone.

**Why it's used in general:** An empty prompt is intimidating. Examples show a new user what "a good request" looks like.

**Why it's used here:** It answers the first three questions a beginner has: *What do I type? What will it do to my files? Can I take it back?*

---

### `runAgentMode(options)`: getting ready

```ts
applyUserSettings();
if (!process.env.OPENROUTER_API_KEY && process.stdin.isTTY) {
    if (!(await setupApiKey())) {
        log.warn("No key set. You can add it later: type / and choose “Set API key”.");
    }
}

const session = createSession(options.mode ?? "ask");
const repoMap = new RepoMap(executor);
repoMap.build();
const baseTools = createAgentTools(session, repoMap);
const ctx: BrainContext = {
    repoMap, baseTools,
    tools: { ...baseTools, task: createTaskTool(session, baseTools) } as ToolSet,
};
```

**What it does:**
- `applyUserSettings()` loads your saved key and model into `process.env` (the [environment](../../../concepts/environment-variables.md) still wins).
- If there is still no key and a real person is at the terminal, it runs `setupApiKey()`. Skipping gives a gentle reminder of where to add it later.
- It creates the session (Ask mode by default), builds a map of the project's code, and creates the tools. The `task` tool, which starts helper agents, is added on top of the base tools.

**Why it's used in general:** Checking for required setup at the start, and offering to fix it right there, is called **onboarding**.

**Why it's used here:** Without a key the first message would fail. Asking up front turns a confusing error into a guided step.

---

### `runAgentMode(options)`: the main loop

```ts
while (true) {
    const input = await readInput({
        footer: (width) => footer(session, width),
        onCycleMode: () => {
            session.mode = MODES[(MODES.indexOf(session.mode) + 1) % MODES.length]!;
        },
        history,
        placeholder: "Type your message, then press Enter",
    });

    if (input.kind === "exit") break;
    if (input.kind === "menu") {
        if ((await openMenu(session)) === "exit") break;
        continue;
    }
    // ...text shortcuts (below), then:
    history.push(line);
    try {
        await runTurn(session, ctx, attachMentions(session, line));
    } catch (error) {
        ui.errorBox(errorText(error));
    }
}
```

**What it does:**
- `readInput` from [input.ts](input.ts.md) shows the message box. It receives two **callbacks**: `footer`, which it calls to draw the hint bar, and `onCycleMode`, which it calls when you press Shift+Tab.
- `(index + 1) % MODES.length` moves to the next mode and wraps around to the first after the last. `%` is the remainder operator.
- The result has a `kind`: `"exit"` leaves the loop, `"menu"` opens the menu, and `"message"` carries your text.
- A real message is remembered in `history` (for the Up / Down keys), gets its `@file` mentions attached, and goes to `runTurn` in [brain.ts](brain.ts.md).
- If something unexpected goes wrong, `ui.errorBox` explains it in plain words (see [ui.ts](ui.ts.md)).

A few typed words are also understood, for people who prefer typing:

```ts
if (line === "exit" || line === "/exit" || line === "quit") break;
if (line === "/help" || line === "help") { log.info(HELP); continue; }
if (line.startsWith("/")) {
    if ((await openMenu(session)) === "exit") break;
    continue;
}
```

`exit`, `/exit`, or `quit` leave. `help` or `/help` show the help. Any other text starting with `/` opens the menu.

**Why it's used in general:** A `while (true)` loop that reads input, acts, and repeats is the heart of every interactive program. Passing callbacks lets the input box stay ignorant of what a "mode" is. Checking `kind` is [type narrowing](../../../concepts/typescript-union-types.md): after `input.kind === "menu"` is ruled out, TypeScript knows `input.text` exists.

**Why it's used here:** The loop is the whole conversation. Each round is one message from you and one full turn from the agent.

---

### Leaving agent mode

```ts
if (executor.hasStaged()) {
    log.warn("yuvi prepared changes that you have not decided on yet.");
    await session.checkpoint();
}
executor.clearStaging();
```

**What it does:** If you leave while changes are still waiting, it tells you so and runs the save / discard step one last time. Then it empties the staging area.

**Why it's used in general:** Clean-up code after a loop makes sure nothing is left half-done.

**Why it's used here:** You always get the last word on changes, even when you exit in a hurry.

---

### 🧠 Key takeaways
- The orchestrator sets things up, then loops: message box → menu or message → one agent turn.
- `MODE_INFO` is the single source for how each mode is named, explained, and coloured.
- There are no commands to memorise: `/` opens a menu, Shift+Tab switches mode, `?` shows help.
- A missing API key is handled by a guided prompt, and the key is saved for every project.
- All user-facing wording is plain: "Saved", "Discarded", "Put back as before", "Free up memory".
