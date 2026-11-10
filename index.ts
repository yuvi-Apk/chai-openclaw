#!/usr/bin/env bun

import { Command } from "commander";
import { wakeup } from "./terminal-ui/wakeup";
import { runCliMode } from "./modes/cli";

const program = new Command();

program
    .name("yuvi")
    .description("chai code open claw learn")
    .version("0.0.1")

program
    .command('wakeup')
    .description("show the banner and pick cli or telegram mode.")
    .action(async () => {
        const mode = await wakeup();
        if (!mode) process.exit(0);

        // TODO: start Telegram mode once it's built
        if (mode === "cli") await runCliMode();
        else console.log("Telegram mode coming soon...");
    })

await program.parseAsync(process.argv)
