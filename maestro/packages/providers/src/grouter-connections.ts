import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { GrouterProviderConfig, GrouterConnectionRef } from "@maestro/core";
import { loadState, saveState } from "@maestro/core";
import { loadGrouterConfig } from "./grouter-doctor";

const execFileAsync = promisify(execFile);

export interface DiscoveredGrouterConnection {
  id: string;
  provider: string;
  emailMasked?: string;
  status?: string;
  rawLine?: string;
}

export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) {
    return "***";
  }
  const [local, domain] = email.split("@");
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}${"*".repeat(local.length - 1)}@${domain}`;
}

export function parseGrouterListOutput(output: string): DiscoveredGrouterConnection[] {
  const connections: DiscoveredGrouterConnection[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    // Match lines like: "1   bd8020e4   odachisamadesu@gmail.com         unknown       1    expired"
    const match = line.trim().match(/^(\d+)\s+(\w+)\s+(.+?)\s+(unknown|active|unavailable|expired|disabled)/i);
    
    if (match) {
      const [, , id, emailOrName, status] = match;
      
      // Check if emailOrName looks like an email
      const isEmail = emailOrName.includes("@");
      const emailMasked = isEmail ? maskEmail(emailOrName.trim()) : undefined;
      
      connections.push({
        id: id.trim(),
        provider: "unknown", // Grouter list doesn't show provider directly
        emailMasked,
        status: status.toLowerCase(),
        rawLine: line.trim()
      });
    }
  }

  return connections;
}

export async function listGrouterConnections(homeDir: string): Promise<DiscoveredGrouterConnection[]> {
  const config = await loadGrouterConfig(homeDir);
  
  if (!config || !config.executablePath) {
    throw new Error("Grouter config not found or executablePath not configured");
  }

  try {
    const result = await execFileAsync(config.executablePath, ["list"], {
      timeout: 10000
    }).catch((err: any) => {
      // Capture output even if command fails (exit code 1 is normal for grouter)
      return { stdout: err.stdout || "", stderr: err.stderr || "" };
    });

    const output = result.stdout || result.stderr;
    return parseGrouterListOutput(output);
  } catch (error) {
    throw new Error(`Failed to list Grouter connections: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function syncGrouterConnections(homeDir: string): Promise<GrouterConnectionRef[]> {
  const discovered = await listGrouterConnections(homeDir);
  const state = await loadState(homeDir);
  const now = new Date().toISOString();

  // Create or update connection refs
  const syncedConnections: GrouterConnectionRef[] = discovered.map((disc) => {
    // Check if connection already exists in state
    const existing = state.grouterConnections.find((c) => c.id === disc.id);

    if (existing) {
      // Update metadata but preserve linkedAt, label, allowedRoles
      return {
        ...existing,
        provider: disc.provider !== "unknown" ? disc.provider : existing.provider,
        emailMasked: disc.emailMasked || existing.emailMasked,
        status: disc.status
      };
    } else {
      // New connection discovered
      return {
        id: disc.id,
        provider: disc.provider,
        emailMasked: disc.emailMasked,
        status: disc.status,
        linkedAt: now // Will be updated when actually linked
      };
    }
  });

  // Update state
  const nextState = {
    ...state,
    grouterConnections: syncedConnections
  };

  await saveState(homeDir, nextState);

  return syncedConnections;
}

export async function linkGrouterConnection(
  homeDir: string,
  connectionId: string,
  provider: string,
  label?: string,
  allowedRoles?: string[]
): Promise<GrouterConnectionRef> {
  const state = await loadState(homeDir);
  const now = new Date().toISOString();

  // Find connection in state
  const connection = state.grouterConnections.find((c) => c.id.startsWith(connectionId));

  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}. Run 'maestro provider grouter sync' first.`);
  }

  // Check if multiple matches
  const matches = state.grouterConnections.filter((c) => c.id.startsWith(connectionId));
  if (matches.length > 1) {
    throw new Error(`Multiple connections match prefix '${connectionId}'. Use full ID:\n${matches.map((c) => `  ${c.id}`).join("\n")}`);
  }

  // Update connection with link info
  const linkedConnection: GrouterConnectionRef = {
    ...connection,
    provider,
    label,
    allowedRoles,
    linkedAt: now
  };

  // Update state
  const nextState = {
    ...state,
    grouterConnections: state.grouterConnections.map((c) =>
      c.id === connection.id ? linkedConnection : c
    )
  };

  await saveState(homeDir, nextState);

  // Update config linkedConnectionIds
  const config = await loadGrouterConfig(homeDir);
  if (config) {
    const configPath = path.join(homeDir, "data", "config", "grouter.json");
    const updatedConfig = {
      ...config,
      linkedConnectionIds: Array.from(new Set([...config.linkedConnectionIds, connection.id]))
    };
    await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2), "utf8");
  }

  return linkedConnection;
}

export async function unlinkGrouterConnection(homeDir: string, connectionId: string): Promise<void> {
  const state = await loadState(homeDir);

  // Find connection in state
  const connection = state.grouterConnections.find((c) => c.id.startsWith(connectionId));

  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  // Check if multiple matches
  const matches = state.grouterConnections.filter((c) => c.id.startsWith(connectionId));
  if (matches.length > 1) {
    throw new Error(`Multiple connections match prefix '${connectionId}'. Use full ID:\n${matches.map((c) => `  ${c.id}`).join("\n")}`);
  }

  // Remove link info but keep connection in state
  const unlinkedConnection: GrouterConnectionRef = {
    ...connection,
    label: undefined,
    allowedRoles: undefined
  };

  // Update state
  const nextState = {
    ...state,
    grouterConnections: state.grouterConnections.map((c) =>
      c.id === connection.id ? unlinkedConnection : c
    )
  };

  await saveState(homeDir, nextState);

  // Update config linkedConnectionIds
  const config = await loadGrouterConfig(homeDir);
  if (config) {
    const configPath = path.join(homeDir, "data", "config", "grouter.json");
    const updatedConfig = {
      ...config,
      linkedConnectionIds: config.linkedConnectionIds.filter((id) => id !== connection.id)
    };
    await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2), "utf8");
  }
}
