# modes/agent/tool-executor.ts

**Purpose:** The **hands** of the agent. Every tool the AI calls ends up as a method here. This file reads files, stages changes, searches, queues commands, and finally applies approved changes to disk. It also enforces the safety rules.

**Where it fits:** [agent-tools.ts](agent-tools.ts.md) points each tool's `execute` at a method here. It reads settings from [`AgentConfig`](types.ts.md) and writes every action into the [ActionTracker](action-tracker.ts.md). [orchestrator.ts](orchestrator.ts.md) calls `applyApprovedFromTracker()` and `clearStaging()` at the end. Concepts: [node fs/path](../../../concepts/node-fs-path.md), [classes](../../../concepts/typescript-classes.md), and [staging and approval](../../../concepts/staged-changes-and-approval.md).

---

### Text-file detection

```ts
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".json", ".md", /* ...more */ ".txt"]);

function isProbablyTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return TEXT_EXT.has(ext) || ext === "";
}
```

**What it does:** It keeps a `Set` of file endings that are usually plain text. `isProbablyTextFile` checks a file's ending against it. Files with *no* ending (like `Dockerfile`) also count as text.

**Why it's used in general:** A `Set` is a list made for fast "is this in here?" checks with `.has()`.

**Why it's used here:** When searching *inside* files, it skips images and other binary files, which would just be gibberish as text.

---

### The class, its staging area, and `norm`

```ts
export class ToolExecutor {
    private overlay = new Map<string, string>();
    private deleted = new Set<string>();
    private readonly norm = (rel: string) =>
        path.posix.normalize(rel.split(path.sep).join("/")).replace(/^\.\//, "");

    constructor(
        private readonly config: AgentConfig,
        private readonly tracker: ActionTracker) { }
```

**What it does:**
- `overlay`: a `Map` of *path → staged new content*. It acts as a scratch copy of files the AI has created or changed.
- `deleted`: paths staged for deletion.
- `norm`: tidies a path into one standard form. It turns Windows `\` into `/`, cleans things like `a//b`, and removes a leading `./`. That way `.\src\a.ts` and `src/a.ts` become the same key.
- The constructor uses **parameter properties** to store `config` and `tracker`.

**Why it's used in general:** `Map` is the go-to key → value store, and normalising keys stops "same thing, different spelling" bugs.

**Why it's used here:** The overlay and deleted set let the AI work as if its changes already happened, while the real disk stays untouched until approval.

---

### Safety guards: `resolveSafe`, `excluded`, `assertNotExcluded`

```ts
private resolveSafe(rel: string): string {
    const abs = path.resolve(this.config.codebasePath, rel);
    const root = path.resolve(this.config.codebasePath);
    const relCheck = path.relative(root, abs);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
        throw new Error(`Path escapes workspace: ${rel}`);
    }
    return abs;
}
```

**What it does:**
- `resolveSafe` turns a relative path into a full one. Then it checks that the path is still **inside** the workspace. Anything like `../../secret` throws an error. This is the classic [path-traversal guard](../../../concepts/node-fs-path.md).
- `excluded(relPath)` checks the path against `config.excludePatterns`:
  - `*.log` matches names ending in `.log`
  - `.env*` matches names starting with `.env`
  - any other pattern that contains `*` is skipped
  - plain names (like `node_modules`) match if they appear as any **folder segment** of the path
- `assertNotExcluded(rel, op)` throws a clear error like `read_file: path is excluded by policy: .env` if a path is excluded.

**Why it's used in general:** Never trust a path that came from outside, whether from a user or an AI. Check it first.

**Why it's used here:** These guards are the agent's **fence**. It can't wander out of your project or peek at secrets and dependencies.

---

### `getEffectiveText(rel)`: what the file looks like *right now*

```ts
getEffectiveText(rel: string): string | undefined {
    const key = this.norm(rel);
    if (this.deleted.has(key)) return undefined;
    if (this.overlay.has(key)) return this.overlay.get(key);
    const abs = this.resolveSafe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
    return fs.readFileSync(abs, "utf8");
}
```

