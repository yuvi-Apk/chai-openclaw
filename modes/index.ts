/**
 * The list of modes. To add a mode: create its folder with a mode.ts that
 * exports a Mode, and add one register() line here. Nothing else changes.
 */
import { ModeRegistry } from "../core/mode";
import { agentMode } from "./agent/mode";
import { chatMode } from "./chat/mode";
import { echoMode } from "./echo/mode";

export const modes = new ModeRegistry()
    .register(agentMode("ask", { name: "agent", label: "Agent", description: "Run an agent" }))
    .register(agentMode("plan", { name: "plan", label: "Plan", description: "read-only: explore and plan, change nothing" }))
    .register(chatMode)
    .register(echoMode);
