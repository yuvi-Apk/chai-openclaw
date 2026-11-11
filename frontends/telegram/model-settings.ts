/**
 * The Telegram model menus: /provider, /model and /effort, as buttons. Each
 * saves the choice for next time. Keys are never typed here (they would stay
 * in the chat history), so a provider without a key is refused with advice.
 */
import type { Settings } from "../../core/config";
import type { Logger } from "../../core/log";
import {
    currentEffort,
    effortChoices,
    modelChoices,
    OTHER_MODEL,
    providerChoices,
    saveEffort,
    type EffortChoice,
} from "../../core/llm/choices";
import { profileFor } from "../../core/llm/profiles";
import type { Choice } from "../../core/mode";
import type { Questions } from "./questions";
import { escapeHtml } from "./view/html";
import type { ChatMessenger } from "./view/messenger";

const MODEL_ID = /^[\w./:@-]{3,120}$/;
const ENV_WINS_NOTE = "\n<i>.env on your PC sets this too and wins when the bot restarts; remove that line to keep this choice.</i>";

/** What the menus need from the chat. */
export interface ModelMenuContext {
    chatId: number;
    settings: Settings;
    messenger: ChatMessenger;
    questions: Questions;
    log: Logger;
}

const buttonLabel = (choice: Choice) => (choice.hint ? `${choice.label} · ${choice.hint}` : choice.label);

/** Show the choices as one button per row and wait for a press; null when none. */
async function pick<T extends string>(ctx: ModelMenuContext, title: string, choices: Choice<T>[]): Promise<T | null> {
    const rows = choices.map((choice) => [{ label: buttonLabel(choice), value: choice.value }]);
    const { keyboard, answer } = ctx.questions.ask(ctx.chatId, rows);
    await ctx.messenger.send(title, { keyboard });
    return answer;
}

/** /provider: switch to another provider that has a key. */
export async function changeProvider(ctx: ModelMenuContext): Promise<void> {
    const { settings } = ctx;
    // A key saved from the terminal since the bot started counts, without a restart.
    settings.reload();
    const title = `<b>Which AI provider?</b>\n<i>Now: ${escapeHtml(settings.llmProfile.label)}</i>`;
    const picked = await pick(ctx, title, providerChoices(settings));
    if (!picked || picked === settings.llmProvider) return;
    const { label } = profileFor(picked);
    if (!settings.hasKey(picked)) {
        return void (await ctx.messenger.send(
            `✗ ${escapeHtml(label)} has no key yet, so nothing was changed. Keys are never set from Telegram. ` +
                "On your PC run yuvi, type / and choose “Switch AI provider” (it asks for the key), then send /provider here again.",
        ));
    }
    settings.saveProvider(picked);
    ctx.log.event("telegram.provider", { provider: picked });
    const note = settings.providerSetInEnv ? ENV_WINS_NOTE : "";
    await ctx.messenger.send(
        `✓ Now using <b>${escapeHtml(label)}</b> with <code>${escapeHtml(settings.modelId("main"))}</code>, saved.${note}`,
    );
}

/** /model: one of the provider's suggested models, or a typed id. */
export async function changeModel(ctx: ModelMenuContext): Promise<void> {
    const { settings } = ctx;
    const current = settings.modelId("main");
    const title = `<b>Which ${escapeHtml(settings.llmProfile.label)} model?</b>\n<i>Now: ${escapeHtml(current)}</i>`;
    let id = await pick(ctx, title, modelChoices(settings));
    if (id === OTHER_MODEL) id = await askModelId(ctx);
    if (!id || id === current) return;
    if (!MODEL_ID.test(id)) return void (await ctx.messenger.send("✗ That does not look like a model id. Nothing was changed."));
    settings.saveModel(id);
    await ctx.messenger.send(`✓ Model changed to <code>${escapeHtml(settings.modelId("main"))}</code> and saved.`);
}

async function askModelId(ctx: ModelMenuContext): Promise<string | null> {
    await ctx.messenger.send(`Send the model id (from ${escapeHtml(ctx.settings.llmProfile.modelsUrl)}), or /cancel.`);
    return (await ctx.questions.text(ctx.chatId))?.trim() || null;
}

/** /effort: how hard the model thinks. */
export async function changeEffort(ctx: ModelMenuContext): Promise<void> {
    const { settings } = ctx;
    const current = currentEffort(settings);
    const title = `<b>How much should the model think?</b>\n<i>Now: ${escapeHtml(current)}</i>`;
    const picked: EffortChoice | null = await pick(ctx, title, effortChoices(settings));
    if (!picked || picked === current) return;
    saveEffort(settings, picked);
    const note = settings.reasoningSetInEnv ? ENV_WINS_NOTE : "";
    await ctx.messenger.send(`✓ Effort set to <b>${escapeHtml(currentEffort(settings))}</b>, saved.${note}`);
}
