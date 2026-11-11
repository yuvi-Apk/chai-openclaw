#!/usr/bin/env bun

import { Command } from "commander";
import { wakeup } from "./frontends/terminal/banner";
import { runTerminal } from "./frontends/terminal/app";
import { runTelegram } from "./frontends/telegram/app";
import { modes } from "./modes";

const program = new Command();

program
    .name("yuvi")
    .description("chai code open claw learn")
    .version("0.0.1")

program
    .command('wakeup')
    .description("show the banner and pick cli or telegram mode.")
    .action(async () => {
        const channel = await wakeup();
        if (!channel) process.exit(0);

        if (channel === "cli") await runTerminal(modes);
        else await runTelegram(modes);
    })

program
    .command("telegram")
    .description("start the Telegram bot directly, without the menu.")
    .action(async () => {
        await runTelegram(modes);
    })

await program.parseAsync(process.argv)
