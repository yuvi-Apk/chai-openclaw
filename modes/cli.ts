import chalk from "chalk";

import { select, text, isCancel, log, outro } from "@clack/prompts";
import { runAgentMode } from "./agent/orchestrator";

type CliAction = "agent" | "plan" | "chat" | "help" | "exit";

/** Asks for one message and replies. Returns false if the user cancels. */
async function chatOnce(): Promise<boolean> {
    const message = await text({
        message: "You:",
        placeholder: "type something to yuvi...",
        validate: (value) => (!value || !value.trim() ? "Say something first!" : undefined),
    });

    if(message == "exit")return false;

    if (isCancel(message)) return false;

    // TODO: replace this echo with a real AI reply once the brain is wired in
    log.message(chalk.cyan(`yuvi: you said "${message.trim()}"`));
    return true;
}

function showHelp(): void {
    log.info(
        [
            chalk.bold("CLI mode commands"),
            `${chalk.cyan("Agent")}  - Agent`,
            `${chalk.cyan("plan")}  - Plan mode`,
            `${chalk.cyan("Chat")}  - send a message to yuvi`,
            `${chalk.cyan("Help")}  - show this help`,
            `${chalk.cyan("Exit")}  - leave CLI mode (Ctrl+C / Esc also works)`,
        ].join("\n"),
    );
}

/** The main CLI loop: keep asking what to do until the user exits or cancels. */
export async function runCliMode(): Promise<void> {
    while (true) {
        const action = await select<CliAction>({
            message: "What do you want to do?",
            options: [
                { value: "agent", label: "Agent", hint: "Run an agent" },
                { value: "plan", label: "Plan", hint: "Plan mode" },

                { value: "chat", label: "Chat", hint: "talk to yuvi" },

                { value: "help", label: "Help", hint: "see what you can do" },
                { value: "exit", label: "Exit", hint: "go back to sleep" },
            ],
        });

        if (isCancel(action) || action === "exit") {
            break;
        }

        if (action === "help") {
            showHelp();
            continue;
        }

        if (action === "agent") {
            await runAgentMode();
        }

        if (action === "plan") {
            console.log("plan mode")
        }

        // Chat: keep chatting until the user cancels, then return to the menu
        while (await chatOnce()) { }
        log.step(chalk.gray("Back to the menu."));
    }

    outro(chalk.gray("Going back to sleep. 😴"));
}
