/**
 * The Telegram front end. It runs on this PC, asks Telegram for new
 * messages and answers them; the phone is only the screen and keyboard.
 */
import { createCore } from "../../core/compose";
import { Settings } from "../../core/config";
import { errorText } from "../../core/errors";
import { silenceSdkWarnings } from "../../core/llm/quiet-sdk";
import type { ModeRegistry } from "../../core/mode";
import { FetchTelegramApi } from "./api/telegram-api";
import type { TelegramApi } from "./api/types";
import { realClock } from "./clock";
import { FRONT_COMMANDS, LOCK_COMMANDS } from "./commands";
import { loadTelegramConfig, type TelegramConfig } from "./config";
import { runPoller } from "./poller";
import { Router } from "./router";

/** The command list every chat sees before a mode is open. */
const baseCommands = () =>
    [...FRONT_COMMANDS.filter((command) => !command.hidden), ...LOCK_COMMANDS].map((command) => ({
        command: command.name.slice(1),
        description: command.description,
    }));

export interface TelegramAppOptions {
    settings?: Settings;
    /** Stops the bot when aborted. Without it the bot runs until Ctrl+C. */
    signal?: AbortSignal;
    /** A ready-made API, used instead of the real one (tests). */
    api?: TelegramApi;
    cwd?: string;
}

/** Run the bot until it is stopped. */
export async function runTelegram(registry: ModeRegistry, options: TelegramAppOptions = {}): Promise<void> {
    const settings = options.settings ?? new Settings();
    let config: TelegramConfig;
    try {
        config = loadTelegramConfig(settings, options.cwd ?? process.cwd());
    } catch (error) {
        console.error(`Telegram mode cannot start: ${errorText(error)}`);
        return;
    }

    await settings.loadKeys();
    if (!settings.hasKey(settings.llmProvider)) {
        console.error(
            `There is no ${settings.llmProfile.label} key yet. Run "yuvi wakeup", choose CLI and log in, then start the bot again.`,
        );
        return;
    }

    silenceSdkWarnings();
    const core = createCore(settings);
    const api = options.api ?? new FetchTelegramApi(config.token);
    try {
        await api.setCommands(baseCommands());
    } catch (error) {
        console.error(`Telegram mode cannot start: ${errorText(error)}`);
        return;
    }

    const stop = new AbortController();
    const onInterrupt = () => stop.abort();
    options.signal?.addEventListener("abort", onInterrupt);
    process.once("SIGINT", onInterrupt);

    const router = new Router({ api, core, registry, config, clock: realClock });
    core.log.event("telegram.start", { users: config.users.size });
    console.log(
        [
            "yuvi is listening on Telegram. Open your bot in the Telegram app and send /start.",
            `Project folder: ${config.workspace}`,
            "The bot starts locked: send /unlock and your PIN. Press Ctrl+C here to stop it.",
        ].join("\n"),
    );

    await runPoller(api, (update) => router.handle(update), { signal: stop.signal, log: core.log });
    await router.shutdown();
    process.off("SIGINT", onInterrupt);
    console.log("Telegram bot stopped.");
}
