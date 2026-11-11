/**
 * The options a front end shows when the user changes the provider, the
 * model or the reasoning effort. Every front end words its menus the same
 * way, so the lists live here; how they are shown is up to the front end.
 */
import { REASONING_EFFORTS, type ReasoningEffort, type Settings } from "../config";
import type { Choice } from "../mode";
import { LLM_PROFILES } from "./profiles";

/** The value of the model-menu entry that asks for a typed model id. */
export const OTHER_MODEL = "__other__";

/** "default" lets each mode pick its own effort; "off" sends none at all. */
export type EffortChoice = ReasoningEffort | "off" | "default";

const EFFORT_HINTS: Partial<Record<EffortChoice, string>> = {
    default: "each mode picks (recommended)",
    off: "send no effort, for models that reject it",
    low: "faster and cheaper",
    high: "more careful, slower",
    max: "slowest, most tokens",
};

/** Every provider with a profile; the one in use and the ones without a key are marked. */
export function providerChoices(settings: Settings): Choice[] {
    return Object.entries(LLM_PROFILES).map(([name, profile]) => {
        const notes = [name === settings.llmProvider ? "in use" : "", settings.hasKey(name) ? "" : "no key yet"];
        const hint = notes.filter(Boolean).join(", ");
        return { value: name, label: profile.label, ...(hint ? { hint } : {}) };
    });
}

/** The provider's suggested models, the current one if it is not among them, and "type an id". */
export function modelChoices(settings: Settings): Choice[] {
    const current = settings.modelId("main");
    const ids = [...new Set([current, ...settings.llmProfile.suggestedModels])];
    return [
        ...ids.map((id) => ({ value: id, label: id, ...(id === current ? { hint: "in use" } : {}) })),
        { value: OTHER_MODEL, label: "Other…", hint: "type a model id" },
    ];
}

/** The effort options, with the one in use marked. */
export function effortChoices(settings: Settings): Choice<EffortChoice>[] {
    const current = currentEffort(settings);
    const values: EffortChoice[] = ["default", ...REASONING_EFFORTS, "off"];
    return values.map((value) => {
        const hint = [value === current ? "in use" : "", EFFORT_HINTS[value] ?? ""].filter(Boolean).join(", ");
        return { value, label: value, ...(hint ? { hint } : {}) };
    });
}

/** The effort in use, as a menu value. */
export function currentEffort(settings: Settings): EffortChoice {
    return settings.reasoning ?? "default";
}

/** Save an effort picked from the menu. */
export function saveEffort(settings: Settings, choice: EffortChoice): void {
    settings.saveReasoning(choice === "default" ? undefined : choice);
}
