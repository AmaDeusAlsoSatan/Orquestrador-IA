export * from "./git-inspector";
export * from "./patch-applier";
export * from "./patch-promotion";
export * from "./workspace-manager";
export * from "./validation-runner";

export interface RunnerPolicy {
  allowRepositoryExecution: boolean;
  requireConfirmation: boolean;
  logCommands: boolean;
}

export const DEFAULT_RUNNER_POLICY: RunnerPolicy = {
  allowRepositoryExecution: false,
  requireConfirmation: true,
  logCommands: true
};

export const RUNNER_STATUS = "planned";
