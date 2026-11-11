import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
    detectCheckCommands,
    loadLastSession,
    loadMemory,
    loadProjectConfig,
    loadProjectInstructions,
    pruneToolOutputs,
    remember,
    saveProjectConfig,
    saveSession,
    summarizeHistory,
} from "../memory";
import { RepoMap } from "../repo-map";
import { makeWorkspace, type Workspace } from "./helpers";

let ws: Workspace;
beforeEach(() => {
    ws = makeWorkspace();
});
afterEach(() => ws.cleanup());

describe("project memory", () => {
    test("facts are appended once", () => {
        expect(loadMemory(ws.root)).toBe("");
        expect(remember(ws.root, "  Tests run with   bun test ")).toBe("Remembered: Tests run with bun test");
        expect(remember(ws.root, "tests run with bun test")).toBe("Already remembered.");
        expect(loadMemory(ws.root)).toBe("# yuvi project memory\n\n- Tests run with bun test");
        expect(() => remember(ws.root, "   ")).toThrow("fact is empty");
    });

    test("project instructions come from YUVI.md, then AGENTS.md", () => {
        expect(loadProjectInstructions(ws.root)).toBe("");
        ws.write("AGENTS.md", "use tabs");
        expect(loadProjectInstructions(ws.root)).toBe("(from AGENTS.md)\nuse tabs");
        ws.write("YUVI.md", "use spaces");
        expect(loadProjectInstructions(ws.root)).toBe("(from YUVI.md)\nuse spaces");
    });
});

describe("project config and sessions", () => {
    test("config is saved and loaded", () => {
        expect(loadProjectConfig(ws.root)).toEqual({});
        saveProjectConfig(ws.root, { checkCommands: ["bun test"] });
        expect(loadProjectConfig(ws.root)).toEqual({ checkCommands: ["bun test"] });
    });

    test("the last session is saved and loaded", () => {
        expect(loadLastSession(ws.root)).toBeUndefined();
        saveSession(ws.root, [{ role: "user", content: "hi" }]);
        const saved = loadLastSession(ws.root);
        expect(saved?.messages).toEqual([{ role: "user", content: "hi" }]);
        expect(saved?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe("check commands", () => {
    test("a bun TypeScript project", () => {
        ws.write("package.json", JSON.stringify({ scripts: { lint: "eslint .", test: "bun test" } }));
        ws.write("bun.lock", "");
        ws.write("tsconfig.json", "{}");
        expect(detectCheckCommands(ws.root)).toEqual(["bunx tsc --noEmit", "bun run lint", "bun run test"]);
    });

    test("an npm project with a typecheck script and a placeholder test", () => {
        ws.write(
            "package.json",
            JSON.stringify({ scripts: { typecheck: "tsc", test: 'echo "Error: no test specified" && exit 1' } }),
        );
        expect(detectCheckCommands(ws.root)).toEqual(["npm run typecheck"]);
    });

    test("other languages and unknown projects", () => {
        expect(detectCheckCommands(ws.root)).toEqual([]);
        ws.write("go.mod", "module x");
        expect(detectCheckCommands(ws.root)).toEqual(["go vet ./..."]);
    });
});

describe("context compaction", () => {
    const toolMessage = (text: string): ModelMessage => ({
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "1", toolName: "read_file", output: { type: "text", value: text } }],
    });

    test("large old tool results are replaced by a stub", () => {
        const messages: ModelMessage[] = [
            toolMessage("x".repeat(700)),
            toolMessage("small"),
            { role: "user", content: "recent" },
        ];
        const { messages: next, pruned } = pruneToolOutputs(messages, 1);
        expect(pruned).toBe(1);
        const first = next[0] as { content: Array<{ output: { value: string } }> };
        expect(first.content[0]!.output.value).toBe(
            "[old read_file result removed to save context (700 chars). Call the tool again if you need it.]",
        );
        expect(next[1]).toEqual(messages[1]!);
    });

    test("recent messages are left alone", () => {
        const messages = [toolMessage("x".repeat(700))];
        expect(pruneToolOutputs(messages, 10).pruned).toBe(0);
    });

    test("a short conversation is not summarised", async () => {
        const messages: ModelMessage[] = [
            { role: "user", content: "one" },
            { role: "assistant", content: "ok" },
            { role: "user", content: "two" },
        ];
        // No model is needed: fewer than three user turns returns the input.
        expect(await summarizeHistory(messages, null as never, "any-model")).toBe(messages);
    });
});

describe("repo map", () => {
    test("it outlines code files and finds symbols", () => {
        ws.write("src/a.ts", "export function alpha() {}\nconst hidden = 1;\nexport class Beta {}\n");
        ws.write("src/b.py", "def gamma():\n    pass\n");
        ws.write("README.md", "# readme\n");
        const map = new RepoMap(ws.executor);
        map.build();

        expect(map.fileCount).toBe(2);
        expect(map.render()).toBe("src/a.ts (4 lines) — alpha:1, Beta:3 (+1 more)\nsrc/b.py (3 lines) — gamma:1");
        expect(ws.exists(".yuvi/cache/repo-map.json")).toBe(true);

        const found = map.findSymbol("alpha");
        expect(found).toContain("Definitions:\nsrc/a.ts:1  export function alpha");
        expect(found).toContain("Usages:\nsrc/a.ts:1: export function alpha() {}");
        expect(map.findSymbol("alph")).toContain("Similar names:\nsrc/a.ts:1  export function alpha");
    });
});
