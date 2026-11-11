import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { approveAll, makeWorkspace, type Workspace } from "./helpers";

let ws: Workspace;

beforeEach(() => {
    ws = makeWorkspace({
        "src/app.ts": "export const a = 1;\nexport function hello() {\n    return a;\n}\n",
        "src/util.ts": "export const b = 2;\n",
        "notes.md": "# Notes\nhello world\n",
        ".env": "SECRET=1\n",
        "node_modules/pkg/index.js": "module.exports = 1;\n",
        "debug.log": "noise\n",
    });
});

afterEach(() => ws.cleanup());

describe("path policy", () => {
    test("paths outside the workspace are refused", () => {
        expect(() => ws.executor.readFile("../outside.txt")).toThrow("Path escapes workspace");
        expect(() => ws.executor.createFile("../../evil.ts", "x")).toThrow("Path escapes workspace");
    });

    test("excluded files cannot be read, listed or changed", () => {
        expect(() => ws.executor.readFile(".env")).toThrow("excluded by policy");
        expect(() => ws.executor.readFile("node_modules/pkg/index.js")).toThrow("excluded by policy");
        expect(() => ws.executor.createFile(".env.local", "x")).toThrow("excluded by policy");
        expect(ws.executor.isExcluded("debug.log")).toBe(true);
        expect(ws.executor.isExcluded("src/app.ts")).toBe(false);

        const listed = ws.executor.listFiles(".", true);
        expect(listed).toContain("src/app.ts");
        expect(listed).not.toContain(".env");
        expect(listed).not.toContain("node_modules");
        expect(listed).not.toContain("debug.log");
    });
});

describe("reading", () => {
    test("shows line numbers and the requested window", () => {
        expect(ws.executor.readFile("notes.md")).toBe("1\t# Notes\n2\thello world\n3\t");
        const window = ws.executor.readFile("src/app.ts", 2, 2);
        expect(window).toContain("2\texport function hello() {");
        expect(window).toContain("[showing lines 2-3 of 5; pass offset to read more]");
    });

    test("a missing file is reported", () => {
        expect(() => ws.executor.readFile("nope.ts")).toThrow("File not found: nope.ts");
    });

    test("long output is clipped in the middle", () => {
        const clipped = ws.executor.clip("a".repeat(100), 20);
        expect(clipped.startsWith("a".repeat(12))).toBe(true);
        expect(clipped).toContain("[80 characters omitted]");
        expect(clipped.endsWith("a".repeat(8))).toBe(true);
        expect(ws.executor.clip("short", 20)).toBe("short");
    });
});

