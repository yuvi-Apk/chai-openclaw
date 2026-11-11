/**
 * The terminal front end's main menu. It lists whatever modes are
 * registered; it does not know any of them by name. Before the menu, a
 * user with no key is welcomed and logged in.
 */
import chalk from "chalk";
import { select, isCancel, log, outro } from "@clack/prompts";
import { Settings } from "../../core/config";
import type { ModeRegistry } from "../../core/mode";
import { ensureLoggedIn, loginStatus, logInTo, logOut } from "./login";
import { runModeSession } from "./session-loop";

const HELP = "__help__";
const LOGIN = "__login__";
const LOGOUT = "__logout__";
const EXIT = "__exit__";

/** Keep asking what to do until the user exits or cancels. */
export async function runTerminal(registry: ModeRegistry): Promise<void> {
    const settings = new Settings();
    await settings.loadKeys();
    if (!settings.keyVaultWorks) {
        log.warn("This computer has no credential vault yuvi can use, so keys are kept in ~/.yuvi/settings.json.");
    }
    const modes = registry.list({ includeHidden: settings.devMode });
    if (process.stdin.isTTY) await ensureLoggedIn(settings);

    const showHelp = () =>
        log.info(
            [
                chalk.bold("CLI mode commands"),
                ...modes.map((m) => `${chalk.cyan(m.label)}  - ${m.description}`),
                `${chalk.cyan("Log in")}  - pick an AI provider and paste its key`,
                `${chalk.cyan("Log out")}  - remove a saved key`,
                `${chalk.cyan("Help")}  - show this help`,
                `${chalk.cyan("Exit")}  - leave CLI mode (Ctrl+C / Esc also works)`,
            ].join("\n"),
        );

    while (true) {
        const picked = await select<string>({
            message: `What do you want to do? ${chalk.dim(`(${loginStatus(settings)})`)}`,
            options: [
                ...modes.map((m) => ({ value: m.name, label: m.label, hint: m.description })),
                { value: LOGIN, label: "Log in", hint: "pick a provider and paste its key" },
                { value: LOGOUT, label: "Log out", hint: "remove a saved key" },
                { value: HELP, label: "Help", hint: "see what you can do" },
                { value: EXIT, label: "Exit", hint: "go back to sleep" },
            ],
        });

        if (isCancel(picked) || picked === EXIT) break;
        if (picked === HELP) showHelp();
        else if (picked === LOGIN) await logInTo(settings, undefined, true);
        else if (picked === LOGOUT) await logOut(settings);
        else {
            const mode = registry.get(picked);
            if (!mode) continue;
            await runModeSession(mode);
            // The session may have switched provider or logged in; show the latest.
            await settings.loadKeys();
            log.step(chalk.gray("Back to the menu."));
        }
    }

    outro(chalk.gray("Going back to sleep. 😴"));
}
