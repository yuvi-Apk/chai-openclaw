import { isCancel, log, text } from "@clack/prompts";
import chalk from "chalk";
import { defaultAgentConfig } from "./types";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { stepCountIs, ToolLoopAgent } from "ai";
import { getAgentModel } from "../../ai";
import { renderTerminalMarkdown } from "../../terminal-ui/terminal-md";
import { runApprovalFlow } from "./approval";


export async function runAgentMode() {
    log.step(chalk.gray("Running agent mode..."));

    const message = await text({
        message: "You:",
        placeholder: "type something to yuvi...",
        validate: (value) => (!value || !value.trim() ? "Say something first!" : undefined),
    });

    if (message == "exit") return false;

    if (isCancel(message)) return false;

    const config = defaultAgentConfig();

    const tracker = new ActionTracker();

    const executor = new ToolExecutor(config, tracker);

    const tools = createAgentTools(executor);

    const agent = new ToolLoopAgent({
        model: getAgentModel(),
        stopWhen: stepCountIs(10),
        instructions: [
            `workspace root: ${config.codebasePath}`,
            "All mutations (file/folder creation, modification, deletion) must be approved by the user before they are applied.",
        ].join("\n"),
        tools,
    })

    const result = await agent.generate({
        prompt: message.trim(),
        onStepFinish: ({ toolCalls }) => {
            for (const tc of toolCalls) {
                const preview = JSON.stringify(tc.input).slice(0, 160);
                console.log(
                    chalk.green("  ✓"),
                    chalk.bold(String(tc.toolName)),
                    chalk.dim(preview + (preview.length >= 160 ? "..." : "")),
                );
            }
        },
    });

    if (result.text?.trim()) console.log(renderTerminalMarkdown(result.text));

    const ok = await runApprovalFlow(tracker);
    if (!ok) return executor.clearStaging();

    const { errors } = executor.applyApprovedFromTracker();

    if (errors.length) {
        console.log(chalk.red("\nSome operations reported errors:\n"));
        for (const e of errors) console.log(chalk.red(`  • ${e}`));
    }
    else {
        console.log(chalk.green('\n✓ Applied.\n'));
    }

    executor.clearStaging()
}