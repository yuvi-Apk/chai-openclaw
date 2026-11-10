import fs from "node:fs";
import path from "node:path";
import { generateText, type LanguageModel, type ModelMessage } from "ai";
import type { ToolExecutor } from "./tool-executor";

const yuviDir = (root: string) => path.join(root, ".yuvi");

function readIfExists(file: string, maxChars: number): string {
    try {
        const text = fs.readFileSync(file, "utf8").trim();
        return text.length > maxChars
            ? `${text.slice(0, maxChars)}\n… (truncated)`
            : text;
    } catch {
        return "";
    }
}

// ---------- project memory ----------

/** Facts the agent saved in earlier sessions (.yuvi/memory.md). */
export function loadMemory(root: string): string {
    return readIfExists(path.join(yuviDir(root), "memory.md"), 4000);
}

/** Append one durable fact to the project memory. */
export function remember(root: string, fact: string): string {
    const clean = fact.replace(/\s+/g, " ").trim();
    if (!clean) throw new Error("remember: fact is empty");
    const file = path.join(yuviDir(root), "memory.md");
    const existing = readIfExists(file, 100_000);
    if (existing.toLowerCase().includes(clean.toLowerCase())) {
        return "Already remembered.";
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const header = existing ? "" : "# yuvi project memory\n\n";
    fs.appendFileSync(file, `${header}- ${clean}\n`, "utf8");
    return `Remembered: ${clean}`;
}

/** Instructions the user wrote for agents working in this project. */
export function loadProjectInstructions(root: string): string {
    for (const name of ["YUVI.md", "AGENTS.md"]) {
        const text = readIfExists(path.join(root, name), 6000);
        if (text) return `(from ${name})\n${text}`;
    }
    return "";
}

/** Name and description of each installed skill, for the system prompt. */
export function loadSkillsIndex(executor: ToolExecutor): string {
    const rows: string[] = [];
    for (const file of executor.skillFiles().slice(0, 40)) {
        const head = readIfExists(file, 1500);
        const name =
            /^name:\s*(.+)$/m.exec(head)?.[1]?.trim() ??
            path.basename(path.dirname(file));
        const description = /^description:\s*(.+)$/m.exec(head)?.[1]?.trim() ?? "";
        rows.push(`- ${name}: ${description.slice(0, 160)} [${file}]`);
    }
    return rows.join("\n");
}

// ---------- project config and check commands ----------

export interface ProjectConfig {
    /** Commands the harness runs after edits to verify them. */
    checkCommands?: string[];
}

export function loadProjectConfig(root: string): ProjectConfig {
    try {
        return JSON.parse(
            fs.readFileSync(path.join(yuviDir(root), "config.json"), "utf8"),
        ) as ProjectConfig;
    } catch {
        return {};
    }
}

export function saveProjectConfig(root: string, config: ProjectConfig): void {
    try {
        fs.mkdirSync(yuviDir(root), { recursive: true });
        fs.writeFileSync(
            path.join(yuviDir(root), "config.json"),
            JSON.stringify(config, null, 2) + "\n",
            "utf8",
        );
    } catch {
        // config is optional
    }
}

/** Work out how this project type-checks, lints and tests itself. */
export function detectCheckCommands(root: string): string[] {
    const commands: string[] = [];
    const has = (name: string) => fs.existsSync(path.join(root, name));
    let scripts: Record<string, string> = {};
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        scripts = pkg.scripts ?? {};
    } catch {
        scripts = {};
    }

    if (has("package.json")) {
        const runner =
            has("bun.lock") || has("bun.lockb")
                ? "bun run"
                : has("pnpm-lock.yaml")
                    ? "pnpm run"
                    : has("yarn.lock")
                        ? "yarn"
                        : "npm run";
        const exec = runner === "bun run" ? "bunx" : "npx";
        const typecheck = ["typecheck", "type-check", "tsc"].find((s) => scripts[s]);
        if (typecheck) commands.push(`${runner} ${typecheck}`);
        else if (has("tsconfig.json")) commands.push(`${exec} tsc --noEmit`);
        if (scripts.lint) commands.push(`${runner} lint`);
        if (scripts.test && !/no test specified/i.test(scripts.test)) {
            commands.push(`${runner} test`);
        }
    } else if (has("Cargo.toml")) {
        commands.push("cargo check");
    } else if (has("go.mod")) {
        commands.push("go vet ./...");
    }
    return commands;
}

