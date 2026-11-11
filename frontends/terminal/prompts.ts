/**
 * The questions the terminal asks the user: accept changes, allow a
 * command, pick an option, type an answer, and set the key or the model.
 */
import { isCancel, log, password, select, text } from "@clack/prompts";
import chalk from "chalk";
import type { Settings } from "../../core/config";
import type { ChangeGroup, Choice, ConfirmReply, ConfirmRequest } from "../../core/mode";
import { colorizeDiff } from "./style";

const PREVIEW_DIFF_LINES = 60;
const FULL_DIFF_LINES = 2000;
const MIN_KEY_LENGTH = 20;

/** Print every staged change with its diff, so the user decides on what they can see. */
function printStaged(groups: ChangeGroup[]): void {
    console.log(
        chalk.bold(
            `\nyuvi wants to make ${groups.length} change${groups.length === 1 ? "" : "s"}. Nothing is saved yet:`,
        ),
    );
    console.log(chalk.dim("Green lines (+) are added, red lines (-) are removed."));
    for (const g of groups) {
        console.log(`\n${chalk.cyan("▌")} ${chalk.bold(g.label)}`);
        if (g.patch) console.log(colorizeDiff(g.patch, PREVIEW_DIFF_LINES));
    }
    console.log("");
}

/** Show the staged changes and ask which ones to save. */
export async function confirmChanges(
    request: Extract<ConfirmRequest, { kind: "changes" }>,
): Promise<ConfirmReply> {
    const { groups } = request;
    const all = groups.map((g) => g.id);
    printStaged(groups);

    if (request.auto) return { approved: all };

    // Without a terminal nobody can approve: keep the workspace untouched.
    if (!process.stdin.isTTY) {
        console.log(chalk.yellow("No interactive terminal: staged changes were not applied."));
        return { approved: [] };
    }

    const choice = await select({
        message: "Save these changes to your files?",
        options: [
            { value: "all", label: "Yes, save all changes" },
            { value: "select", label: "Let me decide file by file" },
            { value: "cancel", label: "No, discard all changes", hint: "your files stay as they are" },
        ],
    });
    if (isCancel(choice) || choice === "cancel") return { approved: [] };
    if (choice === "all") return { approved: all };

    const approved: string[] = [];
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
            // Backing out keeps what was accepted so far and discards the rest.
            if (isCancel(opt)) return { approved };
            if (opt === "diff") {
                if (g.patch) console.log("\n" + colorizeDiff(g.patch, FULL_DIFF_LINES) + "\n");
                continue;
            }
            if (opt === "accept") approved.push(g.id);
            break;
        }
    }
    return { approved };
}

/** Ask whether a shell command may run. */
export async function confirmCommand(
    request: Extract<ConfirmRequest, { kind: "command" }>,
): Promise<ConfirmReply> {
    console.log(
        `\n${chalk.yellow("▌")} ${chalk.bold("yuvi wants to run a command on your computer:")}\n  ${chalk.cyan(request.command)}`,
    );
    const choice = await select({
        message: "Allow this command?",
        options: [
            { value: "yes", label: "Yes, run it" },
            ...(request.rememberAs
                ? [{
                    value: "always",
                    label: `Yes, and don't ask again for "${request.rememberAs}" commands this session`,
                }]
                : []),
            { value: "no", label: "No, don't run it" },
        ],
    });
    if (isCancel(choice) || choice === "no") return { approved: [] };
    return { approved: ["run"], remember: choice === "always" };
}

export async function chooseOne<T extends string>(
    question: string,
    choices: Choice<T>[],
    initial?: T,
): Promise<T | null> {
    const picked = await select({
        message: question,
        ...(initial ? { initialValue: initial as string } : {}),
        options: choices.map((c) => ({ value: c.value as string, label: c.label, ...(c.hint ? { hint: c.hint } : {}) })),
    });
    return isCancel(picked) ? null : (picked as T);
}

export async function askText(question: string): Promise<string | null> {
    const typed = await text({ message: question });
    return isCancel(typed) ? null : String(typed ?? "");
}

/** Ask for an OpenRouter key and save it for this user. Returns false when skipped. */
export async function setupApiKey(settings: Settings): Promise<boolean> {
    log.info(
        [
            chalk.bold("yuvi needs an OpenRouter key to talk to an AI model."),
            "1. Open https://openrouter.ai/keys and sign in (free)",
            "2. Create a key and copy it",
            "3. Paste it below — it is saved on this computer only (~/.yuvi/settings.json)",
        ].join("\n"),
    );
    const key = await password({
        message: "Paste your OpenRouter key (Esc to skip):",
        validate: (value) =>
            value && value.trim().length < MIN_KEY_LENGTH ? "That looks too short to be a key." : undefined,
    });
    if (isCancel(key) || !String(key ?? "").trim()) return false;
    settings.save({ apiKey: String(key).trim() });
    log.success("Key saved. You are ready to go.");
    return true;
}

/** Ask for a new model id and save it. Returns the new id, or null when kept. */
export async function chooseModel(settings: Settings): Promise<string | null> {
    log.info(
        `Current model: ${chalk.cyan(settings.modelId("main"))}\n` +
        chalk.dim("Find model ids at https://openrouter.ai/models (pick one that supports tools)."),
    );
    const id = await text({
        message: "New model id (Esc to keep the current one):",
        placeholder: settings.modelId("main"),
    });
    if (isCancel(id) || !String(id ?? "").trim()) return null;
    settings.save({ model: String(id).trim() });
    return settings.modelId("main");
}
