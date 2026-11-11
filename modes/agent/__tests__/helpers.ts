/**
 * Shared helpers for the agent tests: a throwaway workspace on disk.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ActionTracker } from "../action-tracker";
import { ToolExecutor } from "../tool-executor";
import { Settings } from "../../../core/config";
import { loadAgentConfig, type AgentConfig } from "../types";

export const FAKE_API_KEY = "sk-or-test-key-that-must-not-leak";

export interface Workspace {
    root: string;
    config: AgentConfig;
    tracker: ActionTracker;
    executor: ToolExecutor;
    write(rel: string, content: string): void;
    read(rel: string): string;
    exists(rel: string): boolean;
    cleanup(): void;
}

/** A temp folder with the given files and an executor working inside it. */
export function makeWorkspace(files: Record<string, string> = {}): Workspace {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-test-"));
    const write = (rel: string, content: string) => {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
    };
    for (const [rel, content] of Object.entries(files)) write(rel, content);

    // Commands need the real PATH; the fake key checks that it is not passed on.
    const settings = new Settings({ ...process.env, OPENROUTER_API_KEY: FAKE_API_KEY, YUVI_CONTEXT_WINDOW: "" }, null);
    const config = loadAgentConfig(settings, root);
    const tracker = new ActionTracker();
    return {
        root,
        config,
        tracker,
        executor: new ToolExecutor(config, tracker),
        write,
        read: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
        exists: (rel) => fs.existsSync(path.join(root, rel)),
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

/** Approve every pending action, the way "Yes, save all changes" does. */
export function approveAll(tracker: ActionTracker): void {
    for (const action of tracker.getPendingMutations()) {
        tracker.updateActionStatus(action.id, "approved", true);
    }
}

