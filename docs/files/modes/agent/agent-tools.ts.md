# modes/agent/agent-tools.ts

**Purpose:** The agent's **toolbox**. It lists every ability the AI may use (read a file, stage a change, search, run a command, and so on), described in words the AI can understand.

**Where it fits:** [orchestrator.ts](orchestrator.ts.md) calls `createAgentTools(executor)` and hands the result to the `ToolLoopAgent`. Each tool's real work is done by [tool-executor.ts](tool-executor.ts.md). Concepts: [AI SDK tools](../../../concepts/ai-sdk-agents.md) and [Zod schemas](../../../concepts/zod-schemas.md).

---

### `createAgentTools(executor)`

```ts
import { tool } from "ai";
import z from "zod";
import type { ToolExecutor } from "./tool-executor";

export function createAgentTools(executor: ToolExecutor) {
    return {
        read_file: tool({ ... }),
        create_file: tool({ ... }),
        // ...and nine more
    }
}
```

**What it does:** It returns an object where each **key is a tool name** (like `read_file`) and each value is a `tool({...})` definition. The `executor` is passed in so every tool can use the same one.

**Why it's used in general:** The AI SDK expects tools as a `{ name: tool }` object. Building it inside a function is a neat way to "plug in" whatever helper the tools need.

**Why it's used here:** The tools are only thin **descriptions**. All the real logic and safety checks live in `ToolExecutor`. That keeps this file easy to read: it's basically a menu for the AI.

---

### The shape of one tool: `read_file`

```ts
read_file: tool({
    description:
        "Read a text file from the workspace. Use a path relative to the project root.",
    inputSchema: z.object({
        path: z.string().describe("Relative file path"),
    }),
    execute: async ({ path: p }) => executor.readFile(p),
}),
```

**What it does:**
- `description`: tells the AI when to use this tool.
- `inputSchema`: says the AI must send `{ path: string }`. `.describe(...)` explains the field to the AI.
- `execute`: runs `executor.readFile(p)`. Whatever it returns goes back to the AI. `{ path: p }` unpacks `path` and renames it to `p`.

**Why it's used in general:** Every AI SDK tool has these same three parts. Once you've seen one, you can read them all.

**Why it's used here:** The AI gets a safe, well-described way to look at your project files.

---

### Change tools: create, modify, delete, folder

```ts
create_file:   { path, content }  → executor.createFile(p, content)
modify_file:   { path, content }  → executor.modifyFile(p, content)
delete_file:   { path }           → executor.deleteFile(p)
create_folder: { path }           → executor.createFolder(p)
```

(This is a summary. Each one is a full `tool({...})` in the file.)

**What it does:** Each one **stages** a change: it's recorded as pending and nothing is written yet. Their descriptions say "pending approval" on purpose, so the AI knows the change isn't real until you say yes. `modify_file` replaces the *whole* file with `content`.

**Why it's used in general:** Separating "ask for a change" from "make the change" is a common safety pattern for AI agents.

**Why it's used here:** It follows the [stage → approve → apply](../../../concepts/staged-changes-and-approval.md) design. You stay in control of your files.

---

### Look-around tools: list, search, analyze

```ts
list_files: tool({
    description: "List files and directories under a path.",
    inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
    }),
    execute: async ({ path: p, recursive }) => executor.listFiles(p, recursive),
}),
```

**What it does:**
- `list_files`: lists a folder. With `recursive: true`, it lists sub-folders too. The default is `false`.
- `search_files` takes `{ root, pattern, content_contains? }`. It finds files matching a glob like `"**/*.ts"`, and can also keep only files whose text contains a word.
- `analyze_codebase` takes `{ path = "." }` and gives a quick count of files and folders.

**Why it's used in general:** Agents need to *explore* before they act, just like you'd look around a new codebase.

**Why it's used here:** These are read-only, so they run right away (no approval needed) and are logged as `executed`.

---

### `execute_shell`

```ts
execute_shell: tool({
    description:
        "Queue a shell command to run in the workspace after user approval. Use with care.",
    inputSchema: z.object({
        command: z.string().describe("Single command; runs with shell: true"),
    }),
    execute: async ({ command }) => executor.queueShell(command),
}),
```

**What it does:** It **queues** a shell command, such as `bun test`. It only runs later, after approval.

**Why it's used in general:** Running commands is the most powerful (and riskiest) thing an agent can do, so it's usually gated.

**Why it's used here:** It lets the agent suggest something like "run the tests", while you still decide.

---

### Skill tools: `list_skills` and `read_skill`

```ts
list_skills: tool({
    description: "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
    inputSchema: z.object({}),
    execute: async () => executor.listSkills(),
}),
```

**What it does:** `list_skills` takes no input (`z.object({})`) and finds `SKILL.md` instruction files in your Cursor and Claude skill folders. `read_skill({ path })` reads one of them.

**Why it's used in general:** "Skills" are reusable instruction files that teach an AI how to do a particular job.

**Why it's used here:** It lets `yuvi` borrow skills you already have on your machine.

---

### 🧠 Key takeaways
- Every tool = `description` + `inputSchema` (Zod) + `execute`.
- Tool names are the object's keys. The AI calls them by those names.
- Read-only tools run right away, while change and shell tools only *stage* or *queue*.
- This file is just a menu. The real work and safety live in [ToolExecutor](tool-executor.ts.md).
