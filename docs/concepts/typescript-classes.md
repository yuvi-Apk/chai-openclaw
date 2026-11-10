# TypeScript classes: `private`, `readonly`, and parameter properties

A **class** is a blueprint for objects that keep their own data (fields) and actions (methods) together. You build one with `new`.

Think of a class as a **cookie cutter**. Each `new` stamps out a fresh cookie with its own state.

```ts
class Counter {
  private count = 0;              // a field, hidden from outside

  add() { this.count++; }         // a method
  get(): number { return this.count; }
}

const c = new Counter();
c.add();
c.get();      // 1
// c.count    // ❌ TypeScript error: 'count' is private
```

## Keywords you'll see

- **`private`**: only code *inside* the class can touch this. It keeps internal details safe from outside code.
- **`readonly`**: you can set it once (in the constructor or where it's declared) and never reassign it.
- **`this`**: means "the current object".

## Parameter properties (a shortcut)

```ts
class ToolExecutor {
  constructor(
    private readonly config: AgentConfig,
    private readonly tracker: ActionTracker,
  ) {}
}
```

Putting `private readonly` in front of a constructor parameter does two things at once: it **declares** the field and **stores** the argument in it. That empty `{}` body isn't a mistake. There's nothing left to do.

It is the same as writing:

```ts
private readonly config: AgentConfig;
constructor(config: AgentConfig) { this.config = config; }
```

## Passing one object into another

When a class takes another object in its constructor (like `ToolExecutor` taking an `ActionTracker`), that's called **dependency injection**. The executor doesn't build its own tracker. It's *handed* one, so several parts of the app can share the same tracker.

💡 **Tip:** Arrow functions stored as fields (`private readonly norm = (x) => ...`) automatically keep the right `this`, which is handy for small helpers.

**Used in:** [files/modes/agent/action-tracker.ts.md](../files/modes/agent/action-tracker.ts.md), [files/modes/agent/tool-executor.ts.md](../files/modes/agent/tool-executor.ts.md)
