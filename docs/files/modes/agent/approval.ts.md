# modes/agent/approval.ts

**Purpose:** The **"are you sure?"** step of agent mode. It is the spot where the user will review the agent's staged changes and decide whether to go ahead. Right now it is a starter placeholder.

**Where it fits:** [orchestrator.ts](orchestrator.ts.md) calls `runApprovalFlow(tracker)` after the agent finishes, passing the [ActionTracker](action-tracker.ts.md) that holds every staged action. What it returns decides whether the orchestrator applies changes or clears them. Background: [staged-changes-and-approval.md](../../../concepts/staged-changes-and-approval.md).

---

### `runApprovalFlow(tracker)`

```ts
import type { ActionTracker } from "./action-tracker";

export async function runApprovalFlow(tracker:ActionTracker):Promise<Boolean> {
    return true;
}
```

**What it does:**
- It takes the tracker (typed with `import type`, so it's only used for type-checking).
- It is `async`, so it returns a Promise. That leaves room for it to `await` user prompts later.
- For now it always answers `true` ("carry on") and doesn't change any action's status.

**Why it's used in general:** Writing a **stub** (a function with the right name and signature but simple insides) lets you wire up the whole flow first and fill in the details later.

**Why it's used here:** The orchestrator already calls it in the right place. The apply step in [tool-executor.ts](tool-executor.ts.md) only writes actions whose status is `approved`. While this stub leaves every action `pending`, nothing staged is written to disk yet. The full approval screen will:
1. get `tracker.getPendingMutations()`
2. show each change to the user (for example, with a clack `confirm` or `multiselect`)
3. call `tracker.updateActionStatus(id, "approved" | "rejected", true | false)`
4. return `false` if the user cancels everything

💡 **Tip:** For the return type, TypeScript recommends lowercase `Promise<boolean>`. Capital `Boolean` is the wrapper-object type. See [typescript-interfaces-and-utility-types.md](../../../concepts/typescript-interfaces-and-utility-types.md).

---

### 🧠 Key takeaways
- This is the "checkout" step of stage → approve → apply.
- It's a stub for now: it says "yes" and doesn't mark anything approved.
- When finished, it will turn `pending` actions into `approved` or `rejected` through the tracker.
