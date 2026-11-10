# TypeScript interfaces and utility types (`Omit`, `readonly`, `import type`)

## Interfaces: naming the shape of an object

An **interface** describes which keys an object has and what type each one is.

```ts
interface ActionLog {
  id: string;
  timestamp: Date;
  status: ActionStatus;
  userApproved?: boolean;   // `?` = optional, may be missing
}
```

Think of it as a **label on a storage box** that lists exactly what should be inside.

Interfaces only exist while type-checking. They add zero code at runtime.

## `Omit<T, Keys>`: "the same, minus these keys"

```ts
type NewEntry = Omit<ActionLog, "id" | "timestamp" | "status">;
```

This makes a new type with every key of `ActionLog` *except* `id`, `timestamp`, and `status`.

You can combine it with `&` (an **intersection**, meaning "both of these") to add the keys back as optional:

```ts
type LogInput = Omit<ActionLog, "id" | "timestamp" | "status"> & {
  id?: string;
  timestamp?: Date;
  status?: ActionStatus;
};
```

The result means: "give me everything an `ActionLog` needs, but `id`, `timestamp`, and `status` are optional, because I'll fill in defaults."

## `readonly T[]`: a list you can look at but not change

```ts
getActions(): readonly ActionLog[] { ... }
```

Callers can loop over and read the array, but TypeScript stops them from `push`ing or removing items. It's like handing someone a **photo of your shelf**, not the shelf itself.

## `import type`

```ts
import type { ActionLog } from "./types";
```

This imports **only the type**, never runtime code. It makes it clear that the import is just for type-checking, and it gets removed entirely when the code runs.

## Functions that return objects

```ts
export const defaultAgentConfig = (): AgentConfig => ({ ... });
```

The `({ ... })` parentheses tell JavaScript "this is an object to return, not a function body". Using a *function* (instead of a plain constant object) means each caller gets a **fresh copy**, so nobody accidentally edits a shared one.

💡 **Tip:** Write lowercase `boolean`, `string`, and `number` for types. The capitalised `Boolean`, `String`, and `Number` are wrapper objects, and TypeScript's docs recommend the lowercase forms.

See also: [typescript-union-types.md](typescript-union-types.md) for `'a' | 'b'` types.

**Used in:** [files/modes/agent/types.ts.md](../files/modes/agent/types.ts.md), [files/modes/agent/action-tracker.ts.md](../files/modes/agent/action-tracker.ts.md)
