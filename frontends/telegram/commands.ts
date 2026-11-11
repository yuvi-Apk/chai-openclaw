/**
 * Commands the Telegram front end adds to every mode. Adding one is one
 * entry in this list; the controller does the work.
 */
import type { ChatController } from "./chat-controller";

export interface FrontCommand {
    /** With the slash: "/stop". */
    name: string;
    description: string;
    /** May be used while a turn is running. */
    whileRunning?: boolean;
    /** Left out of the command list Telegram shows. */
    hidden?: boolean;
    run(chat: ChatController, arg: string): Promise<void> | void;
}

export const FRONT_COMMANDS: FrontCommand[] = [
    { name: "/start", description: "say hello and pick a mode", run: (chat) => chat.showMenu() },
    { name: "/menu", description: "pick a mode: Agent, Plan, Chat", run: (chat) => chat.showMenu() },
    { name: "/exit", description: "leave the current mode", run: (chat) => chat.showMenu() },
    { name: "/open", description: "open a mode by name", hidden: true, run: (chat, arg) => chat.openMode(arg) },
    { name: "/stop", description: "stop what yuvi is doing", whileRunning: true, run: (chat) => chat.stop() },
    { name: "/cancel", description: "cancel a question", whileRunning: true, hidden: true, run: (chat) => chat.cancelQuestions() },
    { name: "/cycle", description: "switch to the next sub-mode", run: (chat) => chat.cycle() },
    { name: "/thinking", description: "show or hide the thinking: /thinking on|off", whileRunning: true, run: (chat, arg) => chat.setThinking(arg) },
    { name: "/model", description: "change the AI model", run: (chat) => chat.changeModel() },
    { name: "/project", description: "switch project folder", run: (chat) => chat.chooseProject() },
    { name: "/file", description: "get a project file: /file <path>", whileRunning: true, run: (chat, arg) => chat.sendFile(arg) },
    { name: "/key", description: "why keys are not set here", hidden: true, run: (chat) => chat.refuseKey() },
    { name: "/help", description: "what you can do here", whileRunning: true, run: (chat) => chat.showHelp() },
];

/** Commands the router handles itself, listed here so help and the command list show them. */
export const LOCK_COMMANDS = [
    { name: "/lock", description: "lock the bot now" },
    { name: "/unlock", description: "unlock with your PIN" },
];

/** Split "/undo@my_bot some text" into the command name and its argument. */
export function parseCommand(text: string): { name: string; arg: string } {
    const [head = "", ...rest] = text.trim().split(/\s+/);
    return { name: head.split("@")[0]!.toLowerCase(), arg: rest.join(" ") };
}
