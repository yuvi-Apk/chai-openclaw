/** Keeping file access inside one folder, and away from files that hold secrets. */
import fs from "node:fs";
import path from "node:path";

/** File and folder names that must never be sent out or overwritten from outside. */
const SENSITIVE_PATTERNS: RegExp[] = [
    /^\.env(\..*)?$/i,
    /\.(pem|key|pfx|p12|keystore)$/i,
    /^id_(rsa|dsa|ecdsa|ed25519)/i,
    /^\.(git|ssh|aws|gnupg)$/i,
    /^\.(npmrc|netrc|pypirc)$/i,
    /^(credentials|secrets?)(\..*)?$/i,
];

/** The real location of a path, following links, even when its last parts do not exist yet. */
function realPath(target: string): string {
    const missing: string[] = [];
    let current = target;
    while (true) {
        try {
            return path.join(fs.realpathSync(current), ...missing.reverse());
        } catch {
            const parent = path.dirname(current);
            if (parent === current) return target;
            missing.push(path.basename(current));
            current = parent;
        }
    }
}

/**
 * The absolute path of `relative` inside `root`, or null when it would land
 * outside it, whether through "..", an absolute path or a symbolic link.
 */
export function resolveInside(root: string, relative: string): string | null {
    if (!relative.trim() || relative.includes("\0")) return null;
    const realRoot = realPath(path.resolve(root));
    const target = realPath(path.resolve(realRoot, relative));
    const offset = path.relative(realRoot, target);
    if (offset === "" || offset.startsWith("..") || path.isAbsolute(offset)) return null;
    return target;
}

/** True when any part of the path names a key, credential or settings file. */
export function isSensitivePath(filePath: string): boolean {
    const parts = filePath.split(/[\\/]+/).filter(Boolean);
    const yuviSettings = parts.some((part, i) => part === ".yuvi" && parts[i + 1] === "settings.json");
    return yuviSettings || parts.some((part) => SENSITIVE_PATTERNS.some((pattern) => pattern.test(part)));
}