// ---------- sessions ----------

export function saveSession(root: string, messages: ModelMessage[]): void {
    try {
        const dir = path.join(yuviDir(root), "sessions");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, "last.json"),
            JSON.stringify({ savedAt: new Date().toISOString(), messages }),
            "utf8",
        );
    } catch {
        // a session that cannot be saved still works
    }
}

export function loadLastSession(
    root: string,
): { savedAt: string; messages: ModelMessage[] } | undefined {
    try {
        const data = JSON.parse(
            fs.readFileSync(path.join(yuviDir(root), "sessions", "last.json"), "utf8"),
        );
        if (Array.isArray(data.messages) && data.messages.length) return data;
    } catch {
        // no saved session
    }
    return undefined;
}

// ---------- context compaction ----------

/**
 * Replace large tool results in older messages with a short stub. The recent
 * messages are left alone, so the agent keeps what it is working with.
 */
export function pruneToolOutputs(
    messages: ModelMessage[],
    keepRecent = 10,
    minChars = 600,
): { messages: ModelMessage[]; pruned: number } {
    let pruned = 0;
    const cutoff = messages.length - keepRecent;
    const next = messages.map((message, index) => {
        if (index >= cutoff || message.role !== "tool") return message;
        const content = message.content.map((part) => {
            if (part.type !== "tool-result") return part;
            const output = part.output;
            const raw =
                output.type === "text"
                    ? output.value
                    : output.type === "json"
                        ? JSON.stringify(output.value)
                        : "";
            if (raw.length < minChars) return part;
            pruned++;
            return {
                ...part,
                output: {
                    type: "text" as const,
                    value: `[old ${part.toolName} result removed to save context (${raw.length} chars). Call the tool again if you need it.]`,
                },
            };
        });
        return { ...message, content };
    });
    return { messages: next, pruned };
}

function messageToText(message: ModelMessage): string {
    if (typeof message.content === "string") {
        return `${message.role.toUpperCase()}: ${message.content}`;
    }
    const parts: string[] = [];
    for (const part of message.content) {
        if (part.type === "text") parts.push(part.text);
        else if (part.type === "tool-call") {
            parts.push(`[called ${part.toolName} ${JSON.stringify(part.input).slice(0, 300)}]`);
        } else if (part.type === "tool-result") {
            const output = part.output;
            const raw =
                output.type === "text"
                    ? output.value
                    : output.type === "json"
                        ? JSON.stringify(output.value)
                        : `(${output.type})`;
            parts.push(`[${part.toolName} returned: ${raw.slice(0, 500)}]`);
        }
    }
    return `${message.role.toUpperCase()}: ${parts.join("\n")}`;
}

/**
 * Summarise the older part of a conversation into one message. The last two
 * user turns are kept word for word.
 */
export async function summarizeHistory(
    messages: ModelMessage[],
    model: LanguageModel,
    abortSignal?: AbortSignal,
): Promise<ModelMessage[]> {
    const userIndexes = messages
        .map((m, i) => (m.role === "user" ? i : -1))
        .filter((i) => i >= 0);
    if (userIndexes.length < 3) return messages;
    const keepFrom = userIndexes[userIndexes.length - 2]!;
    const older = messages.slice(0, keepFrom);
    if (!older.length) return messages;

    let transcript = older.map(messageToText).join("\n\n");
    if (transcript.length > 80_000) transcript = transcript.slice(-80_000);

    const { text } = await generateText({
        model,
        abortSignal,
        prompt:
            "Summarise this coding-agent conversation so the agent can continue the work without it.\n" +
            "Keep: what the user asked for, decisions made, files read and changed (with paths), " +
            "commands run and their results, problems found, and what is still open.\n" +
            "Be factual and compact. Use short bullet points.\n\n" +
            transcript,
    });

    return [
        {
            role: "user",
            content: `[Summary of the earlier conversation, written by the harness]\n${text.trim()}`,
        },
        {
            role: "assistant",
            content: "Understood. I will continue from this summary.",
        },
        ...messages.slice(keepFrom),
    ];
}
