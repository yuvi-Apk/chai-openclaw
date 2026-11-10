import {
    experimental_createSteering,
    generateText,
    stepCountIs,
    ToolLoopAgent,
    type ModelMessage,
    type ToolSet,
} from "ai";
import chalk from "chalk";
import { getAgentModel, getReasoningOverride, type ReasoningEffort } from "../../ai";
import type { AgentSession } from "./types";
import type { RepoMap } from "./repo-map";
import { EDIT_TOOLS, type BaseTools } from "./agent-tools";
import { runSubagent } from "./subagents";
import { buildSystemPrompt, type TaskKind } from "./prompt";
import {
    loadMemory,
    loadProjectInstructions,
    loadSkillsIndex,
    pruneToolOutputs,
    saveSession,
    summarizeHistory,
} from "./memory";
import { errorText, type StreamPartLike } from "./ui";

interface TaskProfile {
    kind: TaskKind;
    effort: ReasoningEffort;
    maxSteps: number;
    requirePlan: boolean;
    /** Run the self-review and verification gates for this kind of task. */
    gates: boolean;
}

const PROFILES: Record<TaskKind, TaskProfile> = {
    question: { kind: "question", effort: "low", maxSteps: 30, requirePlan: false, gates: false },
    small_change: { kind: "small_change", effort: "medium", maxSteps: 40, requirePlan: false, gates: true },
    feature: { kind: "feature", effort: "high", maxSteps: 80, requirePlan: true, gates: true },
    debug: { kind: "debug", effort: "high", maxSteps: 60, requirePlan: false, gates: true },
    refactor: { kind: "refactor", effort: "high", maxSteps: 80, requirePlan: true, gates: true },
};

const MAX_REPAIR_ROUNDS = 3;
const COMPACT_AT = 0.7;

export interface BrainContext {
    repoMap: RepoMap;
    baseTools: BaseTools;
    /** Base tools plus the task tool. */
    tools: ToolSet;
}

// ---------- triage ----------

