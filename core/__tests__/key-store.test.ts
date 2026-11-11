import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Settings } from "../config";
import { KeyRing, MemoryKeyStore, type KeyStore } from "../security/key-store";

const temps: string[] = [];
function tempFile(contents?: object): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuvi-keys-"));
    temps.push(dir);
    const file = path.join(dir, "settings.json");
    if (contents) fs.writeFileSync(file, JSON.stringify(contents));
    return file;
}
const readFile = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
afterEach(() => temps.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/** A vault that is not there, like Linux without a keyring service. */
const brokenStore: KeyStore = {
    get: async () => {
        throw new Error("no keyring service");
    },
    set: async () => {
        throw new Error("no keyring service");
    },
    delete: async () => {
        throw new Error("no keyring service");
    },
};

describe("key ring", () => {
    test("keeps, reads and forgets keys through the store", async () => {
        const store = new MemoryKeyStore();
        const ring = new KeyRing(store);
        expect(await ring.set("gemini", "gemini-key-123456")).toBe(true);
        expect(ring.get("gemini")).toBe("gemini-key-123456");
        const fresh = new KeyRing(store);
        await fresh.load(["gemini", "openai"]);
        expect(fresh.get("gemini")).toBe("gemini-key-123456");
        expect(fresh.get("openai")).toBe("");
        await fresh.delete("gemini");
        expect(await store.get("gemini")).toBeNull();
    });

    test("a vault that fails is marked unusable instead of throwing", async () => {
        const ring = new KeyRing(brokenStore);
        await ring.load(["openai"]);
        expect(ring.usable).toBe(false);
        expect(await ring.set("openai", "sk-whatever-123456")).toBe(false);
        expect(ring.get("openai")).toBe("");
    });
});

describe("settings with a key vault", () => {
    test("a key saved in the app goes to the vault, not the settings file", async () => {
        const file = tempFile();
        const store = new MemoryKeyStore();
        const settings = new Settings({ YUVI_LLM: "anthropic" }, file, store);
        await settings.saveApiKey("sk-ant-key-123456");
        expect(await store.get("anthropic")).toBe("sk-ant-key-123456");
        expect(fs.existsSync(file) ? readFile(file) : {}).toEqual({});
        expect(settings.keySource("anthropic")).toBe("vault");

        const later = new Settings({ YUVI_LLM: "anthropic" }, file, store);
        expect(later.apiKey).toBe("");
        await later.loadKeys();
        expect(later.apiKey).toBe("sk-ant-key-123456");
    });

    test("a key in an old settings file moves to the vault and leaves the file", async () => {
        const file = tempFile({ apiKey: "sk-or-old-key-123456", model: "vendor/kept" });
        const store = new MemoryKeyStore();
        const settings = new Settings({}, file, store);
        expect(settings.keySource("openrouter")).toBe("file");
        await settings.loadKeys();
        expect(await store.get("openrouter")).toBe("sk-or-old-key-123456");
        expect(readFile(file)).toEqual({ model: "vendor/kept" });
        expect(settings.apiKey).toBe("sk-or-old-key-123456");
        expect(settings.keySource("openrouter")).toBe("vault");
    });

    test(".env wins over the vault, and the vault over an old file value", async () => {
        const store = new MemoryKeyStore();
        await store.set("openai", "sk-vault-key-123456");
        const settings = new Settings({ YUVI_LLM: "openai", OPENAI_API_KEY: "sk-env-key-123456" }, tempFile(), store);
        await settings.loadKeys();
        expect(settings.apiKey).toBe("sk-env-key-123456");
        expect(settings.keySource("openai")).toBe("env");
        expect(settings.secrets()).toContain("sk-env-key-123456");
    });

    test("forgetting a key removes it from the vault and the file", async () => {
        const store = new MemoryKeyStore();
        const file = tempFile();
        const settings = new Settings({}, file, store);
        await settings.saveApiKey("gemini-key-123456", "gemini");
        await settings.forgetKey("gemini");
        expect(settings.hasKey("gemini")).toBe(false);
        expect(settings.keySource("gemini")).toBe("none");
        expect(await store.get("gemini")).toBeNull();
    });

    test("with no vault, keys fall back to the settings file", async () => {
        const file = tempFile();
        const settings = new Settings({}, file, brokenStore);
        await settings.loadKeys();
        expect(settings.keyVaultWorks).toBe(false);
        await settings.saveApiKey("sk-or-file-key-123456");
        expect(readFile(file)).toEqual({ apiKey: "sk-or-file-key-123456" });
        expect(settings.apiKey).toBe("sk-or-file-key-123456");
        await settings.forgetKey("openrouter");
        expect(settings.apiKey).toBe("");
        expect(readFile(file)).toEqual({});
    });

    test("a temp settings file never uses the real vault", async () => {
        const settings = new Settings({}, tempFile());
        await settings.saveApiKey("sk-or-test-only-123456");
        // Memory only: a second object with no shared store sees nothing.
        const other = new Settings({}, tempFile());
        await other.loadKeys();
        expect(other.apiKey).toBe("");
    });
});
