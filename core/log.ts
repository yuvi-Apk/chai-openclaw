/**
 * Structured logging. The default logger does nothing. When logging is
 * switched on (YUVI_LOG=1) events are appended to a file as JSON lines, one
 * event per line, with secrets and personal data removed first.
 *
 * Only facts about what happened are logged (which step, how many tokens,
 * how long). Messages and answers are never written.
 */
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { Settings } from "./config";
import { redactSecrets } from "./security/redact";

export interface Logger {
    /** Record one event, e.g. "llm.call" with its model, tokens and cost. */
    event(name: string, data?: Record<string, unknown>): void;
}

export const nullLogger: Logger = { event: () => undefined };

/** One file per day, in the user's yuvi folder. */
export const userLogFile = (now = new Date()) =>
    path.join(homedir(), ".yuvi", "logs", `${now.toISOString().slice(0, 10)}.jsonl`);

/** A logger that appends redacted JSON lines to a file. It never throws. */
export function fileLogger(file: string, secrets: () => string[] = () => []): Logger {
    let ready = false;
    return {
        event(name, data = {}) {
            try {
                if (!ready) {
                    fs.mkdirSync(path.dirname(file), { recursive: true });
                    ready = true;
                }
                const line = JSON.stringify({ time: new Date().toISOString(), event: name, ...data });
                fs.appendFileSync(file, redactSecrets(line, secrets()) + "\n", "utf8");
            } catch {
                // logging must never break the app
            }
        },
    };
}

/** The logger the settings ask for. */
export function createLogger(settings: Settings): Logger {
    return settings.logEnabled ? fileLogger(userLogFile(), () => settings.secrets()) : nullLogger;
}
