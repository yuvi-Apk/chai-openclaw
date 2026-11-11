import { describe, expect, test } from "bun:test";
import { ActionTracker } from "../action-tracker";
import { createRecordingHost, testSettings } from "../../../core/testing";
import { approveCommand, commandPrefix, groupPending, isReadOnlyCommand, runApprovalFlow } from "../approval";
import { triageByKeywords } from "../brain";
import { buildSystemPrompt } from "../prompt";
import { loadAgentConfig, type AgentSession } from "../types";

/** Only the parts of a session these functions look at. */
const sessionWith = (checkCommands: string[] = [], mode: AgentSession["mode"] = "ask") =>
    ({ mode, config: { ...loadAgentConfig(testSettings(), process.cwd()), checkCommands } }) as AgentSession;

describe("read-only commands", () => {
    const session = sessionWith(["bun run check"]);

    test("known read-only commands pass", () => {
        for (const command of ["git status", "git diff HEAD~1", "bun test", "bunx tsc --noEmit", "ls", "  pwd  "]) {
            expect(isReadOnlyCommand(session, command)).toBe(true);
        }
    });

    test("the project's own check commands pass", () => {
        expect(isReadOnlyCommand(session, "bun run check")).toBe(true);
    });

    test("anything else, and anything chained, does not", () => {
        for (const command of [
            "rm -rf src",
            "git push",
            "bun add left-pad",
            "git status; rm -rf src",
            "git status && rm x",
            "git log | sh",
            "ls > out.txt",
            "git status $(rm x)",
            "lsblk",
        ]) {
            expect(isReadOnlyCommand(session, command)).toBe(false);
        }
    });

    test("the remembered prefix is the first one or two words", () => {
        expect(commandPrefix("bun add left-pad")).toBe("bun add");
        expect(commandPrefix("mkdir -p a/b")).toBe("mkdir");
        expect(commandPrefix("  git   push origin")).toBe("git push");
        expect(commandPrefix("ls")).toBe("ls");
    });
});

describe("approval", () => {
    const staged = () => {
        const tracker = new ActionTracker();
        tracker.log({ type: "file_modify", path: "b.ts", details: { before: "1\n", after: "2\n" } });
        tracker.log({ type: "file_create", path: "a.ts", details: { after: "new\n" } });
        tracker.log({ type: "folder_create", path: "lib", details: { after: "lib" } });
        return tracker;
    };

    test("pending changes are grouped per path, sorted, with a diff", () => {
        const groups = groupPending(staged().getPendingMutations());
        expect(groups.map((g) => g.label)).toEqual([
            "a.ts (file_create)",
            "b.ts (file_modify)",
            "Create folder: lib",
        ]);
        expect(groups[1]!.patch).toContain("-1");
        expect(groups[1]!.patch).toContain("+2");
        expect(groups[2]!.patch).toBeNull();
    });

    test("auto-approve is passed on to the front end, which shows the changes", async () => {
        const tracker = staged();
        const host = createRecordingHost();
        expect(await runApprovalFlow(tracker, host, { autoApprove: true })).toBe(true);
        expect(tracker.getActions().every((a) => a.status === "approved")).toBe(true);
        expect(host.confirmations).toEqual([
            {
                kind: "changes",
                auto: true,
                groups: [
                    { id: "0", label: "a.ts (file_create)", patch: expect.stringContaining("+new") },
                    { id: "1", label: "b.ts (file_modify)", patch: expect.stringContaining("+2") },
                    { id: "2", label: "Create folder: lib", patch: null },
                ],
            },
        ]);
    });

    test("only the accepted changes are approved; the rest are rejected", async () => {
        const tracker = staged();
        const host = createRecordingHost({ confirm: () => ({ approved: ["1"] }) });
        expect(await runApprovalFlow(tracker, host)).toBe(true);
        const status = Object.fromEntries(tracker.getActions().map((a) => [a.path, a.status]));
        expect(status).toEqual({ "a.ts": "rejected", "b.ts": "approved", lib: "rejected" });
    });

    test("when nothing is accepted everything is rejected", async () => {
        const tracker = staged();
        const host = createRecordingHost({ confirm: () => ({ approved: [] }) });
        expect(await runApprovalFlow(tracker, host)).toBe(false);
        expect(tracker.getActions().every((a) => a.status === "rejected")).toBe(true);
    });

    test("nothing pending means nothing to approve", async () => {
        const host = createRecordingHost();
        expect(await runApprovalFlow(new ActionTracker(), host)).toBe(false);
        expect(host.confirmations).toEqual([]);
    });
});

