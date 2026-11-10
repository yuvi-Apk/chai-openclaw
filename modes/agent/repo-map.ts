import fs from "node:fs";
import path from "node:path";
import type { ToolExecutor } from "./tool-executor";

export interface SymbolInfo {
    name: string;
    kind: string;
    line: number;
    exported: boolean;
}

interface FileEntry {
    mtime: number;
    lines: number;
    symbols: SymbolInfo[];
}

type RepoIndex = Record<string, FileEntry>;

const CODE_EXT = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".kt", ".cs", ".rb", ".php",
]);

const MAX_FILES = 3000;
const MAX_FILE_BYTES = 400_000;

/** Declaration patterns per language. Each captures the symbol name. */
const PATTERNS: Array<{ ext: RegExp; kind: string; re: RegExp }> = [
    // TypeScript / JavaScript
    { ext: /\.[cm]?[jt]sx?$/, kind: "function", re: /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
    { ext: /\.[cm]?[jt]sx?$/, kind: "class", re: /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { ext: /\.[cm]?[jt]sx?$/, kind: "interface", re: /^\s*(export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { ext: /\.[cm]?[jt]sx?$/, kind: "type", re: /^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/ },
    { ext: /\.[cm]?[jt]sx?$/, kind: "enum", re: /^\s*(export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
    { ext: /\.[cm]?[jt]sx?$/, kind: "const", re: /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/ },
    // Python
    { ext: /\.py$/, kind: "function", re: /^()(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
    { ext: /\.py$/, kind: "class", re: /^()class\s+([A-Za-z_]\w*)/ },
    // Go
    { ext: /\.go$/, kind: "function", re: /^()func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
    { ext: /\.go$/, kind: "type", re: /^()type\s+([A-Za-z_]\w*)/ },
    // Rust
    { ext: /\.rs$/, kind: "function", re: /^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
    { ext: /\.rs$/, kind: "type", re: /^\s*(pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/ },
    // Java / Kotlin / C#
    { ext: /\.(java|kt|cs)$/, kind: "class", re: /^\s*((?:public|internal)\s+)?(?:(?:abstract|final|static|sealed|data|open|partial)\s+)*(?:class|interface|enum|record|object)\s+([A-Za-z_]\w*)/ },
    // Ruby / PHP
    { ext: /\.rb$/, kind: "function", re: /^\s*()def\s+([A-Za-z_]\w*[?!]?)/ },
    { ext: /\.(rb|php)$/, kind: "class", re: /^\s*()(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/ },
    { ext: /\.php$/, kind: "function", re: /^\s*((?:public|protected|private)\s+)?(?:static\s+)?function\s+([A-Za-z_]\w*)/ },
];

function outline(rel: string, text: string): SymbolInfo[] {
    const patterns = PATTERNS.filter((p) => p.ext.test(rel));
    if (!patterns.length) return [];
    const isScript = /\.[cm]?[jt]sx?$/.test(rel);
    const symbols: SymbolInfo[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const p of patterns) {
            const m = p.re.exec(line);
            if (!m || !m[2]) continue;
            symbols.push({
                name: m[2],
                kind: p.kind,
                line: i + 1,
                // Outside JS/TS there is no export keyword: treat top-level as public.
                exported: isScript ? Boolean(m[1]) : !line.startsWith(" ") || Boolean(m[1]),
            });
            break;
        }
    }
    return symbols;
}

/**
 * An outline of the workspace: every code file with the functions, classes
 * and types it declares. It gives the agent a map before it reads anything.
 */
export class RepoMap {
    private index: RepoIndex = {};
    private readonly cacheFile: string;

    constructor(private readonly executor: ToolExecutor) {
        this.cacheFile = path.join(executor.root, ".yuvi", "cache", "repo-map.json");
    }

    /** Scan the workspace. Unchanged files are taken from the cache. */
    build(): void {
        let cached: RepoIndex = {};
        try {
            cached = JSON.parse(fs.readFileSync(this.cacheFile, "utf8")) as RepoIndex;
        } catch {
            cached = {};
        }

        const next: RepoIndex = {};
        let changed = false;
        const files = this.executor
            .listTextFiles(".")
            .filter((rel) => CODE_EXT.has(path.extname(rel).toLowerCase()))
            .slice(0, MAX_FILES);

        for (const rel of files) {
            const abs = path.join(this.executor.root, rel);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(abs);
            } catch {
                continue;
            }
            if (stat.size > MAX_FILE_BYTES) continue;
            const hit = cached[rel];
            if (hit && hit.mtime === stat.mtimeMs) {
                next[rel] = hit;
                continue;
            }
            try {
                const text = fs.readFileSync(abs, "utf8");
                next[rel] = {
                    mtime: stat.mtimeMs,
                    lines: text.split("\n").length,
                    symbols: outline(rel, text),
                };
                changed = true;
            } catch {
                // unreadable file: leave it out of the map
            }
        }

        if (Object.keys(cached).length !== Object.keys(next).length) changed = true;
        this.index = next;
        if (changed) {
            try {
                fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
                fs.writeFileSync(this.cacheFile, JSON.stringify(next), "utf8");
            } catch {
                // the cache is only an optimisation
            }
        }
    }

    get fileCount(): number {
        return Object.keys(this.index).length;
    }

    /** The map as text for the system prompt, cut to a character budget. */
    render(maxChars = 6000): string {
        const files = Object.entries(this.index).sort(([a], [b]) => a.localeCompare(b));
        if (!files.length) return "";
        const out: string[] = [];
        let used = 0;
        let omitted = 0;

        for (const [rel, entry] of files) {
            const exported = entry.symbols.filter((s) => s.exported);
            const shown = (exported.length ? exported : entry.symbols).slice(0, 14);
            const names = shown.map((s) => `${s.name}:${s.line}`).join(", ");
            const more =
                entry.symbols.length > shown.length
                    ? ` (+${entry.symbols.length - shown.length} more)`
                    : "";
            const line = `${rel} (${entry.lines} lines)${names ? ` — ${names}${more}` : ""}`;
            if (used + line.length + 1 > maxChars) {
                omitted++;
                continue;
            }
            out.push(line);
            used += line.length + 1;
        }
        if (omitted) {
            out.push(`… ${omitted} more code files not listed; use list_files / find_symbol.`);
        }
        return out.join("\n");
    }

    /** Where a symbol is declared, plus where it is used. */
    findSymbol(name: string): string {
        this.build();
        const wanted = name.trim();
        const lower = wanted.toLowerCase();
        const exact: string[] = [];
        const partial: string[] = [];

        for (const [rel, entry] of Object.entries(this.index)) {
            for (const s of entry.symbols) {
                const row = `${rel}:${s.line}  ${s.exported ? "export " : ""}${s.kind} ${s.name}`;
                if (s.name === wanted) exact.push(row);
                else if (s.name.toLowerCase().includes(lower)) partial.push(row);
            }
        }

        const sections: string[] = [];
        sections.push(
            exact.length
                ? `Definitions:\n${exact.join("\n")}`
                : "Definitions: none found by that exact name.",
        );
        if (!exact.length && partial.length) {
            sections.push(`Similar names:\n${partial.slice(0, 20).join("\n")}`);
        }

        const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const usages = this.executor.grep(`\\b${escaped}\\b`, ".", undefined, false, 60);
        sections.push(`Usages:\n${usages}`);
        return sections.join("\n\n");
    }
}
