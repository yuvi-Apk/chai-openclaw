# core/llm/choices.ts

**Purpose:** The **lists of options** a front end shows when you change the AI provider, the model, or the thinking effort. Both front ends word their menus the same way, so the lists are built once, here. *How* they are shown (a terminal menu or Telegram buttons) is up to each front end.

**Where it fits:** It reads from [core/config.ts](../config.ts.md) and [profiles.ts](profiles.ts.md), and returns `Choice` objects (the same shape modes use with `host.choose`, from `core/mode.ts`). The terminal's [model-menu.ts](../../frontends/terminal/model-menu.ts.md) and Telegram's [model-settings.ts](../../frontends/telegram/model-settings.ts.md) both use it.

---

### `OTHER_MODEL` and `EffortChoice`

```ts
export const OTHER_MODEL = "__other__";

/** "default" lets each mode pick its own effort; "off" sends none at all. */
export type EffortChoice = ReasoningEffort | "off" | "default";
```

**What it does:** `OTHER_MODEL` is a special value for the "Other…" entry in the model menu. When it is picked, the front end asks you to type an id. `EffortChoice` is every effort value, plus `"off"` and `"default"`.

**Why it's used in general:** A **sentinel value** (a special, made-up value with a clear name) lets one list hold "normal" options and an "ask me instead" option. The odd underscores make sure it can never clash with a real model id.

**Why it's used here:** In [config.ts](../config.ts.md), "let each mode decide" is stored as `undefined`. A menu needs a real value to show, so here it is called `"default"`.

---

### `providerChoices()`

```ts
export function providerChoices(settings: Settings): Choice[] {
    return Object.entries(LLM_PROFILES).map(([name, profile]) => {
        const notes = [name === settings.llmProvider ? "in use" : "", settings.hasKey(name) ? "" : "no key yet"];
        const hint = notes.filter(Boolean).join(", ");
        return { value: name, label: profile.label, ...(hint ? { hint } : {}) };
    });
}
```

**What it does:** One option per profile: value `anthropic`, label "Claude". The hint says "in use" and/or "no key yet". `filter(Boolean)` drops the empty strings, so you get `"in use"`, `"no key yet"`, both, or nothing.

**Why it's used in general:** `...(cond ? { hint } : {})` adds a field only when there is something to put in it. Spreading an empty object adds nothing, so the option simply has no `hint` instead of an empty one.

**Why it's used here:** Because the list comes from `LLM_PROFILES`, a new provider appears in both front ends' menus with no menu code changed.

---

### `modelChoices()`

```ts
export function modelChoices(settings: Settings): Choice[] {
    const current = settings.modelId("main");
    const ids = [...new Set([current, ...settings.llmProfile.suggestedModels])];
    return [
        ...ids.map((id) => ({ value: id, label: id, ...(id === current ? { hint: "in use" } : {}) })),
        { value: OTHER_MODEL, label: "Other…", hint: "type a model id" },
    ];
}
```

**What it does:** It puts the current model first, then the provider's suggestions. `new Set` removes the duplicate when the current one is already a suggestion (it keeps the first position). The last entry is "Other…".

**Why it's used here:** If you typed an unusual id earlier (say `vendor/odd`), it still shows up, first and marked "in use", so you always see what you have.

---

### `effortChoices()`, `currentEffort()`, `saveEffort()`

```ts
export function effortChoices(settings: Settings): Choice<EffortChoice>[] {
    const current = currentEffort(settings);
    const values: EffortChoice[] = ["default", ...REASONING_EFFORTS, "off"];
    // each gets a hint: "in use" and/or a short explanation from EFFORT_HINTS
}

export function currentEffort(settings: Settings): EffortChoice {
    return settings.reasoning ?? "default";
}

export function saveEffort(settings: Settings, choice: EffortChoice): void {
    settings.saveReasoning(choice === "default" ? undefined : choice);
}
```

**What it does:** The effort menu is `default`, then `none … max`, then `off`. `EFFORT_HINTS` adds a few plain explanations, like "faster and cheaper" for `low`. `currentEffort` and `saveEffort` translate between the menu's `"default"` and the settings' `undefined`, in both directions.

**Why it's used in general:** Keeping the translation in two tiny functions means no front end has to remember that `"default"` really means `undefined`.

**Why it's used here:** `Choice<EffortChoice>` is a **generic**: the `value` of each option is typed as an `EffortChoice`, not just any string. So the front end gets a typed answer back.

---

### 🧠 Key takeaways
- Menu *contents* live in `core/`; menu *looks* live in each front end.
- Every list is built from data (`LLM_PROFILES`, `suggestedModels`, `REASONING_EFFORTS`), so new entries appear by themselves.
- `OTHER_MODEL` is a sentinel for "let me type an id".
- `"default"` in a menu equals `undefined` in the settings; `currentEffort` / `saveEffort` do the translation.