describe("staged edits", () => {
    test("an edit needs a read first", () => {
        expect(() => ws.executor.editFile("src/app.ts", "a = 1", "a = 5")).toThrow("read src/app.ts with read_file first");
    });

    test("an edit is staged, visible to reads, and not on disk until applied", () => {
        ws.executor.readFile("src/app.ts");
        const reply = ws.executor.editFile("src/app.ts", "a = 1", "a = 5");
        expect(reply).toBe("Staged edit: src/app.ts (+1 −1)");
        expect(ws.read("src/app.ts")).toContain("a = 1");
        expect(ws.executor.readFile("src/app.ts")).toContain("includes your staged, not yet applied edits");
        expect(ws.executor.hasStaged()).toBe(true);
        expect(ws.executor.turnChangedPaths()).toEqual(["src/app.ts"]);

        approveAll(ws.tracker);
        expect(ws.executor.applyApprovedFromTracker()).toEqual({ errors: [], applied: ["src/app.ts"] });
        expect(ws.read("src/app.ts")).toContain("a = 5");
        expect(ws.executor.hasStaged()).toBe(false);
    });

    test("undo restores the previous content and removes created files", () => {
        ws.executor.readFile("src/app.ts");
        ws.executor.editFile("src/app.ts", "a = 1", "a = 5");
        ws.executor.createFile("src/new.ts", "export const n = 1;\n");
        approveAll(ws.tracker);
        ws.executor.applyApprovedFromTracker();
        expect(ws.exists("src/new.ts")).toBe(true);

        expect(ws.executor.undoLast().sort()).toEqual(["src/app.ts", "src/new.ts"]);
        expect(ws.read("src/app.ts")).toContain("a = 1");
        expect(ws.exists("src/new.ts")).toBe(false);
        expect(ws.executor.undoLast()).toEqual([]);
    });

    test("a rejected change is dropped from the agent's view", () => {
        ws.executor.readFile("src/util.ts");
        ws.executor.modifyFile("src/util.ts", "export const b = 3;\n");
        for (const action of ws.tracker.getPendingMutations()) {
            ws.tracker.updateActionStatus(action.id, "rejected", false);
        }
        expect(ws.executor.revertRejected()).toEqual(["src/util.ts"]);
        expect(ws.executor.getEffectiveText("src/util.ts")).toBe("export const b = 2;\n");
        expect(ws.read("src/util.ts")).toBe("export const b = 2;\n");
    });

    test("an ambiguous or missing match is explained", () => {
        ws.write("dup.ts", "x();\nx();\n");
        ws.executor.readFile("dup.ts");
        expect(() => ws.executor.editFile("dup.ts", "x();", "y();")).toThrow("matches 2 places");
        expect(ws.executor.editFile("dup.ts", "x();", "y();", true)).toContain("Staged edit: dup.ts");

        ws.executor.readFile("src/app.ts");
        expect(() => ws.executor.editFile("src/app.ts", "function goodbye() {", "x")).toThrow("Closest text in the file");
    });

    test("an edit that differs only in indentation still matches", () => {
        ws.executor.readFile("src/app.ts");
        ws.executor.editFile("src/app.ts", "return a;", "return a + 1;");
        expect(ws.executor.getEffectiveText("src/app.ts")).toContain("    return a + 1;");
    });

    test("a file changed on disk since it was read is refused", async () => {
        ws.executor.readFile("src/util.ts");
        await new Promise((resolve) => setTimeout(resolve, 20));
        ws.write("src/util.ts", "export const b = 99;\n");
        expect(() => ws.executor.modifyFile("src/util.ts", "x")).toThrow("changed on disk since you read it");
    });

    test("broken syntax is reported with the staged edit", () => {
        const reply = ws.executor.createFile("bad.json", "{ not json");
        expect(reply).toContain("Staged new file: bad.json");
        expect(reply).toContain("SYNTAX ERROR in bad.json");
    });

    test("create refuses an existing file; delete is staged", () => {
        expect(() => ws.executor.createFile("notes.md", "x")).toThrow("already exists");
        expect(ws.executor.deleteFile("notes.md")).toBe("Staged delete: notes.md");
        expect(ws.executor.getEffectiveText("notes.md")).toBeUndefined();
        expect(ws.exists("notes.md")).toBe(true);
        approveAll(ws.tracker);
        ws.executor.applyApprovedFromTracker();
        expect(ws.exists("notes.md")).toBe(false);
    });

    test("the turn diff covers staged changes", () => {
        ws.executor.beginTurn();
        ws.executor.readFile("src/util.ts");
        ws.executor.modifyFile("src/util.ts", "export const b = 3;\n");
        const diff = ws.executor.turnDiff();
        expect(diff).toContain("-export const b = 2;");
        expect(diff).toContain("+export const b = 3;");
    });
});

describe("searching", () => {
    test("grep returns path:line rows and sees staged content", () => {
        expect(ws.executor.grep("hello")).toBe("notes.md:2: hello world\nsrc/app.ts:2: export function hello() {");
        expect(ws.executor.grep("hello", ".", "*.ts")).toBe("src/app.ts:2: export function hello() {");
        expect(ws.executor.grep("zzz")).toBe("(no matches)");
        ws.executor.createFile("src/staged.ts", "const staged_marker = 1;\n");
        expect(ws.executor.grep("staged_marker")).toContain("src/staged.ts:1");
    });

    test("search_files matches globs", () => {
        expect(ws.executor.searchFiles(".", "*.ts")).toBe("src/app.ts\nsrc/util.ts");
        expect(ws.executor.searchFiles(".", "**/*.md")).toBe("notes.md");
        expect(ws.executor.searchFiles(".", "*.ts", "hello")).toBe("src/app.ts");
        expect(ws.executor.searchFiles(".", "*.py")).toBe("(no matches)");
    });

    test("listTextFiles skips excluded and binary files", () => {
        ws.write("logo.png", "binary");
        expect(ws.executor.listTextFiles(".")).toEqual(["notes.md", "src/app.ts", "src/util.ts"]);
    });
});

describe("commands", () => {
    test("a command returns its output and exit code", async () => {
        const ok = await ws.executor.runCommand("echo yuvi-ok");
        expect(ok.exitCode).toBe(0);
        expect(ok.output).toContain("yuvi-ok");
        expect(ok.timedOut).toBe(false);

        const failed = await ws.executor.runCommand("exit 3");
        expect(failed.exitCode).toBe(3);
    });

    test("an abort stops the command", async () => {
        const controller = new AbortController();
        const running = ws.executor.runCommand("bun -e \"setTimeout(()=>{}, 20000)\"", {
            signal: controller.signal,
        });
        setTimeout(() => controller.abort(), 300);
        const result = await running;
        expect(result.aborted).toBe(true);
    }, 15_000);
});
