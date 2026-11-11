/**
 * The agent's hands: every file read, staged edit, search and command goes
 * through this class. Edits are kept in memory ("staged") until the user
 * approves them, and paths are checked so nothing outside the workspace or
 * on the exclude list is touched.
 */
import fs from "node:fs";
import path from "node:path";
import { diffLines } from "diff";
import { clipMiddle } from "../../core/security/limits";
import { ActionTracker } from "./action-tracker";
import { formatPatch } from "./diff-view";
import { runShellCommand, type CommandResult } from "./executor/shell";
import { findSkillFiles, readSkillFile, skillRoots } from "./executor/skills";
import type { AgentConfig, ActionLog } from "./types";

export type { CommandResult };

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
/** How much of a command's output is kept in the action log. */
const COMMAND_LOG_TAIL_CHARS = 2000;

const TEXT_EXT = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".mdx",
    ".css",
    ".html",
    ".yml",
    ".yaml",
    ".toml",
    ".txt",
]);

const BINARY_EXT = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip",
    ".gz", ".tar", ".7z", ".exe", ".dll", ".so", ".dylib", ".woff", ".woff2",
    ".ttf", ".eot", ".mp3", ".mp4", ".mov", ".wasm", ".lockb", ".bin",
]);

const SCRIPT_LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".mjs": "js",
    ".cjs": "js",
};

function isProbablyTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return TEXT_EXT.has(ext) || ext === "";
}

interface CheckpointEntry {
    path: string;
    /** File content before the change, or null when the file did not exist. */
    before: string | null;
}

export class ToolExecutor {

    private overlay = new Map<string, string>();
    private deleted = new Set<string>();
    /** Disk mtime of each file when the agent last saw its content. */
    private readStamps = new Map<string, number>();
    /** Content of each file at the start of the turn (null = did not exist). */
    private turnBaseline = new Map<string, string | null>();
    /** One entry per apply, so /undo can restore the previous state. */
    private checkpoints: CheckpointEntry[][] = [];
    /** Rejected actions whose staged content was already dropped. */
    private revertedIds = new Set<string>();
    /** Goes up on every staged or undone change; used to know if a check is stale. */
    editSeq = 0;

    private readonly norm = (rel: string) =>
        path.posix.normalize(rel.split(path.sep).join("/")).replace(/^\.\//, "");

    constructor(
        private readonly config: AgentConfig,
        private readonly tracker: ActionTracker) { }

    get root(): string {
        return this.config.codebasePath;
    }

    private resolveSafe(rel: string): string {
        const abs = path.resolve(this.config.codebasePath, rel);
        const root = path.resolve(this.config.codebasePath);
        const relCheck = path.relative(root, abs);
        if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
            throw new Error(`Path escapes workspace: ${rel}`);
        }
        return abs;
    }

    private excluded(relPath: string): boolean {
        const norm = this.norm(relPath);
        const segments = norm.split("/");
        const base = segments[segments.length - 1] ?? "";

        for (const pat of this.config.excludePatterns) {
            if (pat === "*.log" && base.endsWith(".log")) return true;
            if (pat === ".env*" && base.startsWith(".env")) return true;
            if (pat.includes("*")) continue;
            if (segments.includes(pat) || norm === pat || norm.startsWith(`${pat}/`))
                return true;
        }
        return false;
    }

    /** True when a workspace-relative path is hidden from the agent by policy. */
    isExcluded(relPath: string): boolean {
        return this.excluded(relPath);
    }

    private assertNotExcluded(rel: string, op: string): void {
        if (this.excluded(rel)) {
            throw new Error(`${op}: path is excluded by policy: ${rel}`);
        }
    }

    /** Shorten a long tool result, keeping the start and the end. */
    clip(text: string, max = this.config.maxToolOutputChars): string {
        return clipMiddle(text, max);
    }

