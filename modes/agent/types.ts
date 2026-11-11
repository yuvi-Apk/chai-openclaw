import type { ModelMessage } from "ai";
import type { Core } from "../../core/compose";
import type { Settings } from "../../core/config";
import type { ModeHost, TodoItem } from "../../core/mode";
import type { ActionTracker } from "./action-tracker";
import type { ToolExecutor } from "./tool-executor";
import type { AgentOutput } from "./output";

export type ActionType =
    | 'file_create'
    | 'file_modify'
    | 'file_delete'
    | 'folder_create'
    | 'code_analysis'
    | 'tool_execute';

export type ActionStatus = 'pending' | 'executed' | 'approved' | 'rejected';

export interface ActionLog {
    id: string;
    timestamp: Date;
    type: ActionType;
    path: string;
    details: {
        before?: string;
        after?: string;
        toolName?: string;
        toolResult?: string;
        error?: string;
        command?: string;
    };
    status: ActionStatus;
    userApproved?: boolean;
}

/**
 * ask       - every edit batch and every non-read-only command needs approval
 * auto-edit - edits are applied without asking, commands still ask
 * plan      - read-only: the agent explores and writes a plan, nothing is changed
 */
export type AgentMode = 'ask' | 'auto-edit' | 'plan';

export interface AgentConfig {
    codebasePath: string;
    maxFileSizeToRead: number;
    excludePatterns: string[];
    /** Longest tool result (in characters) that is sent back to the model. */
    maxToolOutputChars: number;
    /** Commands the harness runs to verify edits (type-check, lint, tests). */
    checkCommands: string[];
    /** Approximate context window of the model, used to decide when to compact. */
    contextWindow: number;
    /** Ask the fast model what kind of task a request is (otherwise keywords decide). */
    modelTriage: boolean;
    /** Have a reviewer sub-agent read the diff before the user sees it. */
    selfReview: boolean;
    /** Extra folders that hold SKILL.md files. */
    skillDirs: string[];
    /** The environment shell commands run with (API keys removed). */
    commandEnv: Record<string, string | undefined>;
    tools: {
        allowShellExecution: boolean;
        allowFileModification: boolean;
        allowFileCreation: boolean;
        allowFolderCreation: boolean;
    };
}

const DEFAULT_CONTEXT_WINDOW = 120_000;

/** The agent's settings for one workspace. */
export const loadAgentConfig = (settings: Settings, workspace: string): AgentConfig => ({
    codebasePath: workspace,
    maxFileSizeToRead: 1024 * 1024,
    excludePatterns: [
        'node_modules',
        '.git',
        'dist',
        'build',
        '.next',
        '.yuvi',
        '*.log',
        '.env*',
    ],
    maxToolOutputChars: 12_000,
    checkCommands: [],
    contextWindow: settings.number("YUVI_CONTEXT_WINDOW", DEFAULT_CONTEXT_WINDOW, 1000, 10_000_000),
    modelTriage: !settings.isOff("YUVI_TRIAGE"),
    selfReview: !settings.isOff("YUVI_SELF_REVIEW"),
    skillDirs: settings.list("SKILLS_DIRS", ";"),
    commandEnv: settings.childEnv(),
    tools: {
        allowShellExecution: true,
        allowFileModification: true,
        allowFileCreation: true,
        allowFolderCreation: true,
    },
});

export function isMutationType(t: ActionType): boolean {
    return (
        t === 'file_create' ||
        t === 'file_modify' ||
        t === 'file_delete' ||
        t === 'folder_create' ||
        t === 'tool_execute'
    );
}

export type { TodoItem };

export interface UsageTotals {
    inputTokens: number;
    outputTokens: number;
    /** Input tokens of the most recent model call = current context size. */
    lastInputTokens: number;
    cost: number;
}

/** Result of showing staged edits to the user and writing the approved ones. */
export interface CheckpointResult {
    /** Paths written to disk. */
    applied: string[];
    /** Paths the user refused. */
    rejected: string[];
    errors: string[];
}

/** Everything one agent session shares between the brain, the tools and the UI. */
export interface AgentSession {
    /** Shared services: settings, models, the text model client. */
    core: Core;
    /** The front end: where events go and questions are asked. */
    host: ModeHost;
    config: AgentConfig;
    mode: AgentMode;
    tracker: ActionTracker;
    executor: ToolExecutor;
    /** Reports what the agent does, as mode events. */
    ui: AgentOutput;
    /** Receives a message the user typed while a turn is running. */
    onSteer?: (text: string) => void;
    messages: ModelMessage[];
    todos: TodoItem[];
    usage: UsageTotals;
    /** Command prefixes the user allowed for the rest of the session. */
    allowedCommands: Set<string>;
    /** executor.editSeq at the time the last successful check ran. */
    verifiedSeq: number;
    /** Abort signal of the turn that is running right now. */
    abortSignal?: AbortSignal;
    /** Review staged edits with the user and apply the approved ones. */
    checkpoint(): Promise<CheckpointResult>;
}
