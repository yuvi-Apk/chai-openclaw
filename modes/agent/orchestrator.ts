import { isCancel, log, text } from "@clack/prompts";
import chalk from "chalk";
import type { ToolSet } from "ai";
import { defaultAgentConfig, type AgentMode, type AgentSession } from "./types";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { createTaskTool } from "./subagents";
import { getModelId } from "../../ai";
import { runApprovalFlow } from "./approval";
import { AgentUI, errorText, formatTokens } from "./ui";
import { RepoMap } from "./repo-map";
import { compactHistory, runTurn, type BrainContext } from "./brain";
import {
    detectCheckCommands,
    loadLastSession,
    loadProjectConfig,
    saveProjectConfig,
} from "./memory";

const MODES: AgentMode[] = ["ask", "auto-edit", "plan"];

const HELP = [
    chalk.bold("Agent commands"),
    `${chalk.cyan("/help")}            show this help`,
    `${chalk.cyan("/mode [name]")}     switch mode: ask · auto-edit · plan`,
    `${chalk.cyan("/model [id]")}      show or change the OpenRouter model`,
    `${chalk.cyan("/undo")}            restore the files changed by the last apply`,
    `${chalk.cyan("/clear")}           forget the conversation and start fresh`,
    `${chalk.cyan("/resume")}          continue the last saved conversation`,
    `${chalk.cyan("/compact")}         summarise the conversation to free context`,
    `${chalk.cyan("/cost")}            tokens and cost used this session`,
    `${chalk.cyan("/checks")}          show the commands used to verify changes`,
    `${chalk.cyan("/exit")}            leave agent mode`,
    "",
    chalk.dim("Write @path/to/file in a message to attach that file."),
    chalk.dim("While yuvi works: type + Enter to send a correction, Esc to stop."),
].join("\n");

export function createSession(mode: AgentMode): AgentSession {
    const config = defaultAgentConfig();

    // Check commands: use the saved ones, or detect and save them once.
    const projectConfig = loadProjectConfig(config.codebasePath);
    if (projectConfig.checkCommands) {
        config.checkCommands = projectConfig.checkCommands;
    } else {
        config.checkCommands = detectCheckCommands(config.codebasePath);
        saveProjectConfig(config.codebasePath, {
            ...projectConfig,
            checkCommands: config.checkCommands,
        });
    }

    const tracker = new ActionTracker();
    const executor = new ToolExecutor(config, tracker);
    const ui = new AgentUI();

    const session: AgentSession = {
        config,
        mode,
        tracker,
        executor,
        ui,
        messages: [],
        todos: [],
        usage: { inputTokens: 0, outputTokens: 0, lastInputTokens: 0, cost: 0 },
        allowedCommands: new Set(),
        verifiedSeq: 0,
        checkpoint: async () => {
            if (!executor.hasStaged()) return { applied: [], rejected: [], errors: [] };
            await ui.withPrompt(() =>
                runApprovalFlow(tracker, { autoApprove: session.mode === "auto-edit" }),
            );
            const rejected = executor.revertRejected();
            const { errors, applied } = executor.applyApprovedFromTracker();
            if (applied.length) {
                ui.success(
                    `Applied ${applied.length} file${applied.length === 1 ? "" : "s"}: ${applied.join(", ")}`,
                );
            }
            if (rejected.length) ui.note(`Rejected: ${rejected.join(", ")}`);
            for (const e of errors) ui.failure(e);
            return { applied, rejected, errors };
        },
    };
    return session;
}

/** Replace `@path` mentions with the content of those files. */
function attachMentions(session: AgentSession, message: string): string {
    const attachments: string[] = [];
    const seen = new Set<string>();
    for (const match of message.matchAll(/(?:^|\s)@([\w./\\-]+)/g)) {
        const rel = match[1]!;
        if (seen.has(rel)) continue;
        seen.add(rel);
        try {
            const content = session.executor.readFile(rel);
            attachments.push(`[Attached file: ${rel}]\n${content}`);
            session.ui.print(chalk.dim(`  ⎿ attached ${rel}`));
        } catch {
            // not a readable file: leave the text as the user wrote it
        }
    }
    return attachments.length ? `${message}\n\n${attachments.join("\n\n")}` : message;
}