    private globToRegex(g: string): RegExp {
        const escaped = g
            .replace(/\\/g, "/")
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\?/g, ".")
            .replace(/\*\*\//g, "§§/")
            .replace(/\*\*/g, "§§")
            .replace(/\*/g, "[^/\\\\]*")
            .replace(/§§\//g, "(?:.*/)?")
            .replace(/§§/g, ".*");
        return new RegExp(`^${escaped}$`, "i");
    }

    private diskMtime(abs: string): number {
        try {
            return fs.statSync(abs).mtimeMs;
        } catch {
            return 0;
        }
    }

    getEffectiveText(rel: string): string | undefined {
        const key = this.norm(rel);
        if (this.deleted.has(key)) return undefined;
        if (this.overlay.has(key)) return this.overlay.get(key);
        const abs = this.resolveSafe(rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
        return fs.readFileSync(abs, "utf8");
    }

    /**
     * Read a file as the agent should see it: staged edits included, with line
     * numbers, and only the requested window of lines.
     */
    readFile(rel: string, offset = 1, limit = 2000): string {
        this.assertNotExcluded(rel, "read_file");
        const key = this.norm(rel);
        const abs = this.resolveSafe(rel);
        const staged = this.overlay.has(key);

        if (!staged) {
            if (
                this.deleted.has(key) ||
                !fs.existsSync(abs) ||
                !fs.statSync(abs).isFile()
            ) {
                throw new Error(`File not found: ${rel}`);
            }
            if (BINARY_EXT.has(path.extname(abs).toLowerCase())) {
                throw new Error(`read_file: ${rel} is a binary file`);
            }
            if (fs.statSync(abs).size > this.config.maxFileSizeToRead) {
                throw new Error(`File too large: ${rel}`);
            }
        }

        const text = this.getEffectiveText(rel) ?? "";
        if (text.includes("\u0000")) {
            throw new Error(`read_file: ${rel} is a binary file`);
        }
        this.readStamps.set(key, this.diskMtime(abs));

        const lines = text.split(/\r?\n/);
        const start = Math.max(1, Math.floor(offset));
        const end = Math.min(lines.length, start + Math.max(1, Math.floor(limit)) - 1);
        const body = lines
            .slice(start - 1, end)
            .map((line, i) => `${start + i}\t${line}`)
            .join("\n");

        this.tracker.log({
            type: "code_analysis",
            path: key,
            details: { toolName: "read_file" },
            status: "executed",
        });

        const notes: string[] = [];
        if (staged) notes.push("includes your staged, not yet applied edits");
        if (start > 1 || end < lines.length) {
            notes.push(
                `showing lines ${start}-${end} of ${lines.length}; pass offset to read more`,
            );
        }
        const footer = notes.length ? `\n\n[${notes.join("; ")}]` : "";
        return this.clip(body || "(empty file)") + footer;
    }

    /** Refuse edits to files the agent has not seen or that changed on disk. */
    private assertFresh(rel: string, key: string, op: string): void {
        if (!this.readStamps.has(key)) {
            throw new Error(
                `${op}: read ${rel} with read_file first, so the edit is based on its real content.`,
            );
        }
        if (this.overlay.has(key)) return;
        const stamp = this.readStamps.get(key) ?? 0;
        if (this.diskMtime(this.resolveSafe(rel)) > stamp + 1) {
            throw new Error(
                `${op}: ${rel} changed on disk since you read it. Read it again, then retry the edit.`,
            );
        }
    }

    /** Record a staged change: remembers the turn baseline and bumps editSeq. */
    private stage(key: string, before: string | undefined): void {
        if (!this.turnBaseline.has(key)) this.turnBaseline.set(key, before ?? null);
        this.editSeq++;
    }

    /** Quick parse of the new content, so a broken edit is reported right away. */
    private syntaxWarning(key: string, content: string): string {
        const ext = path.extname(key).toLowerCase();
        try {
            if (ext === ".json") JSON.parse(content);
            const loader = SCRIPT_LOADERS[ext];
            if (loader) new Bun.Transpiler({ loader }).transformSync(content);
            return "";
        } catch (e) {
            const err = e as { message?: string; errors?: unknown[] };
            const details = (err.errors ?? [])
                .slice(0, 3)
                .map((x) => {
                    const item = x as {
                        message?: string;
                        position?: { line?: number; column?: number };
                    };
                    const where = item.position?.line
                        ? ` (line ${item.position.line})`
                        : "";
                    return `${item.message ?? String(x)}${where}`;
                })
                .join("; ");
            return (
                `\n\nSYNTAX ERROR in ${key} after this change: ` +
                `${details || err.message || String(e)}. ` +
                "The change is staged, but the file does not parse. Read it and fix it now."
            );
        }
    }

    private changeStat(before: string, after: string): string {
        let added = 0;
        let removed = 0;
        for (const part of diffLines(before, after)) {
            if (part.added) added += part.count ?? 0;
            else if (part.removed) removed += part.count ?? 0;
        }
        return `+${added} −${removed}`;
    }

    createFile(rel: string, content: string): string {
        if (!this.config.tools.allowFileCreation)
            throw new Error("File creation disabled");
        this.assertNotExcluded(rel, "create_file");
        const key = this.norm(rel);
        const abs = this.resolveSafe(rel);
        if ((fs.existsSync(abs) || this.overlay.has(key)) && !this.deleted.has(key)) {
            throw new Error(
                `create_file: already exists: ${rel}. Use edit_file or modify_file to change it.`,
            );
        }
        this.stage(key, undefined);
        this.deleted.delete(key);
        this.overlay.set(key, content);
        this.readStamps.set(key, this.diskMtime(abs));
        this.tracker.log({
            type: "file_create",
            path: key,
            details: { after: content },
            status: "pending",
        });
        const lineCount = content.split("\n").length;
        return `Staged new file: ${key} (${lineCount} lines)` + this.syntaxWarning(key, content);
    }

    modifyFile(rel: string, content: string): string {
        if (!this.config.tools.allowFileModification)
            throw new Error("File modification disabled");
        this.assertNotExcluded(rel, "modify_file");
        const before = this.getEffectiveText(rel);
        if (before === undefined)
            throw new Error(`modify_file: file not found: ${rel}`);
        const key = this.norm(rel);
        this.assertFresh(rel, key, "modify_file");
        if (before === content) return `No change: ${key} already has this content.`;
        this.stage(key, before);
        this.overlay.set(key, content);
        this.tracker.log({
            type: "file_modify",
            path: key,
            details: { before, after: content },
            status: "pending",
        });
        return (
            `Staged update: ${key} (${this.changeStat(before, content)})` +
            this.syntaxWarning(key, content)
        );
    }

    /**
     * Replace one exact piece of text in a file. Falls back to a match that
     * ignores indentation and line endings, and explains a miss with the
     * closest lines so the model can correct itself.
     */
    editFile(
        rel: string,
        oldString: string,
        newString: string,
        replaceAll = false,
    ): string {
        if (!this.config.tools.allowFileModification)
            throw new Error("File modification disabled");
        this.assertNotExcluded(rel, "edit_file");
        const before = this.getEffectiveText(rel);
        if (before === undefined)
            throw new Error(`edit_file: file not found: ${rel}`);
        const key = this.norm(rel);
        this.assertFresh(rel, key, "edit_file");
        if (!oldString) throw new Error("edit_file: old_string must not be empty");
        if (oldString === newString)
            throw new Error("edit_file: old_string and new_string are identical");

        // Match using the file's own line endings.
        const eol = before.includes("\r\n") ? "\r\n" : "\n";
        const toEol = (s: string) => s.replace(/\r\n/g, "\n").replace(/\n/g, eol);
        const oldText = toEol(oldString);
        const newText = toEol(newString);

        let after: string | undefined;
        const count = before.split(oldText).length - 1;

        if (count === 1 || (count > 1 && replaceAll)) {
            after = before.split(oldText).join(newText);
        } else if (count > 1) {
            throw new Error(
                `edit_file: old_string matches ${count} places in ${rel}. ` +
                "Include more surrounding lines to make it unique, or set replace_all.",
            );
        } else {
            after = this.looseReplace(before, oldText, newText, eol, rel);
        }

        this.stage(key, before);
        this.overlay.set(key, after);
        this.tracker.log({
            type: "file_modify",
            path: key,
            details: { before, after },
            status: "pending",
        });
        return (
            `Staged edit: ${key} (${this.changeStat(before, after)})` +
            this.syntaxWarning(key, after)
        );
    }

    /** Line-based match that ignores leading/trailing whitespace on each line. */
    private looseReplace(
        before: string,
        oldText: string,
        newText: string,
        eol: string,
        rel: string,
    ): string {
        const fileLines = before.split(eol);
        const oldLines = oldText.split(eol);
        while (oldLines.length > 1 && !oldLines[oldLines.length - 1]!.trim()) oldLines.pop();
        while (oldLines.length > 1 && !oldLines[0]!.trim()) oldLines.shift();
        const wanted = oldLines.map((l) => l.trim());

        const hits: number[] = [];
        for (let i = 0; i + wanted.length <= fileLines.length; i++) {
            let same = true;
            for (let j = 0; j < wanted.length; j++) {
                if (fileLines[i + j]!.trim() !== wanted[j]) {
                    same = false;
                    break;
                }
            }
            if (same) hits.push(i);
        }

        if (hits.length === 1) {
            const at = hits[0]!;
            const indentOf = (s: string) => s.match(/^[ \t]*/)?.[0] ?? "";
            const firstOld = oldLines.find((l) => l.trim()) ?? "";
            const firstFile =
                fileLines.slice(at, at + wanted.length).find((l) => l.trim()) ?? "";
            const oldIndent = indentOf(firstOld);
            const fileIndent = indentOf(firstFile);
            const newLines = newText.split(eol).map((line) => {
                if (oldIndent === fileIndent || !line.trim()) return line;
                return line.startsWith(oldIndent)
                    ? fileIndent + line.slice(oldIndent.length)
                    : line;
            });
            return [
                ...fileLines.slice(0, at),
                ...newLines,
                ...fileLines.slice(at + wanted.length),
            ].join(eol);
        }

        if (hits.length > 1) {
            throw new Error(
                `edit_file: old_string matches ${hits.length} places in ${rel} ` +
                `(lines ${hits.map((h) => h + 1).join(", ")}). Include more surrounding lines.`,
            );
        }

        // No match: show the most similar region to help the next attempt.
        const anchor = wanted.find((l) => l.length > 3) ?? wanted[0] ?? "";
        const anchorWords = new Set(anchor.split(/\W+/).filter((w) => w.length > 2));
        let best = -1;
        let bestScore = 0;
        fileLines.forEach((line, i) => {
            const words = line.split(/\W+/).filter((w) => w.length > 2);
            const score = words.filter((w) => anchorWords.has(w)).length;
            if (score > bestScore) {
                bestScore = score;
                best = i;
            }
        });
        let hint = "";
        if (best >= 0) {
            const from = Math.max(0, best - 3);
            const to = Math.min(fileLines.length, best + wanted.length + 3);
            hint =
                "\nClosest text in the file:\n" +
                fileLines
                    .slice(from, to)
                    .map((line, i) => `${from + i + 1}\t${line}`)
                    .join("\n");
        }
        throw new Error(
            `edit_file: old_string was not found in ${rel}. ` +
            "It must match the current file content exactly." +
            hint,
        );
    }

    deleteFile(rel: string): string {
        if (!this.config.tools.allowFileModification)
            throw new Error("File deletion disabled");
        this.assertNotExcluded(rel, "delete_file");
        const before = this.getEffectiveText(rel);
        if (before === undefined)
            throw new Error(`delete_file: file not found: ${rel}`);
        const key = this.norm(rel);
        this.stage(key, before);
        this.overlay.delete(key);
        this.deleted.add(key);
        this.tracker.log({
            type: "file_delete",
            path: key,
            details: { before },
            status: "pending",
        });
        return `Staged delete: ${key}`;
    }

    createFolder(rel: string): string {
        if (!this.config.tools.allowFolderCreation)
            throw new Error("Folder creation disabled");
        this.assertNotExcluded(rel, "create_folder");
        const key = this.norm(rel);
        this.tracker.log({
            type: "folder_create",
            path: key,
            details: { after: key },
            status: "pending",
        });
        return `Staged folder: ${key}`;
    }

    listFiles(rel: string, recursive: boolean): string {
        this.assertNotExcluded(rel, "list_files");
        const abs = this.resolveSafe(rel);
        if (!fs.existsSync(abs)) throw new Error(`list_files: not found: ${rel}`);

        const lines: string[] = [];
        const walk = (dir: string, prefix: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const ent of entries) {
                const full = path.join(dir, ent.name);
                const relP = path.relative(this.config.codebasePath, full);
                if (this.excluded(relP)) continue;
                if (ent.isDirectory()) {
                    lines.push(`${prefix}${ent.name}/`);
                    if (recursive) walk(full, `${prefix}${ent.name}/`);
                } else {
                    lines.push(`${prefix}${ent.name}`);
                }
            }
        };

        if (fs.statSync(abs).isDirectory()) walk(abs, "");
        else lines.push(path.relative(this.config.codebasePath, abs));

        const out = lines.sort().join("\n");
        this.tracker.log({
            type: "code_analysis",
            path: this.norm(rel),
            details: { toolName: "list_files" },
            status: "executed",
        });
        return this.clip(out || "(empty)");
    }

    searchFiles(
        rootRel: string,
        globPattern: string,
        contentQuery?: string,
    ): string {
        this.assertNotExcluded(rootRel, "search_files");
        const rootAbs = this.resolveSafe(rootRel);
        if (!fs.existsSync(rootAbs))
            throw new Error(`search_files: root not found: ${rootRel}`);

        const results: string[] = [];
        const nameRe = this.globToRegex(globPattern);

        const walk = (dir: string) => {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, ent.name);
                const relP = path
                    .relative(this.config.codebasePath, full)
                    .split(path.sep)
                    .join("/");
                if (this.excluded(relP)) continue;
                if (ent.isDirectory()) walk(full);
                else if (nameRe.test(relP) || nameRe.test(ent.name)) {
                    if (contentQuery) {
                        if (!isProbablyTextFile(full)) continue;
                        const text = fs.readFileSync(full, "utf8");
                        if (!text.includes(contentQuery)) continue;
                    }
                    results.push(relP);
                }
            }
        };

