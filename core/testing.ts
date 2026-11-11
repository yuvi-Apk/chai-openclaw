/**
 * Test doubles shared by every test suite: a host that records what a mode
 * emits and answers its questions, a scripted model, and a screen capture.
 * It is also the smallest possible front end, so it shows what a front end
 * has to provide.
 */
import { createCore, type Core } from "./compose";
import { Settings } from "./config";
import type { LLMClient, LLMRequest, LLMResponse } from "./llm/types";
import {
    grantTools,
    lineText,
    type Choice,
    type ConfirmReply,
    type ConfirmRequest,
    type ModeEvent,
    type ModeHost,
    type ToolPermission,
} from "./mode";

/** Settings with no environment and no saved file, so tests see only defaults. */
export const testSettings = (env: Record<string, string> = {}) => new Settings(env, null);

/** A model that replies with whatever the given function returns, and records every call. */
export class FakeLLM implements LLMClient {
    readonly calls: LLMRequest[] = [];

    constructor(private readonly reply: (request: LLMRequest, callNumber: number) => string) {}

    async complete(request: LLMRequest): Promise<LLMResponse> {
        this.calls.push(request);
        return { text: this.reply(request, this.calls.length), inputTokens: 100, outputTokens: 20, cost: 0 };
    }

    async stream(request: LLMRequest, onToken: (token: string) => void): Promise<LLMResponse> {
        const response = await this.complete(request);
        // Send the text in small pieces, like a real stream.
        for (const piece of response.text.match(/.{1,5}/gs) ?? []) onToken(piece);
        return response;
    }
}

export interface RecordingHostOptions {
    core?: Core;
    modeName?: string;
    grants?: readonly ToolPermission[];
    workspace?: string;
    interactive?: boolean;
    /** How to answer a confirmation. The default accepts everything. */
    confirm?: (request: ConfirmRequest) => ConfirmReply;
    choose?: (question: string, choices: Choice[]) => string | null;
    ask?: (question: string) => string | null;
    /** Also called for every event, e.g. to feed a renderer. */
    onEvent?: (event: ModeEvent) => void;
}

export interface RecordingHost extends ModeHost {
    readonly events: ModeEvent[];
    readonly confirmations: ConfirmRequest[];
    /** The events of one type. */
    of<T extends ModeEvent["type"]>(type: T): Extract<ModeEvent, { type: T }>[];
    /** The streamed answer text. */
    answerText(): string;
    /** Notices and lines as plain text, one per entry. */
    messages(): string[];
}

const acceptAll = (request: ConfirmRequest): ConfirmReply =>
    request.kind === "changes" ? { approved: request.groups.map((g) => g.id) } : { approved: ["run"] };

/** A front end without a screen: it records events and answers from a script. */
export function createRecordingHost(options: RecordingHostOptions = {}): RecordingHost {
    const grants = options.grants ?? ["web.search", "web.fetch", "fs.read", "fs.write", "shell"];
    const core = grantTools(options.core ?? createCore(testSettings()), options.modeName ?? "test", grants);
    const events: ModeEvent[] = [];
    const confirmations: ConfirmRequest[] = [];

    return {
        core,
        grants,
        ...(options.workspace ? { workspace: options.workspace } : {}),
        interactive: options.interactive ?? true,
        events,
        confirmations,
        emit: (event) => {
            events.push(event);
            options.onEvent?.(event);
        },
        confirm: async (request) => {
            confirmations.push(request);
            return (options.confirm ?? acceptAll)(request);
        },
        choose: async (question, choices) =>
            (options.choose ? options.choose(question, choices) : (choices[0]?.value ?? null)) as never,
        ask: async (question) => (options.ask ? options.ask(question) : null),
        of: (type) => events.filter((e) => e.type === type) as never,
        answerText: () =>
            events
                .filter((e): e is Extract<ModeEvent, { type: "token" }> => e.type === "token")
                .map((e) => e.text)
                .join(""),
        messages: () =>
            events.flatMap((e) =>
                e.type === "notice" ? [e.text] : e.type === "line" ? [lineText(e.line)] : [],
            ),
    };
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Remove colour and cursor codes, so tests compare the words only. */
export const plain = (text: string) => text.replace(ANSI, "");

/**
 * Run `fn` with the terminal switched off and collect everything it prints
 * through process.stdout and console.log.
 */
export async function captureOutput(fn: () => unknown | Promise<unknown>): Promise<string> {
    const chunks: string[] = [];
    const stdout = process.stdout as unknown as { write: unknown; isTTY?: boolean };
    const stdin = process.stdin as unknown as { isTTY?: boolean };
    const saved = { write: stdout.write, log: console.log, outTty: stdout.isTTY, inTty: stdin.isTTY };

    stdout.write = (chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
    };
    console.log = (...args: unknown[]) => void chunks.push(args.join(" ") + "\n");
    stdout.isTTY = false;
    stdin.isTTY = false;
    try {
        await fn();
    } finally {
        stdout.write = saved.write;
        console.log = saved.log;
        stdout.isTTY = saved.outTty;
        stdin.isTTY = saved.inTty;
    }
    return plain(chunks.join(""));
}
