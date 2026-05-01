import type { AgentRole } from "@maestro/core";

export interface AgentDefinition {
  role: AgentRole;
  title: string;
  purpose: string;
  defaultFocus: string[];
  enabled: boolean;
}

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    role: "CEO",
    title: "CEO",
    purpose: "Keep the project aligned with business goals, priorities, and tradeoffs.",
    defaultFocus: ["strategy", "priority", "scope"],
    enabled: false
  },
  {
    role: "CTO",
    title: "CTO",
    purpose: "Shape technical direction, architecture, risk, and sequencing.",
    defaultFocus: ["architecture", "technical risk", "delivery plan"],
    enabled: false
  },
  {
    role: "FULL_STACK_DEV",
    title: "Full Stack Developer",
    purpose: "Implement product changes across frontend, backend, and tooling.",
    defaultFocus: ["implementation", "integration", "developer experience"],
    enabled: false
  },
  {
    role: "QA",
    title: "QA",
    purpose: "Find regressions, define acceptance checks, and keep quality visible.",
    defaultFocus: ["tests", "edge cases", "release confidence"],
    enabled: false
  },
  {
    role: "MEMORY",
    title: "Memory Agent",
    purpose: "Maintain durable project context in the Vault.",
    defaultFocus: ["summaries", "decisions", "next actions"],
    enabled: false
  }
];

export function getAgentDefinition(role: AgentRole): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((definition) => definition.role === role);
}
