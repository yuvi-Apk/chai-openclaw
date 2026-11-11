import { stepCountIs, tool, ToolLoopAgent, type ToolSet } from "ai";
import z from "zod";
import { readCost } from "../../core/usage";
import type { AgentSession } from "./types";
import { EDIT_TOOLS, READ_ONLY_TOOLS, type BaseTools } from "./agent-tools";
import { describeToolCall } from "./output";

export type SubagentType = "explorer" | "planner" | "reviewer" | "worker";

interface SubagentProfile {
    role: "main" | "fast";
    tools: readonly string[];
    maxSteps: number;
    instructions: string;
}

const PROFILES: Record<SubagentType, SubagentProfile> = {
    explorer: {
        role: "fast",
        tools: READ_ONLY_TOOLS,
        maxSteps: 25,
        instructions: [
            "You are an explorer sub-agent inside a coding agent. You answer ONE question about this codebase.",
            "You can only read: use grep, find_symbol, list_files and read_file. You cannot change anything.",
            "Work quickly: search first, then read only the parts that matter.",
            "Finish with a compact report: the direct answer, then the evidence as `path:line` references,",
            "then anything surprising you noticed. Do not paste whole files. State clearly what you could not find.",
        ].join("\n"),
    },
    planner: {
        role: "main",
        tools: READ_ONLY_TOOLS,
        maxSteps: 30,
        instructions: [
            "You are a planning sub-agent inside a coding agent. You design how to implement a change; you do not implement it.",
            "Read the relevant code first. Reuse what already exists instead of inventing new structure.",
            "Finish with a numbered plan. Each step names the file, the function, and the exact change.",
            "List risks and how to verify the result (which command, which behaviour). Keep it short and concrete.",
        ].join("\n"),
    },
    reviewer: {
        role: "main",
        tools: READ_ONLY_TOOLS,
        maxSteps: 20,
        instructions: [
            "You are a code reviewer with fresh eyes. You get a user request and the diff that was written for it.",
            "Find real problems only: bugs, broken callers, missed parts of the request, changes unrelated to the request,",
            "wrong edge cases, code that will not compile. Read surrounding code when you need to confirm something.",
            "Do not comment on style or taste. Do not suggest extra features.",
            "If the diff is correct and complete, reply with exactly: LGTM",
            "Otherwise reply with a numbered list. Each item: `path:line` — what is wrong — how to fix it.",
        ].join("\n"),
    },
    worker: {
        role: "main",
        tools: [...READ_ONLY_TOOLS, ...EDIT_TOOLS],
        maxSteps: 40,
        instructions: [
            "You are a worker sub-agent inside a coding agent. You carry out ONE well-defined piece of a larger plan.",
            "Read each file before you edit it. Make small, exact edits with edit_file. Follow the existing code style.",
            "Stay inside your assignment: do not touch unrelated code. Your edits are staged for the user to review.",
            "You cannot run commands; the main agent verifies the result.",
            "Finish with a short report: what you changed (`path` and what), and anything the main agent must still do.",
        ].join("\n"),
    },
};

let subagentCounter = 0;

/** Run one sub-agent with its own context and return only its final report. */
export async function runSubagent(
    session: AgentSession,
    baseTools: BaseTools,
    options: {
        type: SubagentType;
        prompt: string;
        abortSignal?: AbortSignal;
    },
): Promise<string> {
    const profile = PROFILES[options.type];
    const tag = `${options.type}#${++subagentCounter}`;
    const available = baseTools as unknown as Record<string, ToolSet[string]>;
    const tools: ToolSet = {};
    for (const name of profile.tools) {
        const t = available[name];
        if (t) tools[name] = t;
    }

    const agent = new ToolLoopAgent({
        model: session.core.models.forRole(profile.role),
        instructions: `${profile.instructions}\n\nWorkspace root: ${session.config.codebasePath}. All paths are relative to it.`,
        tools,
        stopWhen: stepCountIs(profile.maxSteps),
    });

    let lastText = "";
    const result = await agent.generate({
        prompt: options.prompt,
        abortSignal: options.abortSignal ?? session.abortSignal,
        onStepFinish: ({ toolCalls, text, usage, providerMetadata }) => {
            if (text?.trim()) lastText = text;
            session.usage.inputTokens += usage?.inputTokens ?? 0;
            session.usage.outputTokens += usage?.outputTokens ?? 0;
            session.usage.cost += readCost(providerMetadata);
            for (const call of toolCalls) {
                const d = describeToolCall(String(call.toolName), call.input);
                session.ui.subLine(tag, `${d.verb} ${d.detail}`.trim());
            }
        },
    });

    const report = (result.text || lastText).trim();
    if (!report) {
        return `The ${options.type} sub-agent stopped without a report (step limit reached). Do the work yourself or retry with a narrower task.`;
    }
    return session.executor.clip(report, 8000);
}

/** The `task` tool: lets the main agent delegate work to a sub-agent. */
export function createTaskTool(session: AgentSession, baseTools: BaseTools) {
    return tool({
        description: [
            "Start a sub-agent with its own fresh context. Only its final report comes back to you, so your context stays small.",
            "Call it several times in ONE step to run sub-agents in parallel.",
            "Types:",
            "- explorer: read-only; answers one question about the code (where is X, how does Y work, what uses Z).",
            "- planner: read-only; designs a step-by-step implementation plan for a large change.",
            "- reviewer: read-only; reviews a diff or a piece of code for bugs.",
            "- worker: can edit files; carries out one independent, well-specified part of a plan.",
            "Use it for broad exploration or independent parts of a big task. Do NOT use it for a quick lookup you can do with one grep or read.",
            "The sub-agent knows nothing about this conversation: put everything it needs in the prompt.",
        ].join("\n"),
        inputSchema: z.object({
            type: z.enum(["explorer", "planner", "reviewer", "worker"]),
            description: z.string().describe("3-6 words shown to the user"),
            prompt: z
                .string()
                .describe("Complete, self-contained instructions and what to report back"),
        }),
        execute: async ({ type, prompt }, { abortSignal }) => {
            if (type === "worker" && session.mode === "plan") {
                throw new Error("Plan mode is read-only: worker sub-agents cannot run.");
            }
            return runSubagent(session, baseTools, { type, prompt, abortSignal });
        },
    });
}
