#!/usr/bin/env bun

import { Command } from "commander";


const program = new Command();

program
    .name("yuvi")
    .description("chai code open claw learn")
    .version("0.0.1")

program
    .command('wakeup')
    .description("show the banner and pick cli or telegram mode.")
    .action(()=>{
        console.log("wakeup is calling....")
    })

    await program.parseAsync(process.argv)