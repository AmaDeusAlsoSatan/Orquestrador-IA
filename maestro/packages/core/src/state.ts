import { promises as fs } from "node:fs";
import path from "node:path";
import { makeUniqueId } from "./ids";
import { getMaestroPaths, MAESTRO_STATE_VERSION } from "./paths";
import type {
  AgentInvocation,
  AgentProfile,
  HumanReviewDecision,
  MaestroState,
  PatchPromotion,
  Project,
  ProjectInput,
  ProjectTask,
  RunRecord,
  RunWorkspace
} from "./types";

export function createEmptyState(now = new Date().toISOString()): MaestroState {
  return {
    version: MAESTRO_STATE_VERSION,
    createdAt: now,
    updatedAt: now,
    projects: [],
    tasks: [],
    decisions: [],
    providerProfiles: [],
    agentProfiles: [],
    agentInvocations: [],
    agentAdapterProfiles: [],
    orchestrationWorkflows: [],
    runs: [],
    workspaces: [],
    promotions: [],
    validationProfiles: [],
    validationRuns: []
  };
}

export async function ensureStateFile(homeDir: string): Promise<{ state: MaestroState; created: boolean }> {
  const paths = getMaestroPaths(homeDir);

  await fs.mkdir(paths.dataDir, { recursive: true });
  await fs.mkdir(paths.logsDir, { recursive: true });
  await fs.mkdir(paths.runsDir, { recursive: true });
  await fs.mkdir(paths.workspacesDir, { recursive: true });
  await fs.mkdir(paths.configDir, { recursive: true });

  if (await pathExists(paths.stateFile)) {
    return { state: await loadState(homeDir), created: false };
  }

  const state = createEmptyState();
  await writeJson(paths.stateFile, state);

  return { state, created: true };
}

export async function loadState(homeDir: string): Promise<MaestroState> {
  const paths = getMaestroPaths(homeDir);
  const raw = await fs.readFile(paths.stateFile, "utf8");
  const parsed = JSON.parse(raw) as MaestroState;

  if (parsed.version !== MAESTRO_STATE_VERSION || !Array.isArray(parsed.projects)) {
    throw new Error(`Unsupported Maestro state file: ${paths.stateFile}`);
  }

  return {
    ...parsed,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter(isHumanReviewDecision) : [],
    providerProfiles: Array.isArray(parsed.providerProfiles) ? parsed.providerProfiles : [],
    agentProfiles: Array.isArray(parsed.agentProfiles) ? parsed.agentProfiles.filter(isAgentProfile) : [],
    agentInvocations: Array.isArray(parsed.agentInvocations) ? parsed.agentInvocations.filter(isAgentInvocation) : [],
    agentAdapterProfiles: Array.isArray(parsed.agentAdapterProfiles) ? parsed.agentAdapterProfiles : [],
    orchestrationWorkflows: Array.isArray(parsed.orchestrationWorkflows) ? parsed.orchestrationWorkflows : [],
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.filter(isRunWorkspace) : [],
    promotions: Array.isArray(parsed.promotions) ? parsed.promotions.filter(isPatchPromotion) : [],
    validationProfiles: Array.isArray(parsed.validationProfiles) ? parsed.validationProfiles : [],
    validationRuns: Array.isArray(parsed.validationRuns) ? parsed.validationRuns : []
  };
}

export async function saveState(homeDir: string, state: MaestroState): Promise<void> {
  const paths = getMaestroPaths(homeDir);
  const nextState: MaestroState = {
    ...state,
    updatedAt: new Date().toISOString()
  };

  await fs.mkdir(path.dirname(paths.stateFile), { recursive: true });
  await writeJson(paths.stateFile, nextState);
}

export function createProject(input: ProjectInput, existingIds: readonly string[]): Project {
  const now = new Date().toISOString();
  const idSource = input.id || input.name;

  return {
    id: makeUniqueId(idSource, existingIds),
    name: input.name,
    repoPath: input.repoPath || "",
    description: input.description || "",
    stack: input.stack || [],
    status: input.status || "active",
    priority: input.priority || "medium",
    createdAt: now,
    updatedAt: now
  };
}

export function upsertProject(state: MaestroState, project: Project): MaestroState {
  const existingIndex = state.projects.findIndex((item) => item.id === project.id);
  const projects =
    existingIndex >= 0
      ? state.projects.map((item) => (item.id === project.id ? project : item))
      : [...state.projects, project];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    projects
  };
}