**What it does:** It answers "what is this file's content, counting staged changes?":
1. If the file is staged for deletion, the answer is `undefined` (gone).
2. If it's in the overlay, the answer is the staged content.
3. Otherwise it reads the real file from disk, or returns `undefined` if there isn't one.

**Why it's used in general:** This "check the scratch layer, then fall back to the real thing" order is how overlays and caches usually work.

**Why it's used here:** `modifyFile` and `deleteFile` use it to grab the `before` text, even if the file was already changed earlier in the same run.

---

### `readFile(rel)`

```ts
readFile(rel: string): string {
    this.assertNotExcluded(rel, "read_file");
    const abs = this.resolveSafe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`File not found: ${rel}`);
    if (fs.statSync(abs).size > this.config.maxFileSizeToRead) throw new Error(`File too large: ${rel}`);
    const text = fs.readFileSync(abs, "utf8");
    this.tracker.log({ type: "code_analysis", path: this.norm(rel),
        details: { after: text, toolName: "read_file" }, status: "executed" });
    return text;
}
```

(The real code spreads this over a few more lines.)

**What it does:** It checks the exclude list, the workspace fence, that the file exists, and the size limit (1 MB). Then it reads the text from **disk**, logs it as an `executed` read, and returns it to the AI.

**Why it's used in general:** Checks first, then work, then record. This is a solid order for any tool.

**Why it's used here:** When a tool throws an `Error`, the AI SDK sends the message back to the AI, so it can understand what went wrong and try something else.

---

### Staging changes: `createFile`, `modifyFile`, `deleteFile`, `createFolder`

```ts
modifyFile(rel: string, content: string): string {
    if (!this.config.tools.allowFileModification)
        throw new Error("File modification disabled");
    this.assertNotExcluded(rel, "modify_file");
    const before = this.getEffectiveText(rel);
    if (before === undefined)
        throw new Error(`modify_file: file not found: ${rel}`);
    const key = this.norm(rel);
    this.overlay.set(key, content);
    this.tracker.log({ type: "file_modify", path: key,
        details: { before, after: content }, status: "pending" });
    return `Staged update: ${key}`;
}
```

