# ai/index.ts

**Purpose:** The **front desk** of the `ai/` folder. It re-exports `getAgentModel` so other code can simply import from `"../../ai"`.

**Where it fits:** It forwards `getAgentModel` from [ai/ai.config.ts](ai.config.ts.md). [modes/agent/orchestrator.ts](../modes/agent/orchestrator.ts.md) imports from here.

---

### The re-export

```ts
export {getAgentModel} from "./ai.config";
```

**What it does:** In one line, it imports `getAgentModel` from `./ai.config` and exports it again from this file.

**Why it's used in general:** This is a [barrel file](../../concepts/barrel-files.md). It gives a folder one tidy public entry point.

**Why it's used here:** As the `ai/` folder grows (for example, with more providers or chat helpers), callers keep importing from `"../../ai"` and don't need to know which file holds what.

---

### 🧠 Key takeaways
- `export { x } from "./file"` means "pass this along".
- Importing a folder path loads its `index.ts`.
- Barrels keep imports short and stable.
