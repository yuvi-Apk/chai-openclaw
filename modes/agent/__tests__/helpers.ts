/**
 * Shared helpers for the agent tests: a throwaway workspace on disk and a
 * way to capture what is written to the screen.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ActionTracker } from "../action-tracker";
import { ToolExecutor } from "../tool-executor";
import { defaultAgentConfig, type AgentConfig } from "../types";

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

    const config = { ...defaultAgentConfig(), codebasePath: root };
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

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Remove colour and cursor codes, so tests compare the words only. */
export const plain = (text: string) => text.replace(ANSI, "");

/**
 * Run `fn` with the terminal switched off and collect everything it prints
 * through process.stdout and console.log.
 */
export async function captureOutput(fn: () => unknown | Promise<unknown>): Promise<string> {
    const chunks: string[] = [];
    const stdout = process.stdout as unknown as { write: unknown; isTTY?: boolean };
    const stdin = process.stdin as unknown as { isTTY?: boolean };
    const saved = { write: stdout.write, log: console.log, outTty: stdout.isTTY, inTty: stdin.isTTY };

    stdout.write = (chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
    };
    console.log = (...args: unknown[]) => void chunks.push(args.join(" ") + "\n");
    stdout.isTTY = false;
    stdin.isTTY = false;
    try {
        await fn();
    } finally {
        stdout.write = saved.write;
        console.log = saved.log;
        stdout.isTTY = saved.outTty;
        stdin.isTTY = saved.inTty;
    }
    return plain(chunks.join(""));
}
