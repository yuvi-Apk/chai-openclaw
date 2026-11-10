# modes/agent/action-tracker.ts

**Purpose:** The agent's **notebook**. Every time the agent reads, stages, or queues something, it writes an entry here. Later, the approval step reads the notebook to see what's waiting.

**Where it fits:** It stores [`ActionLog`](types.ts.md) entries. [tool-executor.ts](tool-executor.ts.md) writes to it, [approval.ts](approval.ts.md) receives it, and [orchestrator.ts](orchestrator.ts.md) creates one per run. See [typescript-classes.md](../../../concepts/typescript-classes.md) and [staged-changes-and-approval.md](../../../concepts/staged-changes-and-approval.md).

---

### The class and its list

```ts
import type {ActionLog,ActionStatus} from "./types";
import {isMutationType} from "./types";

export class ActionTracker {
    private actions: ActionLog[] = [];
```

**What it does:** It imports the types (with `import type`, so types only) and the `isMutationType` helper. The class keeps one **private** array of actions, which starts empty.

**Why it's used in general:** A class bundles data with the methods that manage it. `private` means outside code must go through the methods.

**Why it's used here:** Only the tracker can add or change entries, so the log stays trustworthy.

---

### `log(entry)`

```ts
log(entry: Omit<ActionLog,"id"|"timestamp"|"status"> & {
    id?: string; timestamp?: Date; status?: ActionStatus;
}){
    const action: ActionLog = {
        id: entry.id || crypto.randomUUID(),
        timestamp: entry.timestamp || new Date(),
        type: entry.type,
        path: entry.path,
        details: {...entry.details},
        status: entry.status || 'pending',
        userApproved: entry.userApproved,
    };
    this.actions.push(action);
    return action;
}
```

**What it does:**
- The parameter type says: "give me an `ActionLog`, but `id`, `timestamp`, and `status` are optional" (see [Omit and `&`](../../../concepts/typescript-interfaces-and-utility-types.md)).
- Missing values get defaults: a random unique ID (`crypto.randomUUID()`, built into Bun), the current time, and status `'pending'`.
- `{...entry.details}` makes a **copy** of the details object, so later changes to the caller's object don't change the log.
- It adds the action to the list and returns it.

**Why it's used in general:** "Fill in defaults, then store" is a common shape for logging and record-keeping functions.

**Why it's used here:** Callers only say what matters (`type`, `path`, `details`, maybe `status`). Mutations default to `pending`, which is exactly what needs approval.

---

### `getActions()` and `getPendingMutations()`

```ts
getActions():readonly ActionLog[] {
    return this.actions;
}

getPendingMutations():ActionLog[] {
    return this.actions.filter((action) => isMutationType(action.type) && action.status === 'pending');
}
```

**What it does:**
- `getActions()` returns the whole log as a `readonly` array, so callers can read it but TypeScript won't let them push or remove items.
- `getPendingMutations()` uses `.filter` to keep only actions that **change something** and are still **pending**.

**Why it's used in general:** `.filter` makes a new array of the items that pass a test, and the original is left alone.

**Why it's used here:** `getActions()` feeds the apply step in [tool-executor.ts](tool-executor.ts.md). `getPendingMutations()` is the "shopping cart" an approval screen can show the user.

---

### `updateActionStatus(id, status, userApproved?)`

```ts
updateActionStatus(id:string, status:ActionStatus, userApproved?:boolean):boolean {
    const action = this.actions.find((action) => action.id === id);
    if(!action) return false;
    action.status = status;
    if(userApproved !== undefined) {
        action.userApproved = userApproved;
    }
    return true;
}
```

**What it does:** It finds the action with this `id`. If none is found, it returns `false`. Otherwise it sets the new status (and `userApproved` if one was given) and returns `true`.

**Why it's used in general:** Returning `true`/`false` for "did it work?" is a simple, no-exception way to report success.

**Why it's used here:** This is how a decision gets recorded. An approval step marks each pending action `approved` or `rejected`, and the apply step only acts on `approved` ones.

💡 **Tip:** `userApproved !== undefined` (instead of `if (userApproved)`) matters. It lets you store `false` on purpose, since `if (false)` would skip it.

---

### 🧠 Key takeaways
- The tracker is an append-only notebook of everything the agent did or wants to do.
- `log()` fills in an ID, a time, and a `pending` status for you.
- `getPendingMutations()` is the list that needs the user's yes or no.
- `updateActionStatus()` records that decision, which controls what gets applied.
