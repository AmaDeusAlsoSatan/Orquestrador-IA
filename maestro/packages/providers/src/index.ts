import type { ProviderProfile } from "@maestro/core";

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
