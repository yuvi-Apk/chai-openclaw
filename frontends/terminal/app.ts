/**
 * The terminal front end's main menu. It lists whatever modes are
 * registered; it does not know any of them by name.
 */
import chalk from "chalk";
import { select, isCancel, log, outro } from "@clack/prompts";
import { Settings } from "../../core/config";
import type { ModeRegistry } from "../../core/mode";
import { runModeSession } from "./session-loop";

const HELP = "__help__";
const EXIT = "__exit__";

/** Keep asking what to do until the user exits or cancels. */
export async function runTerminal(registry: ModeRegistry): Promise<void> {
    const modes = registry.list({ includeHidden: new Settings().devMode });

    const showHelp = () =>
        log.info(
            [
                chalk.bold("CLI mode commands"),
                ...modes.map((m) => `${chalk.cyan(m.label)}  - ${m.description}`),
                `${chalk.cyan("Help")}  - show this help`,
                `${chalk.cyan("Exit")}  - leave CLI mode (Ctrl+C / Esc also works)`,
            ].join("\n"),
        );

    while (true) {
        const picked = await select<string>({
            message: "What do you want to do?",
            options: [
                ...modes.map((m) => ({ value: m.name, label: m.label, hint: m.description })),
                { value: HELP, label: "Help", hint: "see what you can do" },
                { value: EXIT, label: "Exit", hint: "go back to sleep" },
            ],
        });

        if (isCancel(picked) || picked === EXIT) break;
        if (picked === HELP) {
            showHelp();
            continue;
        }

        const mode = registry.get(picked);
        if (!mode) continue;
        await runModeSession(mode);
        log.step(chalk.gray("Back to the menu."));
    }

    outro(chalk.gray("Going back to sleep. 😴"));
}
