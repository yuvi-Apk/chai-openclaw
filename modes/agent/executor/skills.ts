/**
 * Skills: SKILL.md files the user installed for coding agents. The agent may
 * list them and read them, but only from the known skill folders.
 */
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

/** The folders skills are looked for in: the user's extra ones, then the usual two. */
export function skillRoots(extraDirs: string[]): string[] {
    return [
        ...extraDirs,
        path.join(homedir(), ".cursor/skills-cursor"),
        path.join(homedir(), ".claude/skills"),
    ];
}

/** Absolute paths of every SKILL.md under the skill roots. */
export function findSkillFiles(roots: string[]): string[] {
    const files: string[] = [];
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        const walk = (dir: string) => {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) walk(full);
                else if (ent.name === "SKILL.md") files.push(full);
            }
        };
        try {
            walk(root);
        } catch {
            // unreadable skill folder: skip it
        }
    }
    return files.sort();
}

/** Read one skill file. A path outside the skill roots is refused. */
export function readSkillFile(skillPath: string, roots: string[], workspace: string): { path: string; text: string } {
    const abs = path.isAbsolute(skillPath)
        ? path.normalize(skillPath)
        : path.normalize(path.resolve(workspace, skillPath));
    const allowed = roots.some((root) => {
        const r = path.resolve(root);
        return abs === r || abs.startsWith(r + path.sep);
    });
    if (!allowed) throw new Error("read_skill: outside skill roots");
    return { path: abs, text: fs.readFileSync(abs, "utf8") };
}
