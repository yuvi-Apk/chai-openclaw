import type { ModelMessage } from "ai";
import type { ActionTracker } from "./action-tracker";
import type { ToolExecutor } from "./tool-executor";
import type { AgentUI } from "./ui";

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
    tools: {
        allowShellExecution: boolean;
        allowFileModification: boolean;
        allowFileCreation: boolean;
        allowFolderCreation: boolean;
    };
}

export const defaultAgentConfig = (): AgentConfig => ({
    codebasePath: process.cwd(),
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
    contextWindow: Number(process.env.YUVI_CONTEXT_WINDOW) || 120_000,
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

export interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}

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
    config: AgentConfig;
    mode: AgentMode;
    tracker: ActionTracker;
    executor: ToolExecutor;
    ui: AgentUI;
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