describe("command approval", () => {
    const session = (host: ReturnType<typeof createRecordingHost>) =>
        ({ ...sessionWith(["bun run check"]), host, allowedCommands: new Set<string>() }) as AgentSession;

    test("read-only commands run without asking", async () => {
        const host = createRecordingHost();
        expect(await approveCommand(session(host), "git status")).toBe(true);
        expect(host.confirmations).toEqual([]);
    });

    test("other commands ask, and 'don't ask again' is remembered by prefix", async () => {
        const host = createRecordingHost({ confirm: () => ({ approved: ["run"], remember: true }) });
        const s = session(host);
        expect(await approveCommand(s, "bun add left-pad")).toBe(true);
        expect(host.confirmations).toEqual([{ kind: "command", command: "bun add left-pad", rememberAs: "bun add" }]);
        expect(await approveCommand(s, "bun add zod")).toBe(true);
        expect(host.confirmations).toHaveLength(1);
    });

    test("a chained command always asks and cannot be remembered", async () => {
        const host = createRecordingHost();
        const s = session(host);
        s.allowedCommands.add("git push");
        expect(await approveCommand(s, "git push && rm -rf x")).toBe(true);
        expect(host.confirmations).toEqual([{ kind: "command", command: "git push && rm -rf x" }]);
    });

    test("a refusal, or nobody to ask, means no", async () => {
        expect(await approveCommand(session(createRecordingHost({ confirm: () => ({ approved: [] }) })), "rm x")).toBe(false);
        const unattended = createRecordingHost({ interactive: false });
        expect(await approveCommand(session(unattended), "rm x")).toBe(false);
        expect(unattended.confirmations).toEqual([]);
    });
});

describe("triage by keywords", () => {
    test("each kind of request is recognised", () => {
        expect(triageByKeywords("what does this project do?")).toBe("question");
        expect(triageByKeywords("add a clear button")).toBe("small_change");
        expect(triageByKeywords("the login crashes with an error")).toBe("debug");
        expect(triageByKeywords("refactor the config loading")).toBe("refactor");
        expect(triageByKeywords(`implement ${"a very detailed ".repeat(12)}feature`)).toBe("feature");
    });
});

describe("system prompt", () => {
    const context = { kind: "feature" as const, requirePlan: true, repoMap: "src/a.ts (3 lines)", memory: "", projectInstructions: "", skills: "" };

    test("it carries the mode, the task kind and the project facts", () => {
        const prompt = buildSystemPrompt(sessionWith(["bun test"]), context);
        expect(prompt).toContain("You are yuvi, a senior software engineer");
        expect(prompt).toContain("This turn is a FEATURE.");
        expect(prompt).toContain("Edit tools stay locked until you have written a plan with todo_write.");
        expect(prompt).toContain("ASK MODE: the user approves edits and commands.");
        expect(prompt).toContain("Project checks (run these to verify changes): bun test");
        expect(prompt).toContain("# Repo map");
        expect(prompt).not.toContain("# Project memory");
    });

    test("plan mode is read-only", () => {
        const prompt = buildSystemPrompt(sessionWith([], "plan"), context);
        expect(prompt).toContain("PLAN MODE: read-only.");
        expect(prompt).not.toContain("Edit tools stay locked");
    });
});

