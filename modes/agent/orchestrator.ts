import { isCancel, log, password, select, text } from "@clack/prompts";
import chalk from "chalk";
import type { ToolSet } from "ai";
import { defaultAgentConfig, type AgentMode, type AgentSession } from "./types";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { createTaskTool } from "./subagents";
import { applyUserSettings, getModelId, saveUserSettings } from "../../ai";
import { runApprovalFlow } from "./approval";
import { AgentUI, errorText, formatTokens } from "./ui";
import { RepoMap } from "./repo-map";
import { compactHistory, runTurn, type BrainContext } from "./brain";
import { readInput } from "./input";
import {
    detectCheckCommands,
    loadLastSession,
    loadProjectConfig,
    saveProjectConfig,
} from "./memory";

const MODES: AgentMode[] = ["ask", "auto-edit", "plan"];

/** How each mode is shown and explained to the user. */
const MODE_INFO: Record<AgentMode, { name: string; meaning: string; paint: (s: string) => string }> = {
    ask: {
        name: "Ask mode",
        meaning: "I ask before I change files or run commands",
        paint: chalk.green,
    },
    "auto-edit": {
        name: "Auto mode",
        meaning: "I change files without asking; commands still ask",
        paint: chalk.yellow,
    },
    plan: {
        name: "Plan mode",
        meaning: "I only read and write a plan; nothing is changed",
        paint: chalk.blue,
    },
};

const HELP = [
    chalk.bold("How to use yuvi"),
    "",
    `${chalk.cyan("Type a message")}   say what you want in plain words, then press Enter`,
    `${chalk.cyan("/")}                open the menu (mode, model, undo, new chat, …)`,
    `${chalk.cyan("Shift+Tab")}        switch mode: Ask → Auto → Plan`,
    `${chalk.cyan("@file")}            mention a file to attach it, e.g. @src/app.ts`,
    `${chalk.cyan("Up / Down")}        bring back an earlier message`,
    `${chalk.cyan("Esc")}              while yuvi works: stop it. While typing: clear the line`,
    `${chalk.cyan("Ctrl+C")}           leave the agent`,
    "",
    chalk.bold("Modes"),
    ...MODES.map((m) => `${MODE_INFO[m].paint("●")} ${MODE_INFO[m].name.padEnd(10)} ${MODE_INFO[m].meaning}`),
    "",
    chalk.dim("While yuvi is working you can type a correction and press Enter; it is delivered at the next step."),
    chalk.dim("Every change is shown to you first. The menu has “Undo last change” if you change your mind."),
].join("\n");

/** The hint bar under the input box. Hints are dropped from the right when the terminal is narrow. */
function footer(session: AgentSession, width: number): string {
    const info = MODE_INFO[session.mode];
    const head = `  ● ${info.name}: ${info.meaning}`;
    const hints = ["shift+tab switch mode", "/ menu", "? help", "@file attach", "ctrl+c exit"];
    let plain = head;
    const used: string[] = [];
    for (const hint of hints) {
        if ((plain + " · " + hint).length > width) break;
        plain += " · " + hint;
        used.push(hint);
    }
    const shownHead = head.length > width ? head.slice(0, width - 1) + "…" : head;
    return (
        info.paint(shownHead) + chalk.dim(used.map((h) => ` · ${h}`).join(""))
    );
}

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
                    `Saved ${applied.length} file${applied.length === 1 ? "" : "s"}: ${applied.join(", ")}` +
                    chalk.dim("  (menu → Undo last change to roll back)"),
                );
            }
            if (rejected.length) ui.note(`Discarded, files unchanged: ${rejected.join(", ")}`);
            for (const e of errors) ui.failure(`Could not save a file: ${e}`);
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
            session.ui.note(`Could not attach @${rel}: no such file in this project.`);
        }
    }
    return attachments.length ? `${message}\n\n${attachments.join("\n\n")}` : message;
}

/** Ask for an OpenRouter key and save it for this user. Returns false when skipped. */
export async function setupApiKey(): Promise<boolean> {
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
            value && value.trim().length < 20 ? "That looks too short to be a key." : undefined,
    });
    if (isCancel(key) || !String(key ?? "").trim()) return false;
    saveUserSettings({ apiKey: String(key).trim() });
    log.success("Key saved. You are ready to go.");
    return true;
}

/** Pick a mode from a list that explains each one. */
async function chooseMode(session: AgentSession): Promise<void> {
    const picked = await select<AgentMode>({
        message: "Which mode?",
        initialValue: session.mode,
        options: MODES.map((m) => ({
            value: m,
            label: MODE_INFO[m].name,
            hint: MODE_INFO[m].meaning,
        })),
    });
    if (isCancel(picked)) return;
    session.mode = picked;
    session.ui.success(`${MODE_INFO[picked].name}: ${MODE_INFO[picked].meaning}`);
}

async function chooseModel(session: AgentSession): Promise<void> {
    log.info(
        `Current model: ${chalk.cyan(getModelId("main"))}\n` +
        chalk.dim("Find model ids at https://openrouter.ai/models (pick one that supports tools)."),
    );
    const id = await text({
        message: "New model id (Esc to keep the current one):",
        placeholder: getModelId("main"),
    });
    if (isCancel(id) || !String(id ?? "").trim()) return;
    saveUserSettings({ model: String(id).trim() });
    session.ui.success(`Model changed to ${getModelId("main")} and saved for next time.`);
}

type MenuAction =
    | "mode" | "model" | "key" | "undo" | "clear" | "resume"
    | "compact" | "cost" | "checks" | "help" | "exit" | "back";

