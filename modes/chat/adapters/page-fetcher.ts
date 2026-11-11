/**
 * PageFetcher that downloads a web page and returns its readable text.
 * Every hop is checked against the URL safety rules, and time, size and
 * content type are limited, because the address comes from the open web.
 */
import { assertPublicUrl } from "../guardrails";
import type { PageFetcher } from "../interfaces";
import { htmlToText } from "./html";

/** A redirect can point anywhere, so each one is re-checked, up to this many. */
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; terminal-chat-reader/1.0)";

export interface PageFetcherOptions {
    timeoutMs: number;
    maxBytes: number;
    maxChars: number;
}

/** Read the body but stop once `maxBytes` have arrived. */
async function readLimited(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    return new TextDecoder("utf-8").decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

export class SafePageFetcher implements PageFetcher {
    constructor(private readonly options: PageFetcherOptions) {}

    async fetchText(rawUrl: string, signal?: AbortSignal): Promise<string> {
        const timeout = AbortSignal.timeout(this.options.timeoutMs);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

        let current = rawUrl;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const url = await assertPublicUrl(current);
            const response = await fetch(url, {
                redirect: "manual", // follow by hand so every hop is checked
                headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain" },
                signal: combined,
            });

            const location = response.headers.get("location");
            if (response.status >= 300 && response.status < 400 && location) {
                current = new URL(location, url).toString();
                continue;
            }
            if (!response.ok) throw new Error(`Page returned HTTP ${response.status}`);

            const type = response.headers.get("content-type") ?? "";
            if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
                throw new Error("Page is not readable text");
            }
            const raw = await readLimited(response, this.options.maxBytes);
            const text = /html/i.test(type) ? htmlToText(raw) : raw.trim();
            return text.slice(0, this.options.maxChars);
        }
        throw new Error("Too many redirects");
    }
}