export function upsertRun(state: MaestroState, run: RunRecord): MaestroState {
  const existingIndex = state.runs.findIndex((item) => item.id === run.id);
  const runs =
    existingIndex >= 0
      ? state.runs.map((item) => (item.id === run.id ? run : item))
      : [...state.runs, run];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    runs
  };
}

export function upsertTask(state: MaestroState, task: ProjectTask): MaestroState {
  const existingIndex = state.tasks.findIndex((item) => item.id === task.id);
  const tasks =
    existingIndex >= 0
      ? state.tasks.map((item) => (item.id === task.id ? task : item))
      : [...state.tasks, task];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    tasks
  };
}

export function upsertHumanReviewDecision(state: MaestroState, decision: HumanReviewDecision): MaestroState {
  const existingIndex = state.decisions.findIndex((item) => item.id === decision.id);
  const decisions =
    existingIndex >= 0
      ? state.decisions.map((item) => (item.id === decision.id ? decision : item))
      : [...state.decisions, decision];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    decisions
  };
}

export function upsertAgentProfile(state: MaestroState, profile: AgentProfile): MaestroState {
  const existingIndex = state.agentProfiles.findIndex((item) => item.id === profile.id);
  const agentProfiles =
    existingIndex >= 0
      ? state.agentProfiles.map((item) => (item.id === profile.id ? profile : item))
      : [...state.agentProfiles, profile];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    agentProfiles
  };
}

export function upsertAgentInvocation(state: MaestroState, invocation: AgentInvocation): MaestroState {
  const existingIndex = state.agentInvocations.findIndex((item) => item.id === invocation.id);
  const agentInvocations =
    existingIndex >= 0
      ? state.agentInvocations.map((item) => (item.id === invocation.id ? invocation : item))
      : [...state.agentInvocations, invocation];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    agentInvocations
  };
}

export function upsertRunWorkspace(state: MaestroState, workspace: RunWorkspace): MaestroState {
  const existingIndex = state.workspaces.findIndex((item) => item.id === workspace.id);
  const workspaces =
    existingIndex >= 0
      ? state.workspaces.map((item) => (item.id === workspace.id ? workspace : item))
      : [...state.workspaces, workspace];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    workspaces
  };
}

export function upsertPatchPromotion(state: MaestroState, promotion: PatchPromotion): MaestroState {
  const existingIndex = state.promotions.findIndex((item) => item.id === promotion.id);
  const promotions =
    existingIndex >= 0
      ? state.promotions.map((item) => (item.id === promotion.id ? promotion : item))
      : [...state.promotions, promotion];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    promotions
  };
}

export function upsertValidationProfile(state: MaestroState, profile: import("./types").ProjectValidationProfile): MaestroState {
  const existingIndex = state.validationProfiles.findIndex((item) => item.projectId === profile.projectId);
  const validationProfiles =
    existingIndex >= 0
      ? state.validationProfiles.map((item) => (item.projectId === profile.projectId ? profile : item))
      : [...state.validationProfiles, profile];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    validationProfiles
  };
}

export function upsertValidationRun(state: MaestroState, validationRun: import("./types").ValidationRun): MaestroState {
  const existingIndex = state.validationRuns.findIndex((item) => item.id === validationRun.id);
  const validationRuns =
    existingIndex >= 0
      ? state.validationRuns.map((item) => (item.id === validationRun.id ? validationRun : item))
      : [...state.validationRuns, validationRun];

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    validationRuns
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isHumanReviewDecision(value: unknown): value is HumanReviewDecision {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<HumanReviewDecision>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.notes === "string" &&
    typeof candidate.decidedAt === "string"
  );
}

function isAgentProfile(value: unknown): value is AgentProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AgentProfile>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.description === "string" &&
    Array.isArray(candidate.responsibilities) &&
    Array.isArray(candidate.allowedActions) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isAgentInvocation(value: unknown): value is AgentInvocation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AgentInvocation>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.agentProfileId === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.stage === "string" &&
    typeof candidate.inputPath === "string" &&
    typeof candidate.status === "string"
  );
}

function isRunWorkspace(value: unknown): value is RunWorkspace {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RunWorkspace>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.sourceRepoPath === "string" &&
    typeof candidate.workspacePath === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isPatchPromotion(value: unknown): value is PatchPromotion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PatchPromotion>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.sourceWorkspacePath === "string" &&
    typeof candidate.targetRepoPath === "string" &&
    typeof candidate.patchPath === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}
