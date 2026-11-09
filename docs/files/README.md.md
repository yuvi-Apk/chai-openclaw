# README.md

**Purpose:** The short welcome note at the root of the repo. `bun init` generated it, and it shows the two basic commands.

**Where it fits:** It's the first thing people see on GitHub. For the full learning guide, see [docs/README.md](../README.md).

---

### Install and run

```bash
bun install
bun run index.ts
```

**What it does:**
- `bun install` downloads everything listed in [package.json](package.json.md).
- `bun run index.ts` runs the entry file, [index.ts](index.ts.md).

**Why it's used in general:** Every project should tell newcomers how to get started in seconds.

**Why it's used here:** It's the quick start. Add a command, such as `bun run index.ts wakeup`, to actually run something.

💡 **Tip:** Running `bun run index.ts` with no command makes Commander show the help text, because no command was given.

---

### 🧠 Key takeaways
- `bun install` gets the dependencies, and `bun run` runs the file.
- The root README is short. The `docs/` folder holds the deeper explanations.
