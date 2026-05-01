import type { AgentAdapterProfile } from "@maestro/core";

export function createDefaultAgentAdapterProfiles(now = new Date().toISOString()): AgentAdapterProfile[] {
  return [
    {
      id: "codex-supervisor",
      name: "Codex Supervisor",
      type: "CODEX_SUPERVISOR",
      role: "SUPERVISOR",
      enabled: false,
      config: {},
      createdAt: now,
      updatedAt: now
    },
    {
      id: "kiro-executor",
      name: "Kiro Executor",
      type: "KIRO_EXECUTOR",
      role: "EXECUTOR",
      enabled: false,
      config: {},
      createdAt: now,
      updatedAt: now
    },
    {
      id: "manual-memory-manager",
      name: "Manual Memory Manager",
      type: "MANUAL",
      role: "MEMORY_MANAGER",
      enabled: true,
      config: {},
      createdAt: now,
      updatedAt: now
    }
  ];
}
