import { select, isCancel } from "@clack/prompts";
import chalk from "chalk";
import type { ActionTracker } from "./action-tracker.ts";
import type { ActionLog, AgentSession } from "./types.ts";
import { composeBeforeAfter, formatPatch } from "./diff-view.ts";
import { colorizeDiff } from "./ui.ts";


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

/** Print every staged change with its diff, so the user decides on what they can see. */
function printStaged(groups: ReviewGroup[]): void {
    console.log(
        chalk.bold(
            `\nyuvi wants to make ${groups.length} change${groups.length === 1 ? "" : "s"}. Nothing is saved yet:`,
        ),
    );
    console.log(chalk.dim("Green lines (+) are added, red lines (-) are removed."));
    for (const g of groups) {
        console.log(`\n${chalk.cyan("▌")} ${chalk.bold(g.label)}`);
        if (g.patch) console.log(colorizeDiff(g.patch, 60));
    }
    console.log("");
}

export async function runApprovalFlow(
    tracker: ActionTracker,
    options: { autoApprove?: boolean } = {},
): Promise<boolean> {
    const pending = tracker.getPendingMutations();

    if (pending.length === 0) return false;

    const groups = groupPending(pending);
    printStaged(groups);

    if (options.autoApprove) {
        for (const a of pending) tracker.updateActionStatus(a.id, "approved", true);
        return true;
    }

    // Without a terminal nobody can approve: keep the workspace untouched.
    if (!process.stdin.isTTY) {
        for (const a of pending) tracker.updateActionStatus(a.id, "rejected", false);
        console.log(chalk.yellow("No interactive terminal: staged changes were not applied."));
        return false;
    }

    const choice = await select({
        message: "Save these changes to your files?",
        options: [
            { value: "all", label: "Yes, save all changes" },
            { value: "select", label: "Let me decide file by file" },
            { value: "cancel", label: "No, discard all changes", hint: "your files stay as they are" },
        ],
    });

    if (isCancel(choice) || choice === "cancel") {
        for (const a of pending) tracker.updateActionStatus(a.id, "rejected", false);
        return false;
    }

    if (choice === "all") {
        for (const a of pending) tracker.updateActionStatus(a.id, "approved", true);
        return true;
    }

    for (const g of groups) {
        while (true) {
            const opt = await select({
                message: chalk.bold(g.label),
                options: [
                    { value: "accept", label: "Yes, save this change" },
                    { value: "diff", label: "Show full diff", hint: g.patch ? "" : "N/A" },
                    { value: "reject", label: "No, discard this change" },
                ],
            });

            if (isCancel(opt)) {
                for (const a of pending) {
                    if (a.status === "pending")
                        tracker.updateActionStatus(a.id, "rejected", false);
                }
                return tracker.getActions().some((a) => a.status === "approved");
            }

            if (opt === "diff") {
                if (g.patch) console.log("\n" + colorizeDiff(g.patch, 2000) + "\n");
                continue;
            }

            for (const id of g.actionIds) {
                tracker.updateActionStatus(
                    id,
                    opt === "accept" ? "approved" : "rejected",
                    opt === "accept",
                );
            }
            break;
        }
    }

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
    if (!process.stdin.isTTY) return false;

    return session.ui.withPrompt(async () => {
        console.log(
            `\n${chalk.yellow("▌")} ${chalk.bold("yuvi wants to run a command on your computer:")}\n  ${chalk.cyan(cmd)}`,
        );
        const choice = await select({
            message: "Allow this command?",
            options: [
                { value: "yes", label: "Yes, run it" },
                ...(chained
                    ? []
                    : [{
                        value: "always",
                        label: `Yes, and don't ask again for "${prefix}" commands this session`,
                    }]),
                { value: "no", label: "No, don't run it" },
            ],
        });
        if (isCancel(choice) || choice === "no") return false;
        if (choice === "always") session.allowedCommands.add(prefix);
        return true;
    });
}
