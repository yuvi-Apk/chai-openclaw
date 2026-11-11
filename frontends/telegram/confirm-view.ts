/**
 * Approvals in Telegram: staged file changes and shell commands are shown
 * with buttons, and nothing is accepted without a press. No answer, an
 * expired button or a failed message all mean "no".
 */
import type { ChangeGroup, ConfirmReply, ConfirmRequest } from "../../core/mode";
import type { Questions } from "./questions";
import { escapeHtml } from "./view/html";
import type { ChatMessenger } from "./view/messenger";

const MAX_SHOWN_GROUPS = 6;
const DIFF_MAX_LINES = 40;
const DIFF_MAX_CHARS = 2500;
const LABEL_MAX_CHARS = 40;
const COMMAND_MAX_CHARS = 3000;
const PATCH_FILE_NAME = "changes.patch";
const NO_ANSWER = "⌛ No answer, so nothing was accepted.";

export interface ConfirmContext {
    messenger: ChatMessenger;
    questions: Questions;
    /** Receives what the user wants done instead of the changes they refused. */
    instruct?: (text: string) => void;
}

type ChangeChoice = "approve" | "reject" | "pick" | "instruct" | "full";

/** A diff short enough for a message. Returns whether lines were left out. */
function clipPatch(patch: string): { text: string; clipped: boolean } {
    const lines = patch.split("\n");
    let text = lines.slice(0, DIFF_MAX_LINES).join("\n");
    let clipped = lines.length > DIFF_MAX_LINES;
    if (text.length > DIFF_MAX_CHARS) {
        text = text.slice(0, DIFF_MAX_CHARS);
        clipped = true;
    }
    return { text: clipped ? `${text}\n… ${Math.max(1, lines.length - DIFF_MAX_LINES)} more lines` : text, clipped };
}

/** Show the diffs. Returns true when something was shortened or left out. */
async function showGroups(messenger: ChatMessenger, groups: ChangeGroup[]): Promise<boolean> {
    let partial = groups.length > MAX_SHOWN_GROUPS;
    for (const group of groups.slice(0, MAX_SHOWN_GROUPS)) {
        const title = `📝 <b>${escapeHtml(group.label)}</b>`;
        if (!group.patch) {
            await messenger.send(title, { silent: true });
            continue;
        }
        const { text, clipped } = clipPatch(group.patch);
        partial ||= clipped;
        await messenger.send(`${title}\n<pre><code class="language-diff">${escapeHtml(text)}</code></pre>`, { silent: true });
    }
    if (groups.length > MAX_SHOWN_GROUPS) {
        const rest = groups.slice(MAX_SHOWN_GROUPS).map((g) => `• ${escapeHtml(g.label)}`);
        await messenger.send(`<b>And ${rest.length} more:</b>\n${rest.join("\n")}`, { silent: true });
    }
    return partial;
}

const allIds = (groups: ChangeGroup[]) => groups.map((group) => group.id);

/** Let the user tick the changes to keep. Null when they do not answer. */
async function pickGroups(ctx: ConfirmContext, messageId: number, groups: ChangeGroup[]): Promise<string[] | null> {
    const DONE = "__done__";
    const picked = new Set(allIds(groups));
    while (true) {
        const rows = groups.map((group) => [
            { label: `${picked.has(group.id) ? "✅" : "⬜"} ${group.label.slice(0, LABEL_MAX_CHARS)}`, value: group.id },
        ]);
        const { keyboard, answer } = ctx.questions.ask(ctx.messenger.chatId, [...rows, [{ label: "Done", value: DONE }]]);
        await ctx.messenger.edit(messageId, "Tap a change to keep or drop it, then press <b>Done</b>.", keyboard);
        const pressed = await answer;
        if (pressed === null) return null;
        if (pressed === DONE) return [...picked];
        if (!picked.delete(pressed)) picked.add(pressed);
    }
}

async function sendFullPatch(messenger: ChatMessenger, groups: ChangeGroup[]): Promise<void> {
    const patch = groups.map((group) => group.patch ?? `# ${group.label}\n`).join("\n");
    await messenger.document(PATCH_FILE_NAME, new TextEncoder().encode(patch), "The complete diff");
}

