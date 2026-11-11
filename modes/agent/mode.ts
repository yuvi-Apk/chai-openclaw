/**
 * Agent mode as a pluggable mode: a coding agent that reads, edits and runs
 * things in the user's project, with every change shown for approval first.
 * This file wires a session together; the thinking is in brain.ts.
 */
import type { ToolSet } from "ai";
import { ConfigError, errorText } from "../../core/errors";
import { formatTokens } from "../../core/format";
import type { Line, Mode, ModeCommand, ModeHost, ModeSession, ModeStatus, Tone } from "../../core/mode";
import { ActionTracker } from "./action-tracker";
import { createAgentTools } from "./agent-tools";
import { runApprovalFlow } from "./approval";
import { compactHistory, runTurn, type BrainContext } from "./brain";
import { detectCheckCommands, loadLastSession, loadProjectConfig, saveProjectConfig } from "./memory";
import { AgentOutput } from "./output";
import { RepoMap } from "./repo-map";
import { createTaskTool } from "./subagents";
import { ToolExecutor } from "./tool-executor";
import { loadAgentConfig, type AgentMode, type AgentSession } from "./types";

const MODES: AgentMode[] = ["ask", "auto-edit", "plan"];

/** How each sub-mode is named and explained to the user. */
const MODE_INFO: Record<AgentMode, { name: string; meaning: string; tone: Tone }> = {
    ask: { name: "Ask mode", meaning: "I ask before I change files or run commands", tone: "good" },
    "auto-edit": { name: "Auto mode", meaning: "I change files without asking; commands still ask", tone: "warn" },
    plan: { name: "Plan mode", meaning: "I only read and write a plan; nothing is changed", tone: "info" },
};

const dim = (text: string) => ({ text, tone: "dim" as const });

/** Build the shared state of one agent session. */
export function createSession(mode: AgentMode, host: ModeHost): AgentSession {
    if (!host.workspace) throw new ConfigError("Agent mode needs a project folder to work in.");
    const config = loadAgentConfig(host.core.settings, host.workspace);
    // The agent only gets the file and shell tools the front end granted.
    const canWrite = host.grants.includes("fs.write");
    config.tools = {
        allowShellExecution: host.grants.includes("shell"),
        allowFileModification: canWrite,
        allowFileCreation: canWrite,
        allowFolderCreation: canWrite,
    };

    // Check commands: use the saved ones, or detect and save them once.
    const projectConfig = loadProjectConfig(config.codebasePath);
    if (projectConfig.checkCommands) {
        config.checkCommands = projectConfig.checkCommands;
    } else {
        config.checkCommands = detectCheckCommands(config.codebasePath);
        saveProjectConfig(config.codebasePath, { ...projectConfig, checkCommands: config.checkCommands });
    }

    const tracker = new ActionTracker();
    const executor = new ToolExecutor(config, tracker);
    const ui = new AgentOutput(host);

    const session: AgentSession = {
        core: host.core,
        host,
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
            await runApprovalFlow(tracker, host, { autoApprove: session.mode === "auto-edit" });
            const rejected = executor.revertRejected();
            const { errors, applied } = executor.applyApprovedFromTracker();
            if (applied.length) {
                ui.line([
                    {
                        text: `✓ Saved ${applied.length} file${applied.length === 1 ? "" : "s"}: ${applied.join(", ")}`,
                        tone: "good",
                    },
                    { text: "  (menu → Undo last change to roll back)", tone: "dim" },
                ]);
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
            session.ui.line(dim(`  ⎿ attached ${rel}`));
        } catch {
            session.ui.note(`Could not attach @${rel}: no such file in this project.`);
        }
    }
    return attachments.length ? `${message}\n\n${attachments.join("\n\n")}` : message;
}

class AgentModeSession implements ModeSession {
    private readonly session: AgentSession;
    private readonly brain: BrainContext;

    constructor(mode: AgentMode, host: ModeHost) {
        this.session = createSession(mode, host);
        const repoMap = new RepoMap(this.session.executor);
        repoMap.build();
        const baseTools = createAgentTools(this.session, repoMap);
        this.brain = {
            repoMap,
            baseTools,
            tools: { ...baseTools, task: createTaskTool(this.session, baseTools) } as ToolSet,
        };
    }

    async handle(input: string, options: { signal: AbortSignal }): Promise<void> {
        const { session } = this;
        try {
            await runTurn(session, this.brain, attachMentions(session, input), options.signal);
        } catch (error) {
            session.ui.error(errorText(error));
        }
    }

    status(): ModeStatus {
        const info = MODE_INFO[this.session.mode];
        return { label: info.name, detail: info.meaning, tone: info.tone };
    }

    cycle(): void {
        const { session } = this;
        session.mode = MODES[(MODES.indexOf(session.mode) + 1) % MODES.length]!;
    }

    files(): string[] {
        return this.session.executor.listTextFiles(".");
    }

    steer(text: string): void {
        this.session.onSteer?.(text);
    }