function triageByKeywords(text: string): TaskKind {
    const t = text.toLowerCase();
    if (/\b(refactor|restructure|reorgani[sz]e|migrate|rename .* (across|everywhere))\b/.test(t))
        return "refactor";
    if (/\b(bug|error|fix|crash|fail(s|ing|ed)?|broken|not working|doesn'?t work|wrong)\b/.test(t))
        return "debug";
    if (/\b(add|implement|create|build|make|write|update|change|remove|delete|support|integrate)\b/.test(t))
        return t.length > 140 ? "feature" : "small_change";
    return "question";
}

/** Decide what kind of task this is, so effort and gates fit the request. */
async function triage(text: string, signal: AbortSignal): Promise<TaskKind> {
    if ((process.env.YUVI_TRIAGE || "").toLowerCase() === "off") {
        return triageByKeywords(text);
    }
    try {
        const result = await generateText({
            model: getAgentModel("fast"),
            abortSignal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
            prompt:
                "Classify this request to a coding agent. Reply with exactly one word.\n" +
                "question     - wants an explanation or information; no code change\n" +
                "small_change - a small, local code change (one or two files)\n" +
                "feature      - new behaviour that needs several steps or files\n" +
                "debug        - something is broken and must be found and fixed\n" +
                "refactor     - restructure existing code without changing behaviour\n\n" +
                `Request: ${text.slice(0, 2000)}`,
        });
        const answer = result.text.toLowerCase();
        const kinds: TaskKind[] = ["small_change", "question", "feature", "debug", "refactor"];
        const found = kinds.find((k) => answer.includes(k) || answer.includes(k.replace("_", " ")));
        return found ?? triageByKeywords(text);
    } catch {
        return triageByKeywords(text);
    }
}

// ---------- one model loop ----------

type LoopOutcome = "done" | "aborted" | "error";

interface LoopState {
    profile: TaskProfile;
    instructions: string;
    controller: AbortController;
    steps: number;
    turnTokens: number;
    /** Messages typed by the user while no loop was running yet. */
    queuedSteers: string[];
}

/** Run the agent until it stops calling tools, streaming everything to the UI. */
async function runLoop(
    session: AgentSession,
    ctx: BrainContext,
    state: LoopState,
    input: string,
): Promise<LoopOutcome> {
    const { ui, config } = session;
    session.messages.push({ role: "user", content: input });

    const steering = experimental_createSteering();
    ui.onSteer = (text) => void steering.steer(text);
    for (const text of state.queuedSteers.splice(0)) void steering.steer(text);

    // What the model was last sent; used to rebuild history after the run.
    let snapshot: { messages: ModelMessage[]; responseCount: number } = {
        messages: session.messages,
        responseCount: 0,
    };

    const allToolNames = Object.keys(ctx.tools);
    const withoutEdits = allToolNames.filter(
        (name) => !(EDIT_TOOLS as readonly string[]).includes(name),
    );
    const reasoningOverride = getReasoningOverride();
    const reasoning =
        reasoningOverride === "off" ? undefined : (reasoningOverride ?? state.profile.effort);

    const agent = new ToolLoopAgent({
        model: getAgentModel("main"),
        instructions: state.instructions,
        tools: ctx.tools,
        stopWhen: stepCountIs(state.profile.maxSteps),
        ...(reasoning ? { reasoning } : {}),
        prepareStep: ({ messages, responseMessages }) => {
            let next = messages;
            let overridden = false;

            // Context getting full: drop bulky old tool results first.
            const used = session.usage.lastInputTokens;
            if (used > config.contextWindow * COMPACT_AT) {
                const pruned = pruneToolOutputs(messages);
                if (pruned.pruned > 0) {
                    next = pruned.messages;
                    overridden = true;
                    session.usage.lastInputTokens = 0;
                    ui.note(
                        `Context ${Math.round((used / config.contextWindow) * 100)}% full: trimmed ${pruned.pruned} old tool results.`,
                    );
                }
            }
            snapshot = { messages: next, responseCount: responseMessages.length };

            // Plan gate: no editing in plan mode, or before a plan exists.
            const locked =
                session.mode === "plan" ||
                (state.profile.requirePlan && session.todos.length === 0);

            return {
                ...(overridden ? { messages: next } : {}),
                ...(locked ? { activeTools: withoutEdits } : {}),
            };
        },
    });

    // Loop guard state.
    let lastCall = "";
    let sameCallCount = 0;
    let lastError = "";
    let failed: string | undefined;

    try {
        const result = await agent.stream({
            messages: session.messages,
            abortSignal: state.controller.signal,
            experimental_steering: steering,
        });

        for await (const raw of result.stream) {
            const part = raw as unknown as StreamPartLike & {
                usage?: { inputTokens?: number; outputTokens?: number };
                providerMetadata?: Record<string, Record<string, unknown>>;
            };
            ui.handlePart(part);

            if (part.type === "start-step") state.steps++;

            if (part.type === "tool-call") {
                const signature = `${part.toolName}:${JSON.stringify(part.input)}`;
                sameCallCount = signature === lastCall ? sameCallCount + 1 : 1;
                lastCall = signature;
                if (sameCallCount === 3) {
                    sameCallCount = 0;
                    ui.note("Loop guard: the same tool call was repeated 3 times. Telling the agent to change approach.");
                    void steering.steer(
                        "[harness] You have made the exact same tool call 3 times. It is not giving you new information. " +
                        "Stop, state in one sentence what you know and what is blocking you, then take a DIFFERENT approach.",
                    );
                }
            }

            if (part.type === "tool-error") {
                const message = errorText(part.error).slice(0, 300);
                if (message === lastError) {
                    lastError = "";
                    ui.note("Loop guard: the same error happened twice. Telling the agent to change approach.");
                    void steering.steer(
                        "[harness] The same tool error happened twice in a row. Do not retry that call. " +
                        "Read the error carefully, check your assumption (does the file or text really exist? read it again), and try another way.",
                    );
                } else {
                    lastError = message;
                }
            } else if (part.type === "tool-result") {
                lastError = "";
            }

            if (part.type === "finish-step") {
                const input = part.usage?.inputTokens ?? 0;
                const output = part.usage?.outputTokens ?? 0;
                session.usage.inputTokens += input;
                session.usage.outputTokens += output;
                session.usage.lastInputTokens = input;
                state.turnTokens += input + output;
                const cost = (part.providerMetadata?.openrouter?.usage as { cost?: number } | undefined)?.cost;
                if (typeof cost === "number") session.usage.cost += cost;
            }

            if (part.type === "error") failed = errorText(part.error);
        }

        const responses = await result.responseMessages;
        session.messages = [
            ...snapshot.messages,
            ...(responses.slice(snapshot.responseCount) as ModelMessage[]),
        ];
    } catch (error) {
        if (!state.controller.signal.aborted && !failed) failed = errorText(error);
    } finally {
        ui.onSteer = (text) => state.queuedSteers.push(text);
    }

    if (state.controller.signal.aborted) {
        session.messages = [
            ...snapshot.messages,
            { role: "assistant", content: "(The user interrupted this run before it finished.)" },
        ];
        return "aborted";
    }

    if (failed) {
        ui.failure(`Model call failed: ${failed.slice(0, 400)}`);
        session.messages = [
            ...snapshot.messages,
            { role: "assistant", content: `(The run failed with an error: ${failed.slice(0, 300)})` },
        ];
        return "error";
    }

    return "done";
}

// ---------- gates ----------

function changedLineCount(diff: string): number {
    return diff
        .split("\n")
        .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).length;
}

/** A reviewer with fresh context reads the diff. Returns findings, or "" when clean. */
async function selfReview(
    session: AgentSession,
    ctx: BrainContext,
    request: string,
): Promise<string> {
    const { ui, executor } = session;
    const diff = executor.turnDiff();
    if (changedLineCount(diff) < 8) return "";

    ui.setPhase("Reviewing");
    ui.print(`${chalk.cyan("●")} ${chalk.bold("Self-review")} a reviewer with fresh context checks the diff`);
    try {
        const report = await runSubagent(session, ctx.baseTools, {
            type: "reviewer",
            prompt:
                `The user asked:\n${request}\n\n` +
                `This diff was written for it (not yet shown to the user):\n\n${executor.clip(diff, 30_000)}`,
        });
        if (/^\s*LGTM\b/i.test(report) || report.includes("stopped without a report")) {
            ui.success("Self-review: no problems found.");
            return "";
        }
        ui.print(chalk.yellow("  Reviewer findings:"));
        ui.print(chalk.dim(report.split("\n").map((l) => `  │ ${l}`).join("\n")));
        return report;
    } catch (error) {
        if (!session.abortSignal?.aborted) {
            ui.note(`Self-review skipped: ${errorText(error).slice(0, 200)}`);
        }
        return "";
    }
}

/** Run the project's check commands. Returns a failure report, or "" when all pass. */
async function runChecks(session: AgentSession): Promise<string> {
    const { ui, executor, config } = session;
    ui.setPhase("Verifying");
    const failures: string[] = [];

    for (const command of config.checkCommands) {
        ui.print(`${chalk.cyan("●")} ${chalk.bold("Verify")} ${command}`);
        const result = await executor.runCommand(command, {
            timeoutMs: 180_000,
            signal: session.abortSignal,
        });
        if (result.aborted) return "";
        const seconds = (result.durationMs / 1000).toFixed(1);
        if (result.exitCode === 0) {
            ui.print(chalk.dim(`  ⎿ passed (${seconds}s)`));
            continue;
        }
        const status = result.timedOut ? "timed out" : `exit code ${result.exitCode}`;
        ui.print(chalk.red(`  ⎿ failed: ${status} (${seconds}s)`));
        failures.push(`$ ${command}\n${status}\n${executor.clip(result.output, 6000) || "(no output)"}`);
    }

    if (!failures.length) {
        session.verifiedSeq = executor.editSeq;
        ui.success(`Verified: ${config.checkCommands.join(", ")}`);
    }
    return failures.join("\n\n");
}

// ---------- the turn ----------

/**
 * One user turn, run the way a careful engineer works: size up the task,
 * work on it, have the result reviewed, apply it, verify it, and repair it
 * when verification fails.
 */
export async function runTurn(
    session: AgentSession,
    ctx: BrainContext,
    userText: string,
): Promise<void> {
    const { ui, executor, config } = session;
    const controller = new AbortController();
    session.abortSignal = controller.signal;
    executor.beginTurn();

    const state: LoopState = {
        profile: PROFILES.small_change,
        instructions: "",
        controller,
        steps: 0,
        turnTokens: 0,
        queuedSteers: [],
    };

    ui.onAbort = () => {
        if (!controller.signal.aborted) {
            ui.note("Stopping…");
            controller.abort();
        }
    };
    ui.onSteer = (text) => state.queuedSteers.push(text);
    ui.startRun(session.usage, config.contextWindow);

    try {
        // 1. Triage.
        ui.setPhase("Sizing up the task");
        const kind = session.mode === "plan" ? "feature" : await triage(userText, controller.signal);
        if (controller.signal.aborted) return;
        state.profile = PROFILES[kind];
        ui.print(
            chalk.dim(
                `  ◇ ${kind.replace("_", " ")} · effort ${state.profile.effort}` +
                (state.profile.requirePlan && session.mode !== "plan" ? " · plan first" : "") +
                (session.mode !== "ask" ? ` · ${session.mode} mode` : ""),
            ),
        );
        // A new task starts with an empty plan, so the plan gate applies to it.
        if (state.profile.requirePlan) session.todos = [];

        // 2. Long conversation: summarise the older part before starting.
        if (session.usage.lastInputTokens > config.contextWindow * COMPACT_AT) {
            await compactHistory(session);
        }

        ctx.repoMap.build();
        state.instructions = buildSystemPrompt(session, {
            kind,
            requirePlan: state.profile.requirePlan,
            repoMap: ctx.repoMap.render(),
            memory: loadMemory(config.codebasePath),
            projectInstructions: loadProjectInstructions(config.codebasePath),
            skills: loadSkillsIndex(executor),
        });

        // 3. Work, then gates. Each gate can send the agent back to work.
        let input = userText;
        let reviewed = false;
        let repairRounds = 0;

        while (true) {
            const outcome = await runLoop(session, ctx, state, input);
            if (outcome !== "done") break;

            const gated = state.profile.gates && session.mode !== "plan";

            // Self-review, once per turn, before the user sees the changes.
            if (
                gated &&
                !reviewed &&
                (process.env.YUVI_SELF_REVIEW || "").toLowerCase() !== "off" &&
                executor.turnChangedPaths().length > 0
            ) {
                reviewed = true;
                const findings = await selfReview(session, ctx, userText);
                if (controller.signal.aborted) break;
                if (findings) {
                    input =
                        "[harness] Before the user sees your changes, an independent reviewer read your diff and reported:\n\n" +
                        `${findings}\n\n` +
                        "Fix every point that is a real problem. If a point is wrong, say why in one line and leave the code as it is. " +
                        "Then give your final report.";
                    continue;
                }
            }

            // Show the staged edits to the user and write the approved ones.
            const applied = await session.checkpoint();
            if (applied.rejected.length) {
                session.messages.push({
                    role: "user",
                    content: `[harness] The user rejected your changes to: ${applied.rejected.join(", ")}. Those files are unchanged.`,
                });
            }
            if (controller.signal.aborted) break;

            // Verification: edits on disk that no check has covered yet.
            const needsVerify =
                gated &&
                config.checkCommands.length > 0 &&
                executor.editSeq > session.verifiedSeq &&
                executor.turnChangedPaths().length > 0;
            if (!needsVerify) break;

            const failure = await runChecks(session);
            if (controller.signal.aborted) break;
            if (!failure) {
                session.messages.push({
                    role: "user",
                    content: `[harness] Project checks passed after your change: ${config.checkCommands.join(", ")}.`,
                });
                break;
            }
            if (repairRounds >= MAX_REPAIR_ROUNDS) {
                ui.failure(
                    `Checks still fail after ${MAX_REPAIR_ROUNDS} repair rounds. The changes are on disk; use /undo to roll back the last apply.`,
                );
                session.messages.push({
                    role: "user",
                    content: `[harness] Checks still failing after ${MAX_REPAIR_ROUNDS} repair rounds:\n\n${failure}`,
                });
                break;
            }
            repairRounds++;
            ui.note(`Verification failed. Sending the errors back to the agent (repair round ${repairRounds}/${MAX_REPAIR_ROUNDS}).`);
            input =
                "[harness] I ran the project checks after your change and they FAILED:\n\n" +
                `${failure}\n\n` +
                "Fix the failures your change caused, then finish. " +
                "If a failure clearly existed before your change and is unrelated to it, do not fix it: say so in your report.";
        }

        if (controller.signal.aborted) {
            ui.note("Stopped. Staged changes that were not applied are kept for review on the next turn.");
        }
        ui.turnSummary(session.usage, state.turnTokens, state.steps);
    } finally {
        ui.endRun();
        ui.onAbort = undefined;
        ui.onSteer = undefined;
        session.abortSignal = undefined;
        saveSession(config.codebasePath, session.messages);
    }
}

/** Replace the older part of the conversation with a summary. */
export async function compactHistory(session: AgentSession): Promise<boolean> {
    const { ui } = session;
    const before = session.messages.length;
    ui.setPhase("Compacting");
    try {
        const pruned = pruneToolOutputs(session.messages, 6);
        const next = await summarizeHistory(
            pruned.messages,
            getAgentModel("fast"),
            session.abortSignal,
        );
        session.messages = next;
        session.usage.lastInputTokens = 0;
        const changed = next.length !== before || pruned.pruned > 0;
        if (changed) {
            ui.note(`Compacted the conversation: ${before} → ${next.length} messages.`);
        }
        return changed;
    } catch (error) {
        ui.note(`Could not compact the conversation: ${errorText(error).slice(0, 200)}`);
        return false;
    }
}
