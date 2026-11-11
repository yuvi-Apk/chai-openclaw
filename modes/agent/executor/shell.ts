/**
 * Runs one shell command and collects its output. Kept apart from the file
 * tools so the rules for starting programs are in one small place.
 */
import { spawn } from "node:child_process";

export interface CommandResult {
    exitCode: number | null;
    output: string;
    timedOut: boolean;
    aborted: boolean;
    durationMs: number;
}

export interface ShellOptions {
    cwd: string;
    /** The environment the command runs with. API keys are already removed from it. */
    env: Record<string, string | undefined>;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
}

/** Output kept from a command; older output is dropped when it grows past this. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Stop a command and everything it started. */
function killTree(pid: number | undefined, fallback: () => void): void {
    if (pid === undefined) return;
    if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
        fallback();
    }
}

/** Run a command to the end, or until it times out or is aborted. Never rejects. */
export function runShellCommand(command: string, options: ShellOptions): Promise<CommandResult> {
    const started = Date.now();

    return new Promise((resolve) => {
        const child = spawn(command, {
            shell: true,
            cwd: options.cwd,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            // Tell tools they are not in an interactive, colour terminal.
            env: { ...options.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
        });

        let output = "";
        let timedOut = false;
        let aborted = false;
        let settled = false;

        const collect = (chunk: Buffer) => {
            output += chunk.toString("utf8");
            if (output.length > MAX_OUTPUT_BYTES) output = output.slice(-MAX_OUTPUT_BYTES);
        };
        child.stdout?.on("data", collect);
        child.stderr?.on("data", collect);

        const kill = () => killTree(child.pid, () => child.kill("SIGTERM"));
        const timer = setTimeout(() => {
            timedOut = true;
            kill();
        }, options.timeoutMs);
        const onAbort = () => {
            aborted = true;
            kill();
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });

        const finish = (exitCode: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
            resolve({
                exitCode,
                output: output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim(),
                timedOut,
                aborted,
                durationMs: Date.now() - started,
            });
        };

        child.on("error", (err) => {
            output += `\n${String(err)}`;
            finish(null);
        });
        child.on("close", (code) => finish(code));
    });
}
