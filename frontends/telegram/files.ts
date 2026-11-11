/**
 * Files between the phone and the project folder. A file only goes in
 * after the user confirms where it lands, and never outside the folder or
 * over a secrets file; a file only goes out when it is inside the folder
 * and does not look like it holds secrets.
 */
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../../core/log";
import { isSensitivePath, resolveInside } from "../../core/security/path-safety";
import type { TelegramApi } from "./api/types";
import type { Questions } from "./questions";
import { escapeHtml } from "./view/html";
import type { ChatMessenger } from "./view/messenger";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SEND_BYTES = 20 * 1024 * 1024;
const DEFAULT_UPLOAD_FOLDER = "uploads";
const FILE_NAME_MAX_CHARS = 100;
const BYTES_PER_KB = 1024;

export interface FileContext {
    api: TelegramApi;
    messenger: ChatMessenger;
    questions: Questions;
    log: Logger;
}

export interface IncomingDocument {
    file_id: string;
    file_name?: string | undefined;
    file_size?: number | undefined;
}

const sizeText = (bytes: number) => `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;

/** A file name without folders or odd characters. */
export function safeFileName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? "";
    return base.replace(/[^\w.\- ]/g, "_").trim().slice(0, FILE_NAME_MAX_CHARS);
}

/** Save a file the user sent into the project folder, after they agree. */
export async function receiveDocument(
    ctx: FileContext,
    workspace: string,
    document: IncomingDocument,
    caption = "",
): Promise<void> {
    const { messenger, questions } = ctx;
    const name = safeFileName(document.file_name ?? "");
    if (!name) return void (await messenger.send("✗ That file has no usable name."));
    if ((document.file_size ?? 0) > MAX_UPLOAD_BYTES) {
        return void (await messenger.send(`✗ The file is larger than ${sizeText(MAX_UPLOAD_BYTES)}.`));
    }
    // The caption, when given, names the folder inside the project.
    const relative = path.join(caption.trim() || DEFAULT_UPLOAD_FOLDER, name);
    const target = resolveInside(workspace, relative);
    if (!target || isSensitivePath(relative)) {
        return void (await messenger.send("✗ I will not save a file there: it is outside the project or a protected file."));
    }

    const exists = fs.existsSync(target);
    const shown = escapeHtml(path.relative(workspace, target));
    const { keyboard, answer } = questions.ask(messenger.chatId, [
        [{ label: exists ? "⚠️ Overwrite" : "💾 Save", value: true }, { label: "Cancel", value: false }],
    ]);
    const question = `Save <b>${escapeHtml(name)}</b> (${sizeText(document.file_size ?? 0)}) as <code>${shown}</code>?${exists ? "\n⚠️ A file with this name exists and would be replaced." : ""}`;
    const messageId = await messenger.send(question, { keyboard });
    if (!messageId || !(await answer)) {
        if (messageId) await messenger.edit(messageId, "Not saved.");
        return;
    }

    try {
        const data = await ctx.api.downloadFile(document.file_id, MAX_UPLOAD_BYTES);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
        ctx.log.event("telegram.file_in", { bytes: data.length });
        await messenger.edit(messageId, `✓ Saved as <code>${shown}</code>. Mention it with @${shown} in a message.`);
    } catch {
        await messenger.edit(messageId, "✗ The file could not be downloaded or saved.");
    }
}

/** Send a project file to the user. */
export async function sendFile(ctx: FileContext, workspace: string, relative: string): Promise<void> {
    const { messenger } = ctx;
    if (!relative.trim()) return void (await messenger.send("Which file? For example: <code>/file src/app.ts</code>"));
    const target = resolveInside(workspace, relative.trim());
    if (!target || isSensitivePath(path.relative(workspace, target))) {
        return void (await messenger.send("✗ I will not send that: it is outside the project or may hold secrets."));
    }
    let data: Uint8Array;
    try {
        const stat = fs.statSync(target);
        if (!stat.isFile()) return void (await messenger.send("✗ That is not a file."));
        if (stat.size > MAX_SEND_BYTES) return void (await messenger.send(`✗ The file is larger than ${sizeText(MAX_SEND_BYTES)}.`));
        data = fs.readFileSync(target);
    } catch {
        return void (await messenger.send("✗ No such file in this project."));
    }
    const sent = await messenger.document(path.basename(target), data);
    ctx.log.event("telegram.file_out", { bytes: data.length, sent });
    if (!sent) await messenger.send("✗ The file could not be sent.");
}