/** The `/` menu: everything a user can do besides sending a message. */
async function openMenu(session: AgentSession): Promise<"exit" | "handled"> {
    const action = await select<MenuAction>({
        message: "Menu",
        options: [
            { value: "mode", label: "Switch mode", hint: `now: ${MODE_INFO[session.mode].name}` },
            { value: "undo", label: "Undo last change", hint: "put files back as they were" },
            { value: "clear", label: "Start a new conversation", hint: "yuvi forgets this chat" },
            { value: "resume", label: "Continue last conversation", hint: "from the previous session" },
            { value: "model", label: "Change AI model", hint: `now: ${getModelId("main")}` },
            { value: "key", label: "Set API key", hint: "OpenRouter key" },
            { value: "compact", label: "Free up memory", hint: "summarise a long chat" },
            { value: "cost", label: "Show usage", hint: "tokens and cost" },
            { value: "checks", label: "Show check commands", hint: "how yuvi tests its changes" },
            { value: "help", label: "Help", hint: "keys and modes" },
            { value: "exit", label: "Exit agent", hint: "back to the main menu" },
            { value: "back", label: "Back", hint: "close this menu" },
        ],
    });
    if (isCancel(action) || action === "back") return "handled";

    const { ui, executor } = session;
    switch (action) {
        case "exit":
            return "exit";
        case "help":
            log.info(HELP);
            break;
        case "mode":
            await chooseMode(session);
            break;
        case "model":
            await chooseModel(session);
            break;
        case "key":
            await setupApiKey();
            break;
        case "undo": {
            const restored = executor.undoLast();
            if (!restored.length) {
                ui.note("Nothing to undo: yuvi has not saved any change in this session.");
                break;
            }
            ui.success(`Put back as before: ${restored.join(", ")}`);
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
            ui.success("New conversation started.");
            break;
        case "resume": {
            const saved = loadLastSession(session.config.codebasePath);
            if (!saved) {
                ui.note("There is no earlier conversation saved for this project.");
                break;
            }
            session.messages = saved.messages;
            ui.success(
                `Continuing the conversation from ${saved.savedAt.slice(0, 16).replace("T", " ")} (${saved.messages.length} messages).`,
            );
            break;
        }
        case "compact":
            if (!(await compactHistory(session))) {
                ui.note("The conversation is still short; nothing to free up.");
            }
            break;
        case "cost": {
            const u = session.usage;
            ui.print(
                `Used this session: ${formatTokens(u.inputTokens)} tokens read · ${formatTokens(u.outputTokens)} written` +
                (u.cost > 0 ? ` · $${u.cost.toFixed(4)}` : "") +
                (u.lastInputTokens
                    ? ` · memory ${Math.round((u.lastInputTokens / session.config.contextWindow) * 100)}% full`
                    : ""),
            );
            break;
        }
        case "checks":
            ui.print(
                session.config.checkCommands.length
                    ? `After changing code, yuvi runs:\n  ${session.config.checkCommands.join("\n  ")}\n${chalk.dim("Change this list in .yuvi/config.json")}`
                    : "No check commands found for this project. You can add them in .yuvi/config.json under \"checkCommands\".",
            );
            break;
    }
    return "handled";
}

function showWelcome(session: AgentSession, codeFiles: number): void {
    const info = MODE_INFO[session.mode];
    console.log(
        [
            "",
            chalk.bold.cyan("  yuvi is ready") + chalk.dim(`  ·  ${getModelId("main")}  ·  ${codeFiles} code files in this project`),
            "",
            "  Tell me what you want in plain words and press Enter. For example:",
            chalk.dim("    • explain what this project does"),
            chalk.dim("    • add a button that clears the form"),
            chalk.dim("    • find out why the tests fail and fix it"),
            "",
            `  ${info.paint(`● ${info.name}`)} ${chalk.dim(`— ${info.meaning}`)}`,
            chalk.dim("  I always show you a change before saving it, and you can undo it from the menu."),
        ].join("\n"),
    );
}

export async function runAgentMode(options: { mode?: AgentMode } = {}) {
    // Provider warnings would break the live display; errors are still shown.
    (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

    applyUserSettings();
    if (!process.env.OPENROUTER_API_KEY && process.stdin.isTTY) {
        if (!(await setupApiKey())) {
            log.warn("No key set. You can add it later: type / and choose “Set API key”.");
        }
    }

    const session = createSession(options.mode ?? "ask");
    const { ui, executor } = session;

    const repoMap = new RepoMap(executor);
    repoMap.build();
    const baseTools = createAgentTools(session, repoMap);
    const ctx: BrainContext = {
        repoMap,
        baseTools,
        tools: { ...baseTools, task: createTaskTool(session, baseTools) } as ToolSet,
    };

    showWelcome(session, repoMap.fileCount);
    const history: string[] = [];

    while (true) {
        const input = await readInput({
            footer: (width) => footer(session, width),
            onCycleMode: () => {
                session.mode = MODES[(MODES.indexOf(session.mode) + 1) % MODES.length]!;
            },
            history,
            files: () => executor.listTextFiles("."),
            placeholder: "Type your message, then press Enter",
        });

        if (input.kind === "exit") break;
        if (input.kind === "menu") {
            if ((await openMenu(session)) === "exit") break;
            continue;
        }

        const line = input.text;
        if (line === "exit" || line === "/exit" || line === "quit") break;
        if (line === "/help" || line === "help") {
            log.info(HELP);
            continue;
        }
        if (line.startsWith("/")) {
            if ((await openMenu(session)) === "exit") break;
            continue;
        }

        history.push(line);
        try {
            await runTurn(session, ctx, attachMentions(session, line));
        } catch (error) {
            ui.errorBox(errorText(error));
        }
    }

    // Leaving with unreviewed edits: give the user the last word on them.
    if (executor.hasStaged()) {
        log.warn("yuvi prepared changes that you have not decided on yet.");
        await session.checkpoint();
    }
    executor.clearStaging();
}
