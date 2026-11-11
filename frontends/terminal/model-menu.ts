/**
 * The terminal's model menus: switch provider, pick a model, set the
 * reasoning effort. Each saves the choice for next time and returns the
 * notice to show, or null when nothing changed. The prompts are passed in,
 * so tests can answer them.
 */
import type { Settings } from "../../core/config";
import {
    currentEffort,
    effortChoices,
    modelChoices,
    OTHER_MODEL,
    providerChoices,
    saveEffort,
} from "../../core/llm/choices";
import { profileFor } from "../../core/llm/profiles";
import type { Choice } from "../../core/mode";
import { logIn } from "./login";
import { askText, chooseOne } from "./prompts";

/** What to tell the user after a menu: a terminal notice. */
export interface MenuNotice {
    level: "success" | "note";
    text: string;
}

/** The questions the menus ask; the real ones come from prompts.ts. */
export interface MenuPrompts {
    choose<T extends string>(question: string, choices: Choice<T>[], initial?: T): Promise<T | null>;
    askText(question: string): Promise<string | null>;
    /** Ask for a provider's key, check it and save it. False when skipped or rejected. */
    setupKey(settings: Settings, provider: string): Promise<boolean>;
}

export const TERMINAL_PROMPTS: MenuPrompts = {
    choose: chooseOne,
    askText,
    setupKey: (settings, provider) => logIn(settings, provider),
};

const ENV_WINS_NOTE = "(.env sets it too, and .env wins at the next start: remove that line to keep this choice.)";

/** Switch to another provider. One without a key asks for it first; skipping keeps the old one. */
export async function chooseProvider(settings: Settings, prompts = TERMINAL_PROMPTS): Promise<MenuNotice | null> {
    const current = settings.llmProvider;
    const picked = await prompts.choose("Which AI provider?", providerChoices(settings), current);
    if (!picked || picked === current) return null;
    const { label } = profileFor(picked);
    if (!settings.hasKey(picked) && !(await prompts.setupKey(settings, picked))) {
        return { level: "note", text: `Still using ${settings.llmProfile.label}: ${label} needs a key first.` };
    }
    settings.saveProvider(picked);
    const note = settings.providerSetInEnv ? ` ${ENV_WINS_NOTE}` : "";
    return { level: "success", text: `Now using ${label} with ${settings.modelId("main")}, saved for next time.${note}` };
}

/** Pick one of the provider's suggested models, or type any id. */
export async function chooseModel(settings: Settings, prompts = TERMINAL_PROMPTS): Promise<MenuNotice | null> {
    const current = settings.modelId("main");
    const question = `Which ${settings.llmProfile.label} model? (all models: ${settings.llmProfile.modelsUrl})`;
    let picked = await prompts.choose(question, modelChoices(settings), current);
    if (picked === OTHER_MODEL) picked = (await prompts.askText("Model id (pick one that supports tools):"))?.trim() || null;
    if (!picked || picked === current) return null;
    settings.saveModel(picked);
    return { level: "success", text: `Model changed to ${settings.modelId("main")} and saved for next time.` };
}

/** Set how hard the model thinks. */
export async function chooseEffort(settings: Settings, prompts = TERMINAL_PROMPTS): Promise<MenuNotice | null> {
    const current = currentEffort(settings);
    const picked = await prompts.choose("How much should the model think?", effortChoices(settings), current);
    if (!picked || picked === current) return null;
    saveEffort(settings, picked);
    const note = settings.reasoningSetInEnv ? ` ${ENV_WINS_NOTE}` : "";
    return { level: "success", text: `Effort set to ${currentEffort(settings)}, saved for next time.${note}` };
}
