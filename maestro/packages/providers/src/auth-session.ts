import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProviderAuthSession, ProviderAuthStatus, ProviderAuthFlowType } from "@maestro/core";
import { makeUniqueId } from "@maestro/core";

/**
 * Create a new provider auth session
 */
export function createProviderAuthSession(
  provider: "kiro_openclaude" | "openclaude" | "anthropic",
  flowType: ProviderAuthFlowType,
  existingIds: readonly string[]
): ProviderAuthSession {
  const now = new Date().toISOString();
  const idSource = `${provider}-${flowType}-${now}`;

  return {
    id: makeUniqueId(idSource, existingIds),
    provider,
    flowType,
    status: "NOT_AUTHORIZED",
    startedAt: now
  };
}

/**
 * Update auth session with device code information
 */
export function updateAuthSessionWithDeviceCode(
  session: ProviderAuthSession,
  deviceCode: string | undefined,
  userCode: string,
  verificationUri: string,
  verificationUriComplete: string | undefined,
  expiresIn: number | undefined
): ProviderAuthSession {
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : undefined;

  return {
    ...session,
    status: "AUTHORIZING",
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresAt
  };
}

/**
 * Mark auth session as authorized
 */
export function markAuthSessionAuthorized(session: ProviderAuthSession): ProviderAuthSession {
  return {
    ...session,
    status: "AUTHORIZED",
    completedAt: new Date().toISOString()
  };
}

/**
 * Mark auth session as failed
 */
export function markAuthSessionFailed(session: ProviderAuthSession, errorMessage: string): ProviderAuthSession {
  return {
    ...session,
    status: "FAILED",
    errorMessage,
    completedAt: new Date().toISOString()
  };
}

/**
 * Mark auth session as expired
 */
export function markAuthSessionExpired(session: ProviderAuthSession): ProviderAuthSession {
  return {
    ...session,
    status: "EXPIRED",
    completedAt: new Date().toISOString()
  };
}

/**
 * Cancel auth session
 */
export function cancelAuthSession(session: ProviderAuthSession): ProviderAuthSession {
  return {
    ...session,
    status: "FAILED",
    errorMessage: "Cancelled by user",
    completedAt: new Date().toISOString()
  };
}

/**
 * Check if auth session is expired
 */
export function isAuthSessionExpired(session: ProviderAuthSession): boolean {
  if (!session.expiresAt) {
    return false;
  }

  return new Date(session.expiresAt) < new Date();
}

/**
 * Get auth session status display
 */
export function getAuthSessionStatusDisplay(status: ProviderAuthStatus): string {
  switch (status) {
    case "NOT_CONFIGURED":
      return "Not configured";
    case "NOT_AUTHORIZED":
      return "Not authorized";
    case "AUTHORIZING":
      return "Authorizing...";
    case "AUTHORIZED":
      return "Authorized";
    case "FAILED":
      return "Failed";
    case "EXPIRED":
      return "Expired";
    default:
      return status;
  }
}

/**
 * Save auth session artifacts to disk
 */
export async function saveAuthSessionArtifacts(
  homeDir: string,
  sessionId: string,
  provider: string,
  session: ProviderAuthSession,
  rawOutput?: string
): Promise<string> {
  const sessionDir = path.join(homeDir, "data", "providers", provider, "auth", sessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  // Save session metadata
  const sessionPath = path.join(sessionDir, "00-auth-session.json");
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), "utf8");

  // Save raw output if provided
  if (rawOutput) {
    const rawOutputPath = path.join(sessionDir, "01-raw-output.txt");
    await fs.writeFile(rawOutputPath, rawOutput, "utf8");
    return rawOutputPath;
  }

  return sessionPath;
}

/**
 * Load auth session from disk
 */
export async function loadAuthSession(
  homeDir: string,
  sessionId: string,
  provider: string
): Promise<ProviderAuthSession | undefined> {
  const sessionPath = path.join(homeDir, "data", "providers", provider, "auth", sessionId, "00-auth-session.json");

  try {
    const content = await fs.readFile(sessionPath, "utf8");
    return JSON.parse(content) as ProviderAuthSession;
  } catch {
    return undefined;
  }
}
