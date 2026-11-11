/**
 * What the agent may do without asking, and how it asks for the rest:
 * staged file changes and shell commands both go to the user through the host.
 */
import type { ModeHost } from "../../core/mode";
import type { ActionTracker } from "./action-tracker";
import type { ActionLog, AgentSession } from "./types";
import { composeBeforeAfter, formatPatch } from "./diff-view";


interface ReviewGroup {
    label: string;
    actionIds: string[];
    patch: string | null;
}

export function groupPending(pending: ActionLog[]): ReviewGroup[] {
    const byPath = new Map<string, ActionLog[]>();
    const shells: ActionLog[] = [];

    for (const a of pending) {
        if (a.type === "tool_execute") {
            shells.push(a);
            continue;
        }
        const key = a.path;
        if (!byPath.has(key)) byPath.set(key, []);
        byPath.get(key)!.push(a);
    }

    const groups: ReviewGroup[] = [];

    const pathEntries = [...byPath.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
    );
    for (const [p, acts] of pathEntries) {
        const sorted = acts.sort(
            (x, y) => x.timestamp.getTime() - y.timestamp.getTime(),
        );
        const ids = sorted.map((x) => x.id);

        if (sorted.every((x) => x.type === "folder_create")) {
            groups.push({
                label: `Create folder: ${p}`,
                actionIds: ids,
                patch: null,
            });
            continue;
        }

        const { before, after } = composeBeforeAfter(sorted);
        const patch = formatPatch(p, before, after);
        const kinds = [...new Set(sorted.map((x) => x.type))].join(", ");
        groups.push({ label: `${p} (${kinds})`, actionIds: ids, patch });
    }

    for (const s of shells) {
        groups.push({
            label: `Shell: ${s.details.command ?? "(no command)"}`,
            actionIds: [s.id],
            patch: null,
        });
    }

    return groups;
}

/**
 * Show the staged changes to the user and record their decision on each one.
 * Returns true when at least one change was accepted.
 */
export async function runApprovalFlow(
    tracker: ActionTracker,
    host: ModeHost,
    options: { autoApprove?: boolean } = {},
): Promise<boolean> {
    const pending = tracker.getPendingMutations();
    if (pending.length === 0) return false;

    const groups = groupPending(pending);
    const reply = await host.confirm({
        kind: "changes",
        groups: groups.map((group, index) => ({ id: String(index), label: group.label, patch: group.patch })),
        auto: Boolean(options.autoApprove),
    });

    const accepted = new Set(reply.approved);
    groups.forEach((group, index) => {
        const ok = accepted.has(String(index));
        for (const id of group.actionIds) {
            tracker.updateActionStatus(id, ok ? "approved" : "rejected", ok);
        }
    });
    return tracker.getActions().some((a) => a.status === "approved");
}

// ---------- shell command approval ----------

/** Commands that only read state or run the project's own checks. */
const READ_ONLY_PREFIXES = [
    "git status", "git diff", "git log", "git show", "git ls-files",
    "git rev-parse", "git blame", "ls", "dir", "pwd",
    "bun test", "bun run test", "bun run lint", "bun run typecheck", "bunx tsc",
    "npm test", "npm run test", "npm run lint", "npm run typecheck", "npx tsc",
    "pnpm test", "pnpm run test", "pnpm run lint", "pnpm run typecheck",
    "yarn test", "yarn lint", "yarn typecheck", "tsc",
    "cargo check", "cargo test", "go vet", "go test", "pytest",
    "node --version", "bun --version", "npm --version",
];

const startsWithWord = (command: string, prefix: string) =>
    command === prefix || command.startsWith(`${prefix} `);

/** True when the command cannot change anything outside its own process. */
export function isReadOnlyCommand(session: AgentSession, command: string): boolean {
    const cmd = command.trim();
    // Chaining, piping and redirection can hide a second command.
    if (/[;&|<>`]|\$\(/.test(cmd)) return false;
    if (session.config.checkCommands.includes(cmd)) return true;
    return READ_ONLY_PREFIXES.some((p) => startsWithWord(cmd, p));
}

/** The first one or two words of a command, e.g. "bun add" or "mkdir". */
export function commandPrefix(command: string): string {
    const words = command.trim().split(/\s+/);
    const second = words[1];
    if (second && /^[a-z][\w:-]*$/i.test(second)) return `${words[0]} ${second}`;
    return words[0] ?? command;
}

/** Decide whether a command may run: read-only and allowed ones pass, others ask. */
export async function approveCommand(
    session: AgentSession,
    command: string,
): Promise<boolean> {
    const cmd = command.trim();
    if (isReadOnlyCommand(session, cmd)) return true;

    const chained = /[;&|<>`]|\$\(/.test(cmd);
    const prefix = commandPrefix(cmd);
    if (!chained && session.allowedCommands.has(prefix)) return true;
    if (!session.host.interactive) return false;

    const reply = await session.host.confirm({
        kind: "command",
        command: cmd,
        ...(chained ? {} : { rememberAs: prefix }),
    });
    if (!reply.approved.length) return false;
    if (reply.remember) session.allowedCommands.add(prefix);
    return true;
}
