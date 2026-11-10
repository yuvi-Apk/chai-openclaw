# Barrel files (`index.ts` re-exports)

A **barrel file** is an `index.ts` inside a folder that *re-exports* things from the other files in that folder.

```ts
// ai/index.ts
export { getAgentModel } from "./ai.config";
```

Now other code can import from the **folder** instead of a specific file:

```ts
import { getAgentModel } from "../../ai";   // finds ai/index.ts automatically
```

Think of it as the **reception desk** of a building. Visitors ask at the front desk, and don't need to know which room each person sits in.

## Why use one

- **Shorter, stabler imports.** If you later move or rename `ai.config.ts`, only the barrel changes. Nothing that imports `../../ai` has to change.
- **A clear public face.** The barrel lists what the folder *offers*. Anything not re-exported is treated as internal.

💡 **Tip:** When you import a folder path like `"../../ai"`, the runtime looks for `index.ts` (or `index.js`) inside it. That's the magic that makes barrels work. See [es-modules.md](es-modules.md).

**Used in:** [files/ai/index.ts.md](../files/ai/index.ts.md)
