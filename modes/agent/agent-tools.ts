import { tool } from "ai";
import z from "zod";
import { isCancel, select, text } from "@clack/prompts";
import type { AgentSession } from "./types";
import type { RepoMap } from "./repo-map";
import { approveCommand, isReadOnlyCommand } from "./approval";
import { remember } from "./memory";

/** Tools that change the workspace. Disabled in plan mode and before a plan exists. */
export const EDIT_TOOLS = [
    "edit_file",
    "modify_file",
    "create_file",
    "delete_file",
    "create_folder",
] as const;

/** Tools that only look. Safe for explorer, planner and reviewer sub-agents. */
export const READ_ONLY_TOOLS = [
    "read_file",
    "list_files",
    "search_files",
    "grep",
    "find_symbol",
] as const;

export function createAgentTools(session: AgentSession, repoMap: RepoMap) {
    const { executor, ui } = session;

    return {
        read_file: tool({
            description:
                "Read a text file from the workspace with line numbers. Path is relative to the project root. " +
                "Shows your staged edits. For long files pass offset/limit to read a window. " +
                "You must read a file before you edit it.",
            inputSchema: z.object({
                path: z.string().describe("Relative file path"),
                offset: z.number().int().min(1).optional().describe("First line to read (1-based)"),
                limit: z.number().int().min(1).optional().describe("How many lines to read (default 2000)"),
            }),
            execute: async ({ path: p, offset, limit }) =>
                executor.readFile(p, offset, limit),
        }),

        edit_file: tool({
            description:
                "Replace one exact piece of text in an existing file. Preferred way to change code. " +
                "old_string must be copied from the file (without the line-number prefix) and must be unique; " +
                "include a few surrounding lines if needed. The change is staged until the user approves it.",
            inputSchema: z.object({
                path: z.string(),
                old_string: z.string().describe("Exact text to replace"),
                new_string: z.string().describe("Text to put in its place"),
                replace_all: z.boolean().optional().describe("Replace every occurrence"),
            }),
            execute: async ({ path: p, old_string, new_string, replace_all }) =>
                executor.editFile(p, old_string, new_string, replace_all),
        }),

        create_file: tool({
            description:
                "Stage creation of a new file (not written until the user approves).",
            inputSchema: z.object({
                path: z.string(),
                content: z.string(),
            }),
            execute: async ({ path: p, content }) => executor.createFile(p, content),
        }),

        modify_file: tool({
            description:
                "Stage a full-file replacement for an existing file (pending approval). " +
                "Only for rewriting most of a file; use edit_file for normal changes.",
            inputSchema: z.object({
                path: z.string(),
                content: z.string().describe("Complete new file contents"),
            }),
            execute: async ({ path: p, content }) => executor.modifyFile(p, content),
        }),

        delete_file: tool({
            description: "Stage deletion of a file (pending approval).",
            inputSchema: z.object({
                path: z.string(),
            }),
            execute: async ({ path: p }) => executor.deleteFile(p),
        }),

        create_folder: tool({
            description:
                "Stage creation of a directory tree (pending approval). Uses mkdir -p on apply. " +
                "Not needed before create_file: parent folders are created automatically.",
            inputSchema: z.object({
                path: z.string().describe("Relative directory path"),
            }),
            execute: async ({ path: p }) => executor.createFolder(p),
        }),

        list_files: tool({
            description: "List files and directories under a path.",
            inputSchema: z.object({
                path: z.string(),
                recursive: z.boolean().optional().default(false),
            }),
            execute: async ({ path: p, recursive }) =>
                executor.listFiles(p, recursive),
        }),

        search_files: tool({
            description:
                'Find files by name with a glob pattern (e.g. "*.ts", "**/*.md"). To search inside files use grep.',
            inputSchema: z.object({
                root: z.string().describe("Directory to search, relative to root"),
                pattern: z
                    .string()
                    .describe("Glob-like pattern using * and ** (forward slashes)"),
                content_contains: z.string().optional(),
            }),
            execute: async ({ root, pattern, content_contains }) =>
                executor.searchFiles(root, pattern, content_contains),
        }),

        grep: tool({
            description:
                "Search file contents with a regular expression. Returns `path:line: text` rows (max 100). " +
                "Use it to find where something is defined or used before reading files.",
            inputSchema: z.object({
                pattern: z.string().describe("Regular expression (JavaScript syntax)"),
                path: z.string().optional().describe("Directory or file to search, default the whole project"),
                glob: z.string().optional().describe('Only search files matching this glob, e.g. "*.ts"'),
                ignore_case: z.boolean().optional(),
            }),
            execute: async ({ pattern, path: p, glob, ignore_case }) =>
                executor.grep(pattern, p || ".", glob, ignore_case),
        }),

        find_symbol: tool({
            description:
                "Find where a function, class, type or constant is declared and where it is used. " +
                "Faster and more precise than grep for a known name.",
            inputSchema: z.object({
                name: z.string().describe("Symbol name, e.g. runApprovalFlow"),
            }),
            execute: async ({ name }) => repoMap.findSymbol(name),
        }),

        run_command: tool({
            description:
                "Run a shell command in the project root now and get its output and exit code. " +
                "Use it to run tests, type-checks, builds, linters and git commands, and to verify your changes. " +
                "Staged edits are shown to the user and applied before the command runs. " +
                "Do not start long-running servers or interactive programs: the command has no stdin and a timeout.",
            inputSchema: z.object({
                command: z.string().describe("The command line to run"),
                timeout_seconds: z.number().int().min(1).max(600).optional().describe("Default 120"),
            }),
            execute: async ({ command, timeout_seconds }) => {
                if (session.mode === "plan" && !isReadOnlyCommand(session, command)) {
                    throw new Error(
                        "Plan mode is read-only: only read-only commands (git status, git diff, tests, type-check) can run.",
                    );
                }

                if (executor.hasStaged()) {
                    const result = await session.checkpoint();
                    if (result.rejected.length) {
                        return (
                            `Command not run. The user rejected your staged changes to: ${result.rejected.join(", ")}. ` +
                            "Those edits were discarded and the files are unchanged. " +
                            "Do not repeat the same edit; ask the user what they want instead if it is unclear."
                        );
                    }
                }

                if (!(await approveCommand(session, command))) {
                    return (
                        "The user declined to run this command. Do not retry it. " +
                        "Continue without it, or explain why it is needed."
                    );
                }

                ui.setPhase("Running");
                const result = await executor.runCommand(command, {
                    timeoutMs: (timeout_seconds ?? 120) * 1000,
                    signal: session.abortSignal,
                });

                const isCheck = session.config.checkCommands.includes(command.trim());
                if (isCheck && result.exitCode === 0) {
                    session.verifiedSeq = executor.editSeq;
                }

                const seconds = (result.durationMs / 1000).toFixed(1);
                const status = result.timedOut
                    ? `TIMED OUT after ${seconds}s`
                    : result.aborted
                        ? "stopped by the user"
                        : `exit code ${result.exitCode} (${seconds}s)`;
                return `${status}\n${executor.clip(result.output) || "(no output)"}`;
            },
        }),

        todo_write: tool({
            description:
                "Write or update your task plan. Use it for any work with 3 or more steps: write the plan first, " +
                "then call it again as you start and finish each item (exactly one item in_progress at a time). " +
                "Always send the full list.",
            inputSchema: z.object({
                todos: z
                    .array(
                        z.object({
                            content: z.string().describe("Short, concrete step"),
                            status: z.enum(["pending", "in_progress", "completed"]),
                        }),
                    )
                    .min(1),
            }),
            execute: async ({ todos }) => {
                session.todos = todos;
                ui.showTodos(todos);
                const done = todos.filter((t) => t.status === "completed").length;
                return `Plan saved (${done}/${todos.length} done).`;
            },
        }),

        ask_user: tool({
            description:
                "Ask the user one question and wait for the answer. Use it when the request is ambiguous " +
                "or a decision is truly theirs. Do not use it for things you can find out by reading the code.",
            inputSchema: z.object({
                question: z.string(),
                options: z
                    .array(z.string())
                    .max(4)
                    .optional()
                    .describe("Up to 4 suggested answers; the user can always type their own"),
            }),
            execute: async ({ question, options }) => {
                if (!process.stdin.isTTY) {
                    return "No interactive user is available. Choose the most reasonable option yourself and state the assumption.";
                }
                return ui.withPrompt(async () => {
                    if (options?.length) {
                        const picked = await select({
                            message: question,
                            options: [
                                ...options.map((o) => ({ value: o, label: o })),
                                { value: "__other__", label: "Other (type an answer)" },
                            ],
                        });
                        if (isCancel(picked)) return "The user skipped the question.";
                        if (picked !== "__other__") return `User answered: ${String(picked)}`;
                    }
                    const typed = await text({ message: question });
                    if (isCancel(typed) || !String(typed ?? "").trim()) {
                        return "The user skipped the question.";
                    }
                    return `User answered: ${String(typed).trim()}`;
                });
            },
        }),

        remember: tool({
            description:
                "Save one durable fact about this project for future sessions: how to run tests or builds, " +
                "a convention, or a correction the user gave you. Not for things that only matter in this task.",
            inputSchema: z.object({
                fact: z.string().describe("One self-contained sentence"),
            }),
            execute: async ({ fact }) => remember(session.config.codebasePath, fact),
        }),

        list_skills: tool({
            description:
                "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
            inputSchema: z.object({}),
            execute: async () => executor.listSkills(),
        }),

        read_skill: tool({
            description:
                "Read a SKILL.md file. Path must be absolute and under skill roots, or use a path returned by list_skills.",
            inputSchema: z.object({
                path: z.string(),
            }),
            execute: async ({ path: p }) => executor.readSkill(p),
        }),
    }
}

export type BaseTools = ReturnType<typeof createAgentTools>;
