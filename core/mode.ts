/**
 * The contract between modes and front ends.
 *
 * A mode (agent, chat, ...) holds the logic. A front end (terminal today,
 * Telegram later) reads input and shows output. They only meet here: the
 * front end gives a mode a ModeHost, and the mode reports everything it
 * does as ModeEvents. Neither knows how the other works inside.
 */
import type { Core } from "./compose";
import { ToolError } from "./errors";

// ---------- what a mode may use ----------

/** Capabilities a mode must declare before it gets them. */
export type ToolPermission = "web.search" | "web.fetch" | "fs.read" | "fs.write" | "shell";

/**
 * The core as one mode is allowed to see it: web search and page reading
 * are refused unless the mode declared them.
 */
export function grantTools(core: Core, modeName: string, granted: readonly ToolPermission[]): Core {
    const refuse = (tool: ToolPermission): never => {
        throw new ToolError(`Mode "${modeName}" did not declare the "${tool}" permission.`);
    };
    return {
        settings: core.settings,
        log: core.log,
        get models() {
            return core.models;
        },
        get llm() {
            return core.llm;
        },
        get search() {
            return granted.includes("web.search") ? core.search : refuse("web.search");
        },
        get pages() {
            return granted.includes("web.fetch") ? core.pages : refuse("web.fetch");
        },
    };
}

// ---------- output: events ----------

/** Emphasis a front end can show in its own way (colour, bold, or not at all). */
export type Tone = "strong" | "dim" | "accent" | "title" | "good" | "warn" | "bad" | "info";
export type Span = string | { text: string; tone: Tone };
/** One line of text, plain or made of spans with emphasis. */
export type Line = Span | Span[];

export interface TodoItem {
    content: string;
    status: "pending" | "in_progress" | "completed";
}

export interface SourceItem {
    n: number;
    title: string;
    url: string;
    date?: string;
}

/** Everything a mode can tell the front end while it handles a message. */
export type ModeEvent =
    /** What the mode is doing right now, e.g. "Searching (2 queries)". */
    | { type: "status"; text: string }
    /** A model step began or ended (an agent takes many steps per message). */
    | { type: "step"; phase: "start" | "end" }
    /** A piece of the model's thinking. `end` closes the thinking block. */
    | { type: "reasoning"; text: string; end?: boolean }
    /** A piece of the answer. `end` means the answer text is complete. */
    | { type: "token"; text: string; end?: boolean }
    /** A tool call started. `silent` calls are not listed, only their status shows. */
    | { type: "tool"; phase: "call"; id: string; title: string; detail: string; silent?: boolean }
    /** A tool call finished, with a one-line summary of what it returned. */
    | { type: "tool"; phase: "result" | "error"; id: string; summary: string }
    /** A progress line from a helper, e.g. a sub-agent. */
    | { type: "progress"; tag: string; text: string }
    | { type: "notice"; level: "note" | "success" | "failure"; text: string }
    /** A ready-made line of output. */
    | { type: "line"; line: Line }
    | { type: "todos"; items: TodoItem[] }
    | { type: "sources"; items: SourceItem[] }
    /** The complete reply, for front ends that do not stream. "clarify" is a question back. */
    | { type: "answer"; text: string; kind: "answer" | "clarify" }
    /** Running totals, for a live display. */
    | { type: "usage"; tokens: number; contextPercent?: number }
    /** The closing line of a turn: where the answer came from and what it cost. */
    | { type: "summary"; parts: string[] }
    /** A failure, as raw text. The front end words it for the user. */
    | { type: "error"; message: string; hint?: string };

// ---------- input: questions back to the user ----------

export interface ChangeGroup {
    id: string;
    label: string;
    /** Unified diff, or null when there is nothing to show (a new folder). */
    patch: string | null;
}

export type ConfirmRequest =
    /** Staged file changes. With `auto`, they are shown and accepted without asking. */
    | { kind: "changes"; groups: ChangeGroup[]; auto: boolean }
    /** A shell command. `rememberAs` offers "don't ask again for this kind of command". */
    | { kind: "command"; command: string; rememberAs?: string };

export interface ConfirmReply {
    /** For changes: the ids of the accepted groups. For a command: [] or ["run"]. */
    approved: string[];
    /** For a command: the user chose "don't ask again". */
    remember?: boolean;
}

