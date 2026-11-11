/**
 * Settings of the Telegram front end, read from the Settings object and
 * checked once at start. The bot refuses to start when it would be open to
 * strangers (no allowlist) or unprotected (no PIN).
 */
import fs from "node:fs";
import path from "node:path";
import type { Settings } from "../../core/config";
import { ConfigError } from "../../core/errors";

const MIN_PIN_LENGTH = 6;
const DEFAULT_LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 24 * 60;
const MS_PER_MINUTE = 60_000;

export interface Project {
    name: string;
    path: string;
}

export interface TelegramConfig {
    token: string;
    pin: string;
    /** Telegram user ids that may use the bot. */
    users: ReadonlySet<number>;
    /** The project folder a new chat starts in. */
    workspace: string;
    /** Folders offered by /project. */
    projects: Project[];
    /** Lock again after this long without a message. */
    lockIdleMs: number;
}

const isFolder = (folder: string) => {
    try {
        return fs.statSync(folder).isDirectory();
    } catch {
        return false;
    }
};

/** "name=path;name=path" → the folders that exist. */
function parseProjects(settings: Settings): Project[] {
    return settings.list("YUVI_TELEGRAM_PROJECTS", ";").flatMap((entry): Project[] => {
        const split = entry.indexOf("=");
        if (split <= 0) return [];
        const name = entry.slice(0, split).trim();
        const folder = path.resolve(entry.slice(split + 1).trim());
        return name && isFolder(folder) ? [{ name, path: folder }] : [];
    });
}

/** Read and check the Telegram settings. Throws a ConfigError that says what to set. */
export function loadTelegramConfig(settings: Settings, cwd: string): TelegramConfig {
    const token = settings.telegramToken;
    if (!token) {
        throw new ConfigError("TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and put its token in .env.");
    }
    const users = settings
        .list("YUVI_TELEGRAM_USERS", /[,\s]+/)
        .filter((id) => /^\d+$/.test(id))
        .map(Number);
    if (!users.length) {
        throw new ConfigError(
            "YUVI_TELEGRAM_USERS is not set. Put your numeric Telegram user id in .env (ask @userinfobot for it), so only you can use the bot.",
        );
    }
    const pin = settings.telegramPin;
    if (pin.length < MIN_PIN_LENGTH) {
        throw new ConfigError(`YUVI_TELEGRAM_PIN must be set in .env and have at least ${MIN_PIN_LENGTH} characters.`);
    }
    const workspace = path.resolve(settings.string("YUVI_TELEGRAM_WORKSPACE", cwd));
    if (!isFolder(workspace)) throw new ConfigError(`The project folder does not exist: ${workspace}`);

    return {
        token,
        pin,
        users: new Set(users),
        workspace,
        projects: parseProjects(settings),
        lockIdleMs: settings.number("YUVI_TELEGRAM_LOCK_MINUTES", DEFAULT_LOCK_MINUTES, 1, MAX_LOCK_MINUTES) * MS_PER_MINUTE,
    };
}
