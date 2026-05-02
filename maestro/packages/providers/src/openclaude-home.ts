import { promises as fs } from "node:fs";
import path from "node:path";

export interface OpenClaudeSettings {
  env: {
    CLAUDE_CODE_USE_OPENAI?: string;
    OPENAI_BASE_URL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    [key: string]: string | undefined;
  };
}

export interface OpenClaudeIsolationConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  additionalEnv?: Record<string, string>;
}

/**
 * Ensure OpenClaude isolated home directory exists.
 * 
 * This creates a dedicated directory for Maestro's OpenClaude configuration,
 * completely isolated from the global OpenClaude settings.
 * 
 * @param maestroHome - Maestro home directory
 * @returns Path to the isolated OpenClaude home
 */
export async function ensureOpenClaudeHome(maestroHome: string): Promise<string> {
  const openClaudeHome = path.join(maestroHome, "data", "providers", "openclaude-grouter", "home");
  await fs.mkdir(openClaudeHome, { recursive: true });
  return openClaudeHome;
}

/**
 * Write OpenClaude settings.json to isolated home.
 * 
 * This creates a settings.json file that configures OpenClaude to use
 * Grouter/Kiro instead of the global configuration.
 * 
 * @param homePath - Path to isolated OpenClaude home
 * @param config - Isolation configuration
 */
export async function writeOpenClaudeSettings(
  homePath: string,
  config: OpenClaudeIsolationConfig
): Promise<void> {
  const settings: OpenClaudeSettings = {
    env: {
      CLAUDE_CODE_USE_OPENAI: "1",
      OPENAI_BASE_URL: config.baseUrl,
      OPENAI_API_KEY: config.apiKey,
      OPENAI_MODEL: config.model,
      ...config.additionalEnv
    }
  };

  const settingsPath = path.join(homePath, "settings.json");
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

/**
 * Get path to isolated settings.json file.
 * 
 * @param homePath - Path to isolated OpenClaude home
 * @returns Path to settings.json
 */
export function getSettingsPath(homePath: string): string {
  return path.join(homePath, "settings.json");
}

/**
 * Ensure OpenClaude isolated configuration is ready.
 * 
 * This is the main entry point for setting up OpenClaude isolation.
 * It creates the home directory and writes the settings file.
 * 
 * @param maestroHome - Maestro home directory
 * @param config - Isolation configuration
 * @returns Path to settings.json file (to be passed via --settings flag)
 */
export async function ensureOpenClaudeIsolation(
  maestroHome: string,
  config: OpenClaudeIsolationConfig
): Promise<string> {
  const homePath = await ensureOpenClaudeHome(maestroHome);
  await writeOpenClaudeSettings(homePath, config);
  return getSettingsPath(homePath);
}