**What it does:** All four follow the same recipe. Check the config switch, check the exclude list, update the staging area, log a **`pending`** action, and return a short message to the AI.
- `createFile`: refuses if the file already exists (unless it's staged for deletion). It removes the path from `deleted` and puts the content in `overlay`.
- `modifyFile`: needs the file to exist (counting staged changes). It saves `before` and `after`, so the change can be previewed.
- `deleteFile`: removes the path from `overlay`, adds it to `deleted`, and remembers `before`. (It uses the `allowFileModification` switch.)
- `createFolder`: only logs the request. The folder is made at apply time.

**Why it's used in general:** Using the same recipe for similar methods makes the code easy to predict.

**Why it's used here:** None of these touch the disk. They only **stage**, which is the first step of stage → approve → apply.

---

### Looking around: `listFiles`, `searchFiles`, `analyzeCodebase`

```ts
const walk = (dir: string, prefix: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const relP = path.relative(this.config.codebasePath, full);
        if (this.excluded(relP)) continue;
        if (ent.isDirectory()) {
            lines.push(`${prefix}${ent.name}/`);
            if (recursive) walk(full, `${prefix}${ent.name}/`);
        } else lines.push(`${prefix}${ent.name}`);
    }
};
```

**What it does:** All three use a small **recursive `walk`** function that visits a folder and skips excluded paths.
- `listFiles(rel, recursive)`: collects names (folders end with `/`), goes deeper if `recursive` is set, sorts the list, and returns it (or `"(empty)"`).
- `searchFiles(root, pattern, contentQuery?)`: turns a glob into a regular expression. `**` becomes "anything, including `/`", `*` becomes "anything except a slash", and `?` becomes "one character". It matches that against the relative path *or* the file name. If `contentQuery` is given, it only keeps text files that contain it. Duplicates are removed with `new Set(...)`.
- `analyzeCodebase(rel)`: counts files and folders, then returns `Files: N | Directories: M`.

Each one logs an `executed` `code_analysis` action.

**Why it's used in general:** A function that calls itself for each sub-folder is the classic way to visit a whole tree.

**Why it's used here:** These give the AI a safe map of your project before it suggests changes.

💡 **Tip:** In `regexFromGlob`, the `§§` is a temporary placeholder. It protects `**` while single `*`s are replaced, then gets swapped for `.*`. It's a handy trick when one replacement could mess up another.

---

### `queueShell(command)`

```ts
queueShell(command: string): string {
    if (!this.config.tools.allowShellExecution)
        throw new Error("Shell execution disabled");
    this.tracker.log({ type: "tool_execute", path: "shell",
        details: { command, toolName: "execute_shell" }, status: "pending" });
    return `Shell queued: ${command}`;
}
```

**What it does:** It doesn't run anything. It records the command as a **pending** `tool_execute` action.

**Why it's used here:** Shell commands only run in the apply step, and only if approved.

---

### Skills: `skillRoots`, `listSkills`, `readSkill`

```ts
skillRoots(): string[] {
    const extra = process.env.SKILLS_DIRS?.split(/[;]/)
        .map((s) => s.trim()).filter(Boolean) ?? [];
    return [
        ...extra,
        path.join(homedir(), ".cursor/skills-cursor"),
        path.join(homedir(), ".claude/skills"),
    ];
}
```

**What it does:**
- `skillRoots()` builds the list of skill folders: any extra folders from the `SKILLS_DIRS` [environment variable](../../../concepts/environment-variables.md) (separated by `;`), plus the default Cursor and Claude skill folders in your home directory.
- `listSkills()` walks each folder that exists and collects every file named `SKILL.md`.
- `readSkill(path)` makes the path absolute, checks that it's **inside one of the skill roots** (a separate fence from the workspace one), then reads it.

**Why it's used in general:** `?.` plus `?? []` means "if the variable isn't set, just use an empty list". `.filter(Boolean)` drops empty strings.

**Why it's used here:** Skills live *outside* the project, so they need their own allow-list instead of `resolveSafe`.

---

### `applyApprovedFromTracker()`: making it real

```ts
const lastByPath = new Map<string, ActionLog>();
for (const a of fileOps) lastByPath.set(this.norm(a.path), a);

for (const [p, a] of lastByPath) {
    try {
        if (a.type === "file_delete") fs.rmSync(this.resolveSafe(p), { force: true });
        else {
            const target = this.resolveSafe(p);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, a.details.after ?? "", "utf8");
        }
    } catch (e) { errors.push(String(e)); }
}
```

**What it does:** It goes through every action with status **`approved`**, in this order:
1. **Folders**: `mkdirSync(..., { recursive: true })`, like `mkdir -p`.
2. **Files**: it sorts file creates, modifies, and deletes by time, then keeps only the **last action per path** (a `Map` overwrites earlier entries). Then it deletes, or creates the parent folder and writes the final content.
3. **Shell commands**: runs each with `spawnSync(cmd, { shell: true, cwd: workspace })`. A non-zero exit code is added to `errors`.

Each operation is wrapped in `try/catch`, so one failure doesn't stop the rest. It returns `{ errors }`.

**Why it's used in general:** "Collect errors and keep going" is a friendly pattern for batch jobs.

**Why it's used here:** It is the **apply** step. Because "last write wins", a file the AI edited three times is written once, with its final version.

---

### `clearStaging()`

```ts
clearStaging(): void {
    this.overlay.clear()
    this.deleted.clear()
}
```

**What it does:** It empties the scratch copy and the delete list.

**Why it's used here:** The orchestrator calls it at the end of every run (or when approval is declined), so the next request starts fresh.

---

### 🧠 Key takeaways
- Every tool call goes through guards first: config switches, the exclude list, and the workspace fence.
- Change tools only **stage** into `overlay` and `deleted`, and log `pending` actions.
- Read tools run right away and log `executed` actions.
- `applyApprovedFromTracker()` is the only place that writes to disk or runs shell commands, and only for `approved` actions.
- "Last write per path wins", so each file is written once with its final content.