        if (fs.statSync(rootAbs).isDirectory()) walk(rootAbs);
        else {
            const relP = path
                .relative(this.config.codebasePath, rootAbs)
                .split(path.sep)
                .join("/");
            results.push(relP);
        }

        const out = [...new Set(results)].sort().join("\n");
        this.tracker.log({
            type: "code_analysis",
            path: this.norm(rootRel),
            details: { toolName: "search_files" },
            status: "executed",
        });
        return this.clip(out || "(no matches)");
    }

    /** Every readable text file under a directory, staged files included. */
    listTextFiles(rootRel = "."): string[] {
        const rootAbs = this.resolveSafe(rootRel);
        const found = new Set<string>();
        const walk = (dir: string) => {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const ent of entries) {
                const full = path.join(dir, ent.name);
                const relP = this.norm(path.relative(this.config.codebasePath, full));
                if (this.excluded(relP)) continue;
                if (ent.isDirectory()) walk(full);
                else if (!BINARY_EXT.has(path.extname(ent.name).toLowerCase()))
                    found.add(relP);
            }
        };
        if (fs.existsSync(rootAbs)) {
            if (fs.statSync(rootAbs).isDirectory()) walk(rootAbs);
            else found.add(this.norm(path.relative(this.config.codebasePath, rootAbs)));
        }
        const prefix = this.norm(rootRel);
        for (const key of this.overlay.keys()) {
            if (prefix === "." || key === prefix || key.startsWith(`${prefix}/`))
                found.add(key);
        }
        for (const key of this.deleted) found.delete(key);
        return [...found].sort();
    }

    /** Regex search through file contents. Returns `path:line: text` rows. */
    grep(
        pattern: string,
        rootRel = ".",
        glob?: string,
        ignoreCase = false,
        maxResults = 100,
    ): string {
        this.assertNotExcluded(rootRel, "grep");
        let re: RegExp;
        try {
            re = new RegExp(pattern, ignoreCase ? "i" : "");
        } catch {
            re = new RegExp(
                pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                ignoreCase ? "i" : "",
            );
        }
        const globRe = glob ? this.globToRegex(glob) : undefined;
        const rows: string[] = [];
        let total = 0;

        for (const rel of this.listTextFiles(rootRel)) {
            if (globRe && !globRe.test(rel) && !globRe.test(path.posix.basename(rel)))
                continue;
            let text: string | undefined;
            try {
                if (!this.overlay.has(rel)) {
                    const st = fs.statSync(this.resolveSafe(rel));
                    if (st.size > this.config.maxFileSizeToRead) continue;
                }
                text = this.getEffectiveText(rel);
            } catch {
                continue;
            }
            if (!text || text.slice(0, 2000).includes("\u0000")) continue;
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (!re.test(lines[i]!)) continue;
                total++;
                if (rows.length < maxResults) {
                    rows.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
                }
            }
        }

        this.tracker.log({
            type: "code_analysis",
            path: this.norm(rootRel),
            details: { toolName: "grep" },
            status: "executed",
        });
        if (!rows.length) return "(no matches)";
        const more =
            total > rows.length
                ? `\n[${total - rows.length} more matches not shown; narrow the pattern or path]`
                : "";
        return this.clip(rows.join("\n")) + more;
    }

    /**
     * Run a shell command in the workspace right now and return its output,
     * so the agent can read the result and react to it.
     */
    async runCommand(
        command: string,
        opts: { timeoutMs?: number; signal?: AbortSignal | undefined } = {},
    ): Promise<CommandResult> {
        if (!this.config.tools.allowShellExecution)
            throw new Error("Shell execution disabled");
        const result = await runShellCommand(command, {
            cwd: this.config.codebasePath,
            env: this.config.commandEnv,
            timeoutMs: opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
            signal: opts.signal,
        });
        this.tracker.log({
            type: "tool_execute",
            path: "shell",
            details: {
                command,
                toolName: "run_command",
                toolResult: result.output.slice(-COMMAND_LOG_TAIL_CHARS),
            },
            status: "executed",
        });
        return result;
    }

    private skillRoots(): string[] {
        return skillRoots(this.config.skillDirs);
    }

    /** Absolute paths of every SKILL.md under the skill roots. */
    skillFiles(): string[] {
        return findSkillFiles(this.skillRoots());
    }

    listSkills(): string {
        const out = this.skillFiles().join("\n");
        this.tracker.log({
            type: "code_analysis",
            path: "skills",
            details: { after: out || "(none)", toolName: "list_skills" },
            status: "executed",
        });
        return out || "(none)";
    }

    readSkill(skillPath: string): string {
        const skill = readSkillFile(skillPath, this.skillRoots(), this.config.codebasePath);
        this.tracker.log({
            type: "code_analysis",
            path: skill.path,
            details: { toolName: "read_skill" },
            status: "executed",
        });
        return this.clip(skill.text);
    }

    hasStaged(): boolean {
        return this.tracker.getPendingMutations().length > 0;
    }

    /** Forget the per-turn baseline; call when a new user turn starts. */
    beginTurn(): void {
        this.turnBaseline.clear();
    }

    /** Files whose content differs from the start of the turn. */
    turnChangedPaths(): string[] {
        const changed: string[] = [];
        for (const [key, base] of this.turnBaseline) {
            let now: string | undefined;
            try {
                now = this.getEffectiveText(key);
            } catch {
                now = undefined;
            }
            if ((now ?? null) !== base) changed.push(key);
        }
        return changed.sort();
    }

    /** Unified diff of everything changed this turn, applied or still staged. */
    turnDiff(): string {
        const patches: string[] = [];
        for (const key of this.turnChangedPaths()) {
            const base = this.turnBaseline.get(key) ?? "";
            const now = this.getEffectiveText(key) ?? "";
            patches.push(formatPatch(key, base, now));
        }
        return patches.join("\n");
    }

    /**
     * Drop the staged content of rejected actions so the agent's view matches
     * what will really be on disk. Returns the paths that were dropped.
     */
    revertRejected(): string[] {
        const paths = new Set<string>();
        for (const a of this.tracker.getActions()) {
            if (a.status !== "rejected" || this.revertedIds.has(a.id)) continue;
            this.revertedIds.add(a.id);
            if (a.type === "folder_create" || a.type === "tool_execute") continue;
            const key = this.norm(a.path);
            this.overlay.delete(key);
            this.deleted.delete(key);
            paths.add(key);
        }
        if (paths.size) this.editSeq++;
        return [...paths].sort();
    }

    /** Write every approved action to disk and remember how to undo it. */
    applyApprovedFromTracker(): { errors: string[]; applied: string[] } {
        const errors: string[] = [];
        const applied: string[] = [];
        const checkpoint: CheckpointEntry[] = [];
        const approved = this.tracker
            .getActions()
            .filter((a) => a.status === "approved");

        for (const a of approved.filter((x) => x.type === "folder_create")) {
            try {
                fs.mkdirSync(this.resolveSafe(a.path), { recursive: true });
            } catch (e) {
                errors.push(String(e));
            }
        }

        const fileOps = approved
            .filter(
                (a) =>
                    a.type === "file_create" ||
                    a.type === "file_modify" ||
                    a.type === "file_delete",
            )
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        const lastByPath = new Map<string, ActionLog>();
        for (const a of fileOps) lastByPath.set(this.norm(a.path), a);

        for (const [p, a] of lastByPath) {
            try {
                const target = this.resolveSafe(p);
                const existed = fs.existsSync(target) && fs.statSync(target).isFile();
                checkpoint.push({
                    path: p,
                    before: existed ? fs.readFileSync(target, "utf8") : null,
                });
                if (a.type === "file_delete") {
                    fs.rmSync(target, { force: true });
                } else {
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    fs.writeFileSync(target, a.details.after ?? "", "utf8");
                }
                // Disk now matches the staged view.
                this.overlay.delete(p);
                this.deleted.delete(p);
                this.readStamps.set(p, this.diskMtime(target));
                applied.push(p);
            } catch (e) {
                errors.push(String(e));
            }
        }

        for (const a of approved) this.tracker.updateActionStatus(a.id, "executed");
        if (checkpoint.length) this.checkpoints.push(checkpoint);
        return { errors, applied };
    }

    /** Restore the files changed by the most recent apply. */
    undoLast(): string[] {
        const checkpoint = this.checkpoints.pop();
        if (!checkpoint) return [];
        const restored: string[] = [];
        for (const entry of checkpoint) {
            try {
                const target = this.resolveSafe(entry.path);
                if (entry.before === null) fs.rmSync(target, { force: true });
                else {
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    fs.writeFileSync(target, entry.before, "utf8");
                }
                this.overlay.delete(entry.path);
                this.deleted.delete(entry.path);
                this.readStamps.delete(entry.path);
                restored.push(entry.path);
            } catch {
                // keep restoring the rest
            }
        }
        this.editSeq++;
        return restored;
    }

    clearStaging(): void {
        this.overlay.clear()
        this.deleted.clear()
    }

}
