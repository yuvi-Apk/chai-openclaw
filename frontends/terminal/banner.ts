import figlet from "figlet";
import chalk from "chalk";
import { intro, outro, select, isCancel, cancel } from "@clack/prompts";

const BANNER_FONT = "ANSI Shadow";
const BANNER_TEXT = "YUVI";

/** Where the user talks to yuvi from. */
export type Channel = "cli" | "telegram";

/** Draws the big ASCII banner with a top-to-bottom colour gradient. */

export function showBanner(): void {
    const art = figlet.textSync(BANNER_TEXT, { font: BANNER_FONT });
    const colors = [chalk.cyanBright, chalk.cyan, chalk.blueBright, chalk.blue, chalk.magentaBright, chalk.magenta];

    const lines = art.split("\n");
    lines.forEach((line, i) => {
        const paint = colors[Math.floor((i / lines.length) * colors.length)] ?? chalk.white;
        console.log(paint(line));
    });

    console.log(chalk.gray("  chai code · open claw · learn\n"));
}

/** Asks the user which mode to start in. Returns null if they cancel (Ctrl+C / Esc). */
export async function pickMode(): Promise<Channel | null> {
    intro(chalk.bgCyan.black(" yuvi is awake "));

    const mode = await select<Channel>({
        message: "How do you want to talk to yuvi?",
        options: [
            { value: "cli", label: "CLI", hint: "chat right here in the terminal" },
            { value: "telegram", label: "Telegram", hint: "chat through a Telegram bot" },
        ],
    });

    if (isCancel(mode)) {
        cancel("Going back to sleep. 😴");
        return null;
    }

    outro(chalk.green(`Starting ${mode === "cli" ? "CLI" : "Telegram"} mode...`));
    return mode;
}

/** The full wakeup flow: banner, then mode picker. */
export async function wakeup(): Promise<Channel | null> {
    showBanner();
    return pickMode();
}
