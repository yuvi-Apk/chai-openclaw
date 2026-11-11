#!/usr/bin/env bun

import { Command } from "commander";
import { wakeup } from "./frontends/terminal/banner";
import { runTerminal } from "./frontends/terminal/app";
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

        // TODO: start the Telegram front end once it's built
        if (channel === "cli") await runTerminal(modes);
        else console.log("Telegram mode coming soon...");
    })

await program.parseAsync(process.argv)
