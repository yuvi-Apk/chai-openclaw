/**
 * Keeps the dependency direction honest:
 *   core       imports nothing from modes or front ends
 *   a mode     imports the core and itself, never another mode or a front end
 *   front ends import the core and the mode registry only
 * and nothing outside core/config.ts reads the environment.
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

function sourceFiles(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(rel);
        return entry.name.endsWith(".ts") ? [rel] : [];
    });
}

/** Project-relative targets of the relative imports in a file. */
function localImports(file: string): string[] {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const targets: string[] = [];
    for (const match of text.matchAll(/from\s+"(\.[^"]+)"|import\("(\.[^"]+)"\)/g)) {
        const spec = match[1] ?? match[2]!;
        targets.push(path.relative(ROOT, path.resolve(ROOT, path.dirname(file), spec)).split(path.sep).join("/"));
    }
    return targets;
}

const violations = (files: string[], allowed: (file: string, target: string) => boolean) =>
    files.flatMap((file) => localImports(file).filter((target) => !allowed(file, target)).map((target) => `${file} -> ${target}`));

describe("dependency direction", () => {
    test("the core imports only the core", () => {
        expect(violations(sourceFiles("core"), (_file, target) => target.startsWith("core/"))).toEqual([]);
    });

    test("a mode imports only the core and itself", () => {
        const files = sourceFiles("modes").filter((file) => file.split("/").length > 2);
        const own = (file: string) => file.split("/").slice(0, 2).join("/") + "/";
        expect(violations(files, (file, target) => target.startsWith("core/") || target.startsWith(own(file)))).toEqual([]);
    });

    test("front ends import only the core, the mode registry and themselves", () => {
        expect(
            violations(
                sourceFiles("frontends"),
                (_file, target) => target.startsWith("core/") || target.startsWith("frontends/") || target === "modes/index",
            ),
        ).toEqual([]);
    });

    test("only core/config.ts reads the environment", () => {
        const readers = [...sourceFiles("core"), ...sourceFiles("modes"), ...sourceFiles("frontends"), "index.ts"].filter(
            (file) => file !== "core/config.ts" && /process\.env/.test(fs.readFileSync(path.join(ROOT, file), "utf8")),
        );
        expect(readers).toEqual([]);
    });
});
