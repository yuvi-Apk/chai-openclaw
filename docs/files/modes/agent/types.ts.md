# modes/agent/types.ts

**Purpose:** The **dictionary** for agent mode. It defines what an "action" looks like, the agent's settings, and a default config. Every other agent file speaks in these words.

**Where it fits:** [action-tracker.ts](action-tracker.ts.md) stores `ActionLog`s and uses `isMutationType`. [tool-executor.ts](tool-executor.ts.md) reads `AgentConfig`. [orchestrator.ts](orchestrator.ts.md) calls `defaultAgentConfig()`. Background reading: [union types](../../../concepts/typescript-union-types.md) and [interfaces & utility types](../../../concepts/typescript-interfaces-and-utility-types.md).

---

### `ActionType` and `ActionStatus`

```ts
export type ActionType =
    | 'file_create'
    | 'file_modify'
    | 'file_delete'
    | 'folder_create'
    | 'code_analysis'
    | 'tool_execute';

export type ActionStatus = 'pending' | 'executed' | 'approved' | 'rejected';
```

**What it does:**
- `ActionType` lists every kind of thing the agent can do: four file/folder changes, `code_analysis` (read-only looking around), and `tool_execute` (a shell command).
- `ActionStatus` is where an action is in its life:
  - `pending`: staged and waiting for the user
  - `approved` / `rejected`: the user decided
  - `executed`: already done (used for harmless read-only actions)

**Why it's used in general:** String-literal unions are TypeScript's lightweight "enum". They're readable and safe from typos.

**Why it's used here:** They power the [stage → approve → apply](../../../concepts/staged-changes-and-approval.md) flow. The status says which step an action is at.

---

### `ActionLog`

```ts
export interface ActionLog {
    id: string;
    timestamp: Date;
    type: ActionType;
    path: string;
    details: {
        before?: string;
        after?: string;
        toolName?: string;
        toolResult?: string;
        error?: string;
        command?: string;
    };
    status: ActionStatus;
    userApproved?: boolean;
}
```

**What it does:** It describes one entry in the agent's action log:
- `id` / `timestamp`: a unique ID and when it happened
- `type` / `path`: what kind of action, and which file or folder
- `details`: optional extras. `before` / `after` hold old and new file contents, `command` holds a shell command, and `toolName` says which tool made it.
- `status` / `userApproved`: the decision state

**Why it's used in general:** An **interface** names the shape of an object, so every part of the code agrees on it.

**Why it's used here:** The tracker, executor, and (later) the approval screen all pass these around. Keeping `before` and `after` makes it possible to show the user a "what will change" preview.

---

### `AgentConfig` and `defaultAgentConfig()`

```ts
export const defaultAgentConfig = (): AgentConfig => ({
    codebasePath: process.cwd(),
    maxFileSizeToRead: 1024 * 1024,
    excludePatterns: ['node_modules', '.git', 'dist', 'build', '.next', '*.log', '.env*'],
    tools: {
        allowShellExecution: true,
        allowFileModification: true,
        allowFileCreation: true,
        allowFolderCreation: true,
    },
});
```

(The `AgentConfig` interface above it declares exactly these keys and their types.)

**What it does:**
- `codebasePath`: the "workspace root", meaning the folder you ran `yuvi` from (`process.cwd()`).
- `maxFileSizeToRead`: 1 MB (1024 × 1024 bytes). Bigger files are refused.
- `excludePatterns`: folders and files the agent must never touch, such as dependencies, Git internals, build output, logs, and **`.env` secrets**.
- `tools`: on/off switches for each risky ability.

**Why it's used in general:** A config object with sensible defaults is a common way to make behaviour adjustable without changing code everywhere.

**Why it's used here:** It sets the agent's **safety fence**: where it may work, what it may not see, and which powers it has. Because it's a function, each run gets a fresh copy.

---

### `isMutationType(t)`

```ts
export function isMutationType(t: ActionType): boolean {
    return (
        t === 'file_create' || t === 'file_modify' || t === 'file_delete' ||
        t === 'folder_create' || t === 'tool_execute'
    );
}
```

**What it does:** It returns `true` for any action that **changes things** (files, folders, or running commands), and `false` for read-only `code_analysis`.

**Why it's used in general:** A small "is it X?" helper keeps a rule in one place instead of repeating it.

**Why it's used here:** [ActionTracker.getPendingMutations()](action-tracker.ts.md) uses it to find exactly the actions that need the user's approval.

---

### 🧠 Key takeaways
- `ActionType` = *what* happened, and `ActionStatus` = *where it is* in stage → approve → apply.
- `ActionLog` keeps `before` / `after`, so changes can be previewed.
- `defaultAgentConfig()` is the agent's safety fence: root folder, size limit, excluded paths, and power switches.
- "Mutation" means "changes something", which is what needs approval.
