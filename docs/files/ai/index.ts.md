# ai/index.ts

**Purpose:** The **front desk** of the `ai/` folder. It re-exports the public functions and types of the folder, so other code can simply import from `"../../ai"`.

**Where it fits:** It forwards everything from [ai/ai.config.ts](ai.config.ts.md). [modes/agent/orchestrator.ts](../modes/agent/orchestrator.ts.md) and [modes/agent/brain.ts](../modes/agent/brain.ts.md) import from here.

---

### Re-exporting the functions

```ts
export {
    applyUserSettings,
    getAgentModel,
    getModelId,
    getReasoningOverride,
    readUserSettings,
    saveUserSettings,
} from "./ai.config";
```

**What it does:** In one statement it imports six functions from `./ai.config` and exports them again from this file:
- `getAgentModel`, `getModelId`, `getReasoningOverride`: pick the model and its settings.
- `readUserSettings`, `saveUserSettings`, `applyUserSettings`: read, save, and load your personal settings file.

**Why it's used in general:** This is a [barrel file](../../concepts/barrel-files.md). It gives a folder one tidy public entry point.

**Why it's used here:** Callers write `import { getModelId, saveUserSettings } from "../../ai"` and don't need to know which file inside `ai/` holds what.

---

### Re-exporting the types

```ts
export type { ModelRole, ReasoningEffort, UserSettings } from "./ai.config";
```

**What it does:** It passes along three **types**. `export type` tells TypeScript these are type-only, so they vanish completely when the code runs.

**Why it's used in general:** Marking type-only exports keeps the compiled output clean. See [typescript-interfaces-and-utility-types.md](../../concepts/typescript-interfaces-and-utility-types.md).

**Why it's used here:** Other files can describe "a model role" or "the saved settings" with the same names this folder uses.

---

### 🧠 Key takeaways
- `export { x } from "./file"` means "pass this along".
- `export type { T } from "./file"` does the same for types only.
- Importing a folder path loads its `index.ts`.
- Barrels keep imports short and stable.
