import chalk from "chalk";

import { select, isCancel, log, outro } from "@clack/prompts";
import { runAgentMode } from "./agent/orchestrator";
import { runChatMode } from "./chat/terminal";

type CliAction = "agent" | "plan" | "chat" | "help" | "exit";

function showHelp(): void {
    log.info(
        [
            chalk.bold("CLI mode commands"),
            `${chalk.cyan("Agent")}  - Agent`,
            `${chalk.cyan("plan")}  - Plan mode`,
            `${chalk.cyan("Chat")}  - ask questions; yuvi searches the web when it needs fresh facts`,
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
                { value: "plan", label: "Plan", hint: "read-only: explore and plan, change nothing" },

                { value: "chat", label: "Chat", hint: "ask questions, with web search when needed" },

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
            continue;
        }

        if (action === "plan") {
            // Same agent, read-only: it explores and writes a plan.
            await runAgentMode({ mode: "plan" });
            continue;
        }

        // Chat: questions and answers, with a web search when it is needed.
        await runChatMode();
        log.step(chalk.gray("Back to the menu."));
    }

    outro(chalk.gray("Going back to sleep. 😴"));
}
