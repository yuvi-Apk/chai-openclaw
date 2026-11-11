import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSensitivePath, resolveInside } from "../security/path-safety";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-paths-")));
const root = path.join(base, "project");
const outside = path.join(base, "outside");
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.mkdirSync(outside);
fs.writeFileSync(path.join(root, "src", "app.ts"), "x");
fs.writeFileSync(path.join(outside, "secret.txt"), "s");
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("resolveInside", () => {
    test("accepts files in the folder, existing or not yet created", () => {
        expect(resolveInside(root, "src/app.ts")).toBe(path.join(root, "src", "app.ts"));
        expect(resolveInside(root, "uploads/new/file.txt")).toBe(path.join(root, "uploads", "new", "file.txt"));
    });

    test("refuses anything that lands outside the folder", () => {
        expect(resolveInside(root, "../outside/secret.txt")).toBeNull();
        expect(resolveInside(root, "src/../../outside/secret.txt")).toBeNull();
        expect(resolveInside(root, path.join(outside, "secret.txt"))).toBeNull();
        expect(resolveInside(root, "")).toBeNull();
        expect(resolveInside(root, ".")).toBeNull();
        expect(resolveInside(root, "src/a\0b")).toBeNull();
    });

    test("refuses a path that leaves the folder through a link", () => {
        const link = path.join(root, "escape");
        try {
            fs.symlinkSync(outside, link, "junction");
        } catch {
            return; // links are not available on this machine
        }
        expect(resolveInside(root, "escape/secret.txt")).toBeNull();
        expect(resolveInside(root, "escape/new.txt")).toBeNull();
    });
});

describe("isSensitivePath", () => {
    test("flags key, credential and settings files anywhere in the path", () => {
        for (const file of [".env", ".env.local", "config/.env", "certs/server.pem", "id_rsa", ".ssh/known_hosts", ".git/config", ".yuvi/settings.json", "deploy.key", "secrets.json", ".npmrc"]) {
            expect([file, isSensitivePath(file)]).toEqual([file, true]);
        }
    });

    test("leaves ordinary files alone", () => {
        for (const file of ["src/app.ts", "README.md", "environment.ts", ".yuvi/config.json", "docs/keys.md", "uploads/photo.png"]) {
            expect([file, isSensitivePath(file)]).toEqual([file, false]);
        }
    });
});
