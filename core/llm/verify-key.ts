/**
 * Check that a pasted key works before it is saved: one tiny model call with
 * that key, through the same client every mode uses. Nothing is saved here.
 */
import { createCore, type Core } from "../compose";
import { Settings } from "../config";
import { classifyError, errorText, type ErrorKind } from "../errors";
import { profileFor } from "./profiles";

/** Long enough for a slow first reply, short enough not to leave the user waiting. */
const VERIFY_TIMEOUT_MS = 20_000;
/** The reply is thrown away; a few tokens keep the check almost free. */
const VERIFY_MAX_TOKENS = 16;

/** What the check found. A failure carries the kind, so a front end can word it. */
export type KeyCheck = { ok: true } | { ok: false; kind: ErrorKind };

/** Builds the services for the throwaway settings; tests pass one with a fake model. */
export type CoreMaker = (settings: Settings) => Pick<Core, "llm">;

/** Send one short message with this key and the provider's main model. */
export async function verifyKey(
    settings: Settings,
    provider: string,
    key: string,
    makeCore: CoreMaker = createCore,
): Promise<KeyCheck> {
    const profile = profileFor(provider);
    const model = settings.modelId("main", provider);
    // In memory only: no file, no vault, and this key alone.
    const trial = new Settings({ YUVI_LLM: provider, [profile.keyEnv]: key, [profile.modelEnv]: model }, null);
    try {
        await makeCore(trial).llm.complete({
            model,
            messages: [{ role: "user", content: "Reply with the word OK." }],
            maxTokens: VERIFY_MAX_TOKENS,
            timeoutMs: VERIFY_TIMEOUT_MS,
        });
        return { ok: true };
    } catch (error) {
        return { ok: false, kind: classifyError(errorText(error)) };
    }
}