    welcome(): Line[] {
        const { session } = this;
        const info = MODE_INFO[session.mode];
        const model = session.core.settings.modelId("main");
        return [
            "",
            [
                { text: "  yuvi is ready", tone: "title" },
                { text: `  ·  ${model}  ·  ${this.brain.repoMap.fileCount} code files in this project`, tone: "dim" },
            ],
            "",
            "  Tell me what you want in plain words and press Enter. For example:",
            dim("    • explain what this project does"),
            dim("    • add a button that clears the form"),
            dim("    • find out why the tests fail and fix it"),
            "",
            ["  ", { text: `● ${info.name}`, tone: info.tone }, " ", { text: `— ${info.meaning}`, tone: "dim" }],
            dim("  I always show you a change before saving it, and you can undo it from the menu."),
        ];
    }

    help(): Line[] {
        return [
            { text: "Modes", tone: "strong" },
            ...MODES.map((m): Line => [
                { text: "●", tone: MODE_INFO[m].tone },
                ` ${MODE_INFO[m].name.padEnd(10)} ${MODE_INFO[m].meaning}`,
            ]),
            "",
            dim("While yuvi is working you can type a correction and press Enter; it is delivered at the next step."),
            dim("Every change is shown to you first. The menu has “Undo last change” if you change your mind."),
        ];
    }

    commands(): ModeCommand[] {
        const { session } = this;
        const { ui, executor } = session;
        return [
            {
                name: "/mode",
                label: "Switch mode",
                hint: `now: ${MODE_INFO[session.mode].name}`,
                run: () => this.chooseMode(),
            },
            {
                name: "/undo",
                label: "Undo last change",
                hint: "put files back as they were",
                run: () => {
                    const restored = executor.undoLast();
                    if (!restored.length) {
                        ui.note("Nothing to undo: yuvi has not saved any change in this session.");
                        return;
                    }
                    ui.success(`Put back as before: ${restored.join(", ")}`);
                    session.messages.push({
                        role: "user",
                        content: `[harness] The user undid your last applied changes. These files are back to their previous content: ${restored.join(", ")}. Read them again before editing.`,
                    });
                },
            },
            {
                name: "/new",
                label: "Start a new conversation",
                hint: "yuvi forgets this chat",
                run: () => {
                    session.messages = [];
                    session.todos = [];
                    session.usage.lastInputTokens = 0;
                    ui.success("New conversation started.");
                },
            },
            {
                name: "/resume",
                label: "Continue last conversation",
                hint: "from the previous session",
                run: () => {
                    const saved = loadLastSession(session.config.codebasePath);
                    if (!saved) {
                        ui.note("There is no earlier conversation saved for this project.");
                        return;
                    }
                    session.messages = saved.messages;
                    ui.success(
                        `Continuing the conversation from ${saved.savedAt.slice(0, 16).replace("T", " ")} (${saved.messages.length} messages).`,
                    );
                },
            },
            {
                name: "/compact",
                label: "Free up memory",
                hint: "summarise a long chat",
                run: async () => {
                    if (!(await compactHistory(session))) {
                        ui.note("The conversation is still short; nothing to free up.");
                    }
                },
            },
            {
                name: "/cost",
                label: "Show usage",
                hint: "tokens and cost",
                run: () => {
                    const u = session.usage;
                    ui.line(
                        `Used this session: ${formatTokens(u.inputTokens)} tokens read · ${formatTokens(u.outputTokens)} written` +
                        (u.cost > 0 ? ` · $${u.cost.toFixed(4)}` : "") +
                        (u.lastInputTokens
                            ? ` · memory ${Math.round((u.lastInputTokens / session.config.contextWindow) * 100)}% full`
                            : ""),
                    );
                },
            },
            {
                name: "/checks",
                label: "Show check commands",
                hint: "how yuvi tests its changes",
                run: () => {
                    const checks = session.config.checkCommands;
                    if (!checks.length) {
                        ui.line('No check commands found for this project. You can add them in .yuvi/config.json under "checkCommands".');
                        return;
                    }
                    ui.line([
                        `After changing code, yuvi runs:\n  ${checks.join("\n  ")}\n`,
                        { text: "Change this list in .yuvi/config.json", tone: "dim" },
                    ]);
                },
            },
        ];
    }

    /** Pick a sub-mode from a list that explains each one. */
    private async chooseMode(): Promise<void> {
        const { session } = this;
        const picked = await session.host.choose(
            "Which mode?",
            MODES.map((m) => ({ value: m, label: MODE_INFO[m].name, hint: MODE_INFO[m].meaning })),
            session.mode,
        );
        if (!picked) return;
        session.mode = picked;
        session.ui.success(`${MODE_INFO[picked].name}: ${MODE_INFO[picked].meaning}`);
    }

    /** Leaving with unreviewed edits: give the user the last word on them. */
    async close(): Promise<void> {
        const { session } = this;
        if (session.executor.hasStaged()) {
            session.ui.note("yuvi prepared changes that you have not decided on yet.");
            await session.checkpoint();
        }
        session.executor.clearStaging();
    }
}

const AGENT_TOOLS = ["fs.read", "fs.write", "shell"] as const;

/** The agent, starting in the given sub-mode. Registered once per menu entry. */
export function agentMode(start: AgentMode, entry: { name: string; label: string; description: string }): Mode {
    return {
        ...entry,
        tools: AGENT_TOOLS,
        commandStyle: "menu",
        placeholder: "Type your message, then press Enter",
        createSession: (host) => new AgentModeSession(start, host),
    };
}
