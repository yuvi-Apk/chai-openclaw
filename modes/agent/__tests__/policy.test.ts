import { describe, expect, test } from "bun:test";
import { ActionTracker } from "../action-tracker";
import { commandPrefix, groupPending, isReadOnlyCommand, runApprovalFlow } from "../approval";
import { triageByKeywords } from "../brain";
import { mentionAtEnd, rankPaths } from "../input";
import { buildSystemPrompt } from "../prompt";
import { defaultAgentConfig, type AgentSession } from "../types";
import { captureOutput } from "./helpers";

/** Only the parts of a session these functions look at. */
const sessionWith = (checkCommands: string[] = [], mode: AgentSession["mode"] = "ask") =>
    ({ mode, config: { ...defaultAgentConfig(), checkCommands, codebasePath: process.cwd() } }) as AgentSession;

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

    test("auto-approve accepts everything and still shows the changes", async () => {
        const tracker = staged();
        let approved = false;
        const screen = await captureOutput(async () => {
            approved = await runApprovalFlow(tracker, { autoApprove: true });
        });
        expect(approved).toBe(true);
        expect(tracker.getActions().every((a) => a.status === "approved")).toBe(true);
        expect(screen).toContain("yuvi wants to make 3 changes. Nothing is saved yet:");
        expect(screen).toContain("▌ a.ts (file_create)");
    });

    test("without a terminal everything is rejected", async () => {
        const tracker = staged();
        let approved = true;
        const screen = await captureOutput(async () => {
            approved = await runApprovalFlow(tracker);
        });
        expect(approved).toBe(false);
        expect(tracker.getActions().every((a) => a.status === "rejected")).toBe(true);
        expect(screen).toContain("No interactive terminal: staged changes were not applied.");
    });

    test("nothing pending means nothing to approve", async () => {
        expect(await runApprovalFlow(new ActionTracker())).toBe(false);
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

describe("input box helpers", () => {
    test("an @mention at the end of the line is found", () => {
        expect(mentionAtEnd("look at @src/a")).toEqual({ start: 9, query: "src/a" });
        expect(mentionAtEnd("@")).toEqual({ start: 1, query: "" });
        expect(mentionAtEnd("mail me@host")).toBeNull();
        expect(mentionAtEnd("@done then more")).toBeNull();
    });

    test("paths are ranked: prefix, file name, contains, letters in order", () => {
        const paths = ["modes/", "modes/agent/orchestrator.ts", "modes/agent/ui.ts", "index.ts", "docs/index.md"];
        expect(rankPaths(paths, "")).toEqual(["index.ts", "docs/index.md", "modes/", "modes/agent/orchestrator.ts", "modes/agent/ui.ts"]);
        expect(rankPaths(paths, "index")).toEqual(["index.ts", "docs/index.md"]);
        expect(rankPaths(paths, "orch")).toEqual(["modes/agent/orchestrator.ts"]);
        expect(rankPaths(paths, "mui")).toEqual(["modes/agent/ui.ts"]);
        expect(rankPaths(paths, "zzz")).toEqual([]);
    });
});