export interface Choice<T extends string = string> {
    value: T;
    label: string;
    hint?: string;
}

/** What a front end provides to a mode session. */
export interface ModeHost {
    /** Shared services, limited to the tools the mode declared. */
    readonly core: Core;
    readonly grants: readonly ToolPermission[];
    /** The project folder, when the front end has one. */
    readonly workspace?: string;
    /** False when nobody can answer questions (piped input, a batch job). */
    readonly interactive: boolean;
    emit(event: ModeEvent): void;
    /** Ask the user to accept changes or a command. */
    confirm(request: ConfirmRequest): Promise<ConfirmReply>;
    /** Pick one of a few options. Null when the user backs out. */
    choose<T extends string>(question: string, choices: Choice<T>[], initial?: T): Promise<T | null>;
    /** Ask for a line of text. Null when the user backs out. */
    ask(question: string): Promise<string | null>;
}

// ---------- the mode itself ----------

/** What a command can ask the front end to do next. */
export type CommandOutcome = void | "exit" | { submit: string };

/** Something the user can do besides sending a message: "/new", "Undo last change". */
export interface ModeCommand {
    /** The typed form, with the slash: "/new". */
    name: string;
    /** The menu form: "Start a new conversation". */
    label: string;
    hint: string;
    /** The command is followed by text, e.g. "/search <question>". */
    takesArg?: boolean;
    run(arg: string): Promise<CommandOutcome> | CommandOutcome;
}

export interface ModeStatus {
    label: string;
    detail: string;
    tone: Tone;
}

/** A picture sent along with a message, e.g. a screenshot. */
export interface ImageInput {
    /** "image/jpeg", "image/png". */
    mediaType: string;
    data: Uint8Array;
}

export interface HandleOptions {
    signal: AbortSignal;
    /** Only given to modes that set `acceptsImages`. */
    images?: ImageInput[];
}

/** One conversation with a mode. Sessions share nothing with each other. */
export interface ModeSession {
    /** Handle one user message. Everything shown goes through host.emit. */
    handle(input: string, options: HandleOptions): Promise<void>;
    commands(): ModeCommand[];
    /** Shown when the session starts, and when the user asks for help. */
    welcome(): Line[];
    help(): Line[];
    /** A short state line, e.g. which sub-mode is active. */
    status(): ModeStatus;
    /** Workspace files the user can mention with "@". */
    files?(): string[];
    /** Switch to the next sub-mode (Ask, Auto, Plan). */
    cycle?(): void;
    /** A message typed while a turn is running. */
    steer?(text: string): void;
    /** Finish up: settle anything pending and release resources. */
    close(): Promise<void>;
}

export interface Mode {
    /** Unique id used to pick the mode: "agent", "chat". */
    name: string;
    label: string;
    description: string;
    /** The tools this mode needs. It gets nothing it did not list. */
    tools: readonly ToolPermission[];
    /** Hidden from menus unless developer mode is on. */
    hidden?: boolean;
    /** A hint for front ends: commands are picked from a menu or typed as "/name". */
    commandStyle?: "menu" | "typed";
    /** Text shown in an empty input box. */
    placeholder?: string;
    /** The mode can look at pictures sent with a message. */
    acceptsImages?: boolean;
    createSession(host: ModeHost): ModeSession;
}

/** The list of available modes. Adding a mode is one register() call. */
export class ModeRegistry {
    private readonly modes = new Map<string, Mode>();

    register(mode: Mode): this {
        if (this.modes.has(mode.name)) throw new Error(`Mode "${mode.name}" is already registered.`);
        this.modes.set(mode.name, mode);
        return this;
    }

    get(name: string): Mode | undefined {
        return this.modes.get(name);
    }

    /** Modes in the order they were registered. Hidden ones only when asked for. */
    list(options: { includeHidden?: boolean } = {}): Mode[] {
        return [...this.modes.values()].filter((mode) => options.includeHidden || !mode.hidden);
    }
}

/** Plain text of a line, for front ends without styling and for tests. */
export function lineText(line: Line): string {
    const spans = Array.isArray(line) ? line : [line];
    return spans.map((span) => (typeof span === "string" ? span : span.text)).join("");
}
