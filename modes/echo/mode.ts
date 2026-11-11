/**
 * The smallest possible mode, kept as a working example for the guide
 * "How to add a new mode" (docs/adding-a-mode.md). It repeats what you
 * type. It is hidden from the menu unless YUVI_DEV=1 is set.
 */
import type { Mode, ModeHost, ModeSession } from "../../core/mode";

class EchoSession implements ModeSession {
    private count = 0;

    constructor(private readonly host: ModeHost) {}

    async handle(input: string): Promise<void> {
        this.count++;
        const reply = `You said: ${input}`;
        this.host.emit({ type: "status", text: "Echoing" });
        this.host.emit({ type: "token", text: reply, end: true });
        this.host.emit({ type: "answer", text: reply, kind: "answer" });
        this.host.emit({ type: "summary", parts: [`message ${this.count}`] });
    }

    commands() {
        return [
            {
                name: "/count",
                label: "Show message count",
                hint: "how many messages were echoed",
                run: () => this.host.emit({ type: "notice", level: "note", text: `Echoed ${this.count} so far.` }),
            },
        ];
    }

    welcome() {
        return ["", { text: "  echo", tone: "title" as const }, "  Type anything and it comes back."];
    }

    help() {
        return ["Echo mode repeats what you type. It uses no model and no tools."];
    }

    status() {
        return { label: "Echo", detail: "", tone: "accent" as const };
    }

    async close(): Promise<void> {
        // Nothing to clean up.
    }
}

export const echoMode: Mode = {
    name: "echo",
    label: "Echo",
    description: "example mode: repeats what you type",
    tools: [],
    hidden: true,
    commandStyle: "typed",
    createSession: (host) => new EchoSession(host),
};