/** Handle a slash command. Returns "exit" to leave agent mode. */
async function runSlashCommand(
    session: AgentSession,
    line: string,
): Promise<"exit" | "handled"> {
    const [command, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    const { ui, executor } = session;

    switch ((command ?? "").toLowerCase()) {
        case "exit":
        case "quit":
            return "exit";
        case "help":
            log.info(HELP);
            break;
        case "mode": {
            const wanted = MODES.find((m) => m === arg.toLowerCase());
            if (arg && !wanted) {
                ui.failure(`Unknown mode "${arg}". Use: ${MODES.join(", ")}`);
                break;
            }
            session.mode = wanted ?? MODES[(MODES.indexOf(session.mode) + 1) % MODES.length]!;
            ui.success(`Mode: ${session.mode}`);
            break;
        }
        case "model":
            if (arg) process.env.OPENROUTER_DEFAULT_MODEL = arg;
            ui.print(
                `Main model: ${chalk.cyan(getModelId("main"))}   Fast model: ${chalk.cyan(getModelId("fast"))}`,
            );
            break;
        case "undo": {
            const restored = executor.undoLast();
            if (!restored.length) {
                ui.note("Nothing to undo.");
                break;
            }
            ui.success(`Restored: ${restored.join(", ")}`);
            session.messages.push({
                role: "user",
                content: `[harness] The user undid your last applied changes. These files are back to their previous content: ${restored.join(", ")}. Read them again before editing.`,
            });
            break;
        }
        case "clear":
            session.messages = [];
            session.todos = [];
            session.usage.lastInputTokens = 0;
            ui.success("Conversation cleared.");
            break;
        case "resume": {
            const saved = loadLastSession(session.config.codebasePath);
            if (!saved) {
                ui.note("No saved conversation for this project.");
                break;
            }
            session.messages = saved.messages;
            ui.success(
                `Resumed ${saved.messages.length} messages from ${saved.savedAt.slice(0, 16).replace("T", " ")}.`,
            );
            break;
        }
        case "compact":
            if (!(await compactHistory(session))) ui.note("Nothing to compact yet.");
            break;
        case "cost": {
            const u = session.usage;
            ui.print(
                `Tokens: ${formatTokens(u.inputTokens)} in · ${formatTokens(u.outputTokens)} out` +
                (u.cost > 0 ? ` · $${u.cost.toFixed(4)}` : "") +
                (u.lastInputTokens
                    ? ` · context ${Math.round((u.lastInputTokens / session.config.contextWindow) * 100)}%`
                    : ""),
            );
            break;
        }
        case "checks":
            ui.print(
                session.config.checkCommands.length
                    ? `Verification commands (edit .yuvi/config.json to change):\n  ${session.config.checkCommands.join("\n  ")}`
                    : "No verification commands. Add them to .yuvi/config.json under \"checkCommands\".",
            );
            break;
        default:
            ui.failure(`Unknown command /${command}. Try /help.`);
    }
    return "handled";
}

export async function runAgentMode(options: { mode?: AgentMode } = {}) {
    // Provider warnings would break the live display; errors are still shown.
    (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

    const session = createSession(options.mode ?? "ask");
    const { ui, executor, config } = session;

    const repoMap = new RepoMap(executor);
    repoMap.build();
    const baseTools = createAgentTools(session, repoMap);
    const ctx: BrainContext = {
        repoMap,
        baseTools,
        tools: { ...baseTools, task: createTaskTool(session, baseTools) } as ToolSet,
    };

    log.step(
        [
            chalk.bold(`yuvi agent · ${session.mode} mode`),
            chalk.dim(`model   ${getModelId("main")}`),
            chalk.dim(`project ${config.codebasePath} (${repoMap.fileCount} code files mapped)`),
            chalk.dim(
                `checks  ${config.checkCommands.length ? config.checkCommands.join(" ; ") : "none detected"}`,
            ),
            chalk.dim("/help for commands · Esc stops a run · type while it works to correct it"),
        ].join("\n"),
    );
    if (!process.env.OPENROUTER_API_KEY) {
        log.warn("OPENROUTER_API_KEY is not set. Add it to .env before asking anything.");
    }

    while (true) {
        const message = await text({
            message: session.mode === "ask" ? "You:" : `You (${session.mode}):`,
            placeholder: "ask a question or describe a change · /help",
            validate: (value) => (!value || !value.trim() ? "Say something first!" : undefined),
        });

        if (isCancel(message)) break;
        const line = message.trim();
        if (line === "exit") break;

        if (line.startsWith("/")) {
            if ((await runSlashCommand(session, line)) === "exit") break;
            continue;
        }

        try {
            await runTurn(session, ctx, attachMentions(session, line));
        } catch (error) {
            ui.failure(`Agent error: ${errorText(error).slice(0, 500)}`);
        }
    }

    // Leaving with unreviewed edits: give the user the last word on them.
    if (executor.hasStaged()) {
        log.warn("There are staged changes that were not reviewed yet.");
        await session.checkpoint();
    }
    executor.clearStaging();
}
