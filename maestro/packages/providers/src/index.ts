import type { ProviderProfile } from "@maestro/core";

export * from "./openclaude-doctor";
export * from "./kiro-cli-doctor";
export * from "./grouter-doctor";
export * from "./grouter-connections";
export * from "./openclaude-grouter-doctor";
export * from "./auth-parser";
export * from "./auth-session";
export * from "./command-runner";
export * from "./openclaude-home";

export const PROVIDER_INTEGRATION_STATUS = "planned";

export function createMockProviderProfile(now = new Date().toISOString()): ProviderProfile {
  return {
    id: "mock-local",
    name: "Mock Local Provider",
    kind: "mock",
    enabled: false,
    notes: "Placeholder profile for future provider abstractions. MVP 1 does not call models.",
    createdAt: now,
    updatedAt: now
  };
}
