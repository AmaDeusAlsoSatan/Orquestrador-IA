import path from "node:path";

export const MAESTRO_STATE_VERSION = 1;
export const DATA_DIR_NAME = "data";
export const VAULT_DIR_NAME = "vault";
export const LOGS_DIR_NAME = "logs";
export const RUNS_DIR_NAME = "runs";
export const WORKSPACES_DIR_NAME = "workspaces";
export const STATE_FILE_NAME = "maestro.json";

export interface MaestroPaths {
  homeDir: string;
  dataDir: string;
  vaultDir: string;
  globalVaultDir: string;
  projectsVaultDir: string;
  logsDir: string;
  runsDir: string;
  workspacesDir: string;
  stateFile: string;
}

export function resolveMaestroHome(cwd: string, env: NodeJS.ProcessEnv): string {
  const configuredHome = env.MAESTRO_HOME?.trim();
  return path.resolve(configuredHome || cwd);
}

export function getMaestroPaths(homeDir: string): MaestroPaths {
  const dataDir = path.join(homeDir, DATA_DIR_NAME);
  const vaultDir = path.join(dataDir, VAULT_DIR_NAME);

  return {
    homeDir,
    dataDir,
    vaultDir,
    globalVaultDir: path.join(vaultDir, "global"),
    projectsVaultDir: path.join(vaultDir, "projects"),
    logsDir: path.join(dataDir, LOGS_DIR_NAME),
    runsDir: path.join(dataDir, RUNS_DIR_NAME),
    workspacesDir: path.join(dataDir, WORKSPACES_DIR_NAME),
    stateFile: path.join(dataDir, STATE_FILE_NAME)
  };
}