/** Ask what to do with the staged changes until the user decides. */
async function askAboutChanges(ctx: ConfirmContext, groups: ChangeGroup[], partial: boolean): Promise<ConfirmReply> {
    const { messenger, questions } = ctx;
    const count = `${groups.length} change${groups.length === 1 ? "" : "s"}`;
    const question = `yuvi wants to save <b>${count}</b>. Nothing is saved until you approve.`;
    const rows: { label: string; value: ChangeChoice }[][] = [
        [{ label: "✅ Approve all", value: "approve" }, { label: "❌ Reject all", value: "reject" }],
        ...(groups.length > 1 ? [[{ label: "☑ Pick files", value: "pick" as const }]] : []),
        ...(ctx.instruct ? [[{ label: "✏️ Reject + tell yuvi what to do", value: "instruct" as const }]] : []),
        ...(partial ? [[{ label: "📄 Full diff as a file", value: "full" as const }]] : []),
    ];

    let messageId = 0;
    while (true) {
        const { keyboard, answer } = questions.ask(messenger.chatId, rows);
        if (messageId) await messenger.edit(messageId, question, keyboard);
        else messageId = await messenger.send(question, { keyboard });
        // Without a visible question there is nothing the user could have agreed to.
        if (!messageId) return { approved: [] };

        const choice = await answer;
        if (choice === "full") {
            await sendFullPatch(messenger, groups);
            continue;
        }
        if (choice === "approve") {
            await messenger.edit(messageId, `✅ Approved ${count}.`);
            return { approved: allIds(groups) };
        }
        if (choice === "pick") {
            const picked = await pickGroups(ctx, messageId, groups);
            await messenger.edit(messageId, picked ? `✅ Approved ${picked.length} of ${groups.length}.` : NO_ANSWER);
            return { approved: picked ?? [] };
        }
        if (choice === "instruct") {
            await messenger.edit(messageId, "❌ Rejected. What should yuvi do instead? Send it as a message.");
            const instruction = await questions.text(messenger.chatId);
            if (instruction?.trim()) ctx.instruct?.(instruction.trim());
            return { approved: [] };
        }
        await messenger.edit(messageId, choice === "reject" ? "❌ Rejected. No file was changed." : NO_ANSWER);
        return { approved: [] };
    }
}

/** Show staged changes; in Ask mode wait for a decision, in Auto mode accept them. */
export async function confirmChanges(
    ctx: ConfirmContext,
    request: Extract<ConfirmRequest, { kind: "changes" }>,
): Promise<ConfirmReply> {
    const partial = await showGroups(ctx.messenger, request.groups);
    if (request.auto) return { approved: allIds(request.groups) };
    return askAboutChanges(ctx, request.groups, partial);
}

/** Ask before running a shell command. */
export async function confirmCommand(
    ctx: ConfirmContext,
    request: Extract<ConfirmRequest, { kind: "command" }>,
): Promise<ConfirmReply> {
    const { messenger, questions } = ctx;
    const shown = escapeHtml(request.command.slice(0, COMMAND_MAX_CHARS));
    const text = `yuvi wants to run this command on your PC:\n<pre>${shown}</pre>`;
    const rows: { label: string; value: "run" | "always" | "no" }[][] = [
        [{ label: "▶ Run", value: "run" }, { label: "✋ Don't run", value: "no" }],
        ...(request.rememberAs
            ? [[{ label: `Always allow “${request.rememberAs.slice(0, LABEL_MAX_CHARS)}”`, value: "always" as const }]]
            : []),
    ];
    const { keyboard, answer } = questions.ask(messenger.chatId, rows);
    const messageId = await messenger.send(text, { keyboard });
    if (!messageId) return { approved: [] };

    const choice = await answer;
    const allowed = choice === "run" || choice === "always";
    const verdict = allowed ? "▶ Running." : choice === "no" ? "✋ Not run." : NO_ANSWER;
    await messenger.edit(messageId, `${text}\n${verdict}`);
    return allowed ? { approved: ["run"], ...(choice === "always" ? { remember: true } : {}) } : { approved: [] };
}
