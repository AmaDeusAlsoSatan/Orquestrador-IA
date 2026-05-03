import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import {
  DEFAULT_AGENT_MODEL_MAP,
  attachAgentInvocationOutput,
  createDefaultAgentProfiles,
  prepareAgentInvocation,
  type OpenClaudeAdapterConfig
} from "@maestro/agents";
import {
  createProject,
  ensureStateFile,
  getMaestroPaths,
  makeUniqueId,
  resolveMaestroHome,
  saveState,
  slugify,
  upsertAgentInvocation,
  upsertAgentProfile,
  upsertHumanReviewDecision,
  upsertPatchPromotion,
  upsertProject,
  upsertRun,
  upsertRunWorkspace,
  upsertTask,
  upsertValidationRun,
  type HumanDecisionStatus,
  type AgentInvocation,
  type AgentRole,
  type HumanReviewDecision,
  type MaestroState,
  type PatchPromotion,
  type Project,
  type ProjectTask,
  type RunRecord,
  type RunWorkspace,
  type TaskPriority,
  type TaskStatus,
  type ValidationRun,
  type ValidationStatus,
  type ValidationTarget
} from "@maestro/core";
import {
  appendTaskAddedToBacklog,
  attachFinalCommit,
  createContextPack,
  createHandoffPackage,
  createProjectVault,
  createReviewPackage,
  finalizeRun,
  generateRunTimeline,
  getNextRunStep,
  getProjectContextStatus,
  getProjectMemoryConsolidationStatus,
  getRunFileStatuses,
  prepareManualRun,
  readProjectMemoryBrief,
  refreshProjectMemory,
  syncTaskBoardToVault,
  attachRunStage,
  captureRunGitDiff,
  writeHumanReviewDecisionArtifacts
} from "@maestro/memory";
import {
  checkPatchApplies,
  createRunWorkspace,
  exportWorkspacePatch,
  getGitGuardStatus,
  inspectGitRepo,
  inspectPatch,
  runValidationCommand
} from "@maestro/runner";

type ApiHandler = (context: RequestContext) => Promise<unknown>;

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  segments: string[];
  query: URLSearchParams;
  body: unknown;
  homeDir: string;
}

interface RunActionBody {
  action?: string;
  status?: HumanDecisionStatus;
  notes?: string;
  createFollowUpTask?: boolean;
  followUpTitle?: string;
  followUpDescription?: string;
  followUpPriority?: TaskPriority;
  followUpTags?: string | string[];
  force?: boolean;
}

interface NextAction {
  label: string;
  description: string;
  actionType: "COPY_PROMPT" | "ATTACH_OUTPUT" | "RUN_ACTION" | "MANUAL";
  primary?: boolean;
  fileToOpen?: string;
  runAction?: string;
  stage?: "supervisor" | "executor" | "reviewer";
}

const DEFAULT_PORT = 4317;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const TEXT_FILE_ALLOWLIST = new Set([
  "00-run-metadata.json",
  "01-goal.md",
  "02-context-pack.md",
  "03-codex-supervisor-prompt.md",
  "04-kiro-executor-prompt.md",
  "05-codex-reviewer-prompt.md",
  "06-run-log.md",
  "07-supervisor-output.md",
  "08-executor-output.md",
  "09-reviewer-output.md",
  "10-final-summary.md",
  "11-git-baseline.md",
  "12-git-after-executor.md",
  "13-git-diff.md",
  "14-changed-files.md",
  "15-human-decision.md",
  "16-workspace.md",
  "17-promotion-patch.patch",
  "18-promotion-summary.md",
  "19-promotion-check.md",
  "20-apply-plan.md",
  "21-apply-preflight.md",
  "22-apply-result.md",
  "23-applied-diff.md",
  "25-validation-original.md",
  "26-final-commit.md",
  "handoff/00-read-this-first.md",
  "handoff/01-executor-rules.md",
  "handoff/04-task-contract.md",
  "handoff/07-kiro-prompt.md",
  "review/08-codex-reviewer-prompt.md"
]);
const MEMORY_FILE_ALLOWLIST = new Set([
  "11-context-pack.md",
  "12-active-context.md",
  "13-project-checkpoint.md",
  "14-open-questions.md",
  "15-risk-register.md"
]);

export function startServer(options: { port?: number; homeDir?: string } = {}) {
  const homeDir = options.homeDir || resolveMaestroHome(process.cwd(), process.env);
  const port = options.port || Number(process.env.MAESTRO_SERVER_PORT || DEFAULT_PORT);
  const server = createServer(async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const context: RequestContext = {
        req,
        res,
        method: req.method || "GET",
        segments: requestUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent),
        query: requestUrl.searchParams,
        body: await readJsonBody(req),
        homeDir
      };
      const result = await routeRequest(context);
      writeJson(res, 200, result);
    } catch (error) {
      const statusCode = error instanceof ApiError ? error.statusCode : 500;
      writeJson(res, statusCode, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Maestro server listening at http://127.0.0.1:${port}`);
    console.log(`Maestro home: ${homeDir}`);
  });

  return server;
}

async function routeRequest(context: RequestContext): Promise<unknown> {
  const { method, segments } = context;

  if (segments[0] !== "api") {
    throw new ApiError(404, "Not found.");
  }

  const routeKey = `${method} /${segments.slice(0, 3).join("/")}`;
  const exactRoutes: Record<string, ApiHandler> = {
    "GET /api/health": getHealth,
    "GET /api/state": getState,
    "GET /api/agents": getAgentsRoute,
    "POST /api/agents/init-defaults": initAgentsRoute,
    "GET /api/projects": getProjects,
    "POST /api/projects": createProjectRoute,
    "POST /api/pilot": startPilotRoute
  };

  if (exactRoutes[routeKey]) {
    return exactRoutes[routeKey](context);
  }

  if (segments[1] === "projects") {
    return routeProjectRequest(context);
  }

  if (segments[1] === "runs") {
    return routeRunRequest(context);
  }

  if (segments[1] === "pilot") {
    return routePilotRequest(context);
  }

  throw new ApiError(404, "Not found.");
}

async function routeProjectRequest(context: RequestContext): Promise<unknown> {
  const { method, segments } = context;
  const projectId = segments[2];

  if (!projectId) {
    throw new ApiError(404, "Project route requires project id.");
  }

  if (method === "GET" && segments.length === 3) return getProject(context, projectId);
  if (method === "GET" && segments[3] === "dashboard") return getProjectDashboard(context, projectId);
  if (method === "GET" && segments[3] === "memory" && segments[4] === "brief") return getProjectMemoryBriefRoute(context, projectId);
  if (method === "GET" && segments[3] === "memory" && segments[4] === "files") return getProjectMemoryFile(context, projectId, segments.slice(5).join("/"));
  if (method === "POST" && segments[3] === "memory" && segments[4] === "action") return runProjectMemoryAction(context, projectId);
  if (method === "GET" && segments[3] === "tasks") return getProjectTasks(context, projectId);
  if (method === "POST" && segments[3] === "tasks") return createProjectTaskRoute(context, projectId);
  if (method === "GET" && segments[3] === "runs") return getProjectRuns(context, projectId);
  if (method === "POST" && segments[3] === "runs") return prepareProjectRunRoute(context, projectId);

  throw new ApiError(404, "Project route not found.");
}

async function routeRunRequest(context: RequestContext): Promise<unknown> {
  const { method, segments } = context;
  const runId = segments[2];

  if (!runId) {
    throw new ApiError(404, "Run route requires run id.");
  }

  if (method === "GET" && segments.length === 3) return getRun(context, runId);
  if (method === "POST" && segments[3] === "action") return runControlledAction(context, runId);
  if (method === "POST" && segments[3] === "attach") return attachRunOutputRoute(context, runId);
  if (method === "POST" && segments[3] === "attach-commit") return attachCommitRoute(context, runId);
  if (method === "GET" && segments[3] === "agents") return getRunAgentsRoute(context, runId);
  if (method === "POST" && segments[3] === "agents" && segments[4] === "invoke") return invokeRunAgentRoute(context, runId);
  if (method === "POST" && segments[3] === "agents" && segments[5] === "attach-output") {
    return attachRunAgentOutputRoute(context, runId, segments[4]);
  }
  if (method === "GET" && segments[3] === "timeline") return getRunTimeline(context, runId);
  if (method === "GET" && segments[3] === "files") return getRunFile(context, runId, segments.slice(4).join("/"));

  throw new ApiError(404, "Run route not found.");
}

async function routePilotRequest(context: RequestContext): Promise<unknown> {
  const { method, segments } = context;

  if (method === "POST" && segments[2] === "start") return startPilotRoute(context);
  if (method === "GET" && segments[3] === "status") return getPilotStatusRoute(context, segments[2]);
  if (method === "GET" && segments[3] === "next") return getPilotNextRoute(context, segments[2]);

  throw new ApiError(404, "Pilot route not found.");
}

async function getHealth(context: RequestContext) {
  const { state } = await ensureStateFile(context.homeDir);
  return {
    ok: true,
    service: "maestro-server",
    homeDir: context.homeDir,
    projectCount: state.projects.length,
    runCount: state.runs.length
  };
}

async function getState(context: RequestContext) {
  const { state } = await loadState(context.homeDir);
  return state;
}

async function getAgentsRoute(context: RequestContext) {
  const { state } = await loadState(context.homeDir);
  return {
    agents: state.agentProfiles,
    invocations: state.agentInvocations
  };
}

async function initAgentsRoute(context: RequestContext) {
  const { state } = await ensureStateFile(context.homeDir);
  let nextState = state;
  const profiles = createDefaultAgentProfiles();

  for (const profile of profiles) {
    const existing = nextState.agentProfiles.find((item) => item.id === profile.id);
    nextState = upsertAgentProfile(nextState, existing ? { ...profile, createdAt: existing.createdAt } : profile);
  }

  await saveState(context.homeDir, nextState);
  await ensureDefaultAgentModelMap(context.homeDir);

  return {
    agents: nextState.agentProfiles
  };
}

async function getProjects(context: RequestContext) {
  const { state } = await loadState(context.homeDir);
  const projects = await Promise.all(state.projects.map((project) => enrichProjectSummary(context.homeDir, state, project)));
  return { projects };
}

async function createProjectRoute(context: RequestContext) {
  const body = asRecord(context.body);
  const name = requireString(body.name, "name");
  const { state } = await loadState(context.homeDir);
  const existing = state.projects.find((project) => project.id === slugify(name) || project.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    await createProjectVault(context.homeDir, existing);
    return { project: existing, created: false };
  }

  const project = createProject(
    {
      name,
      repoPath: optionalString(body.repoPath),
      description: optionalString(body.description),
      stack: parseCsv(body.stack),
      status: optionalString(body.status) as Project["status"] | undefined,
      priority: optionalString(body.priority) as Project["priority"] | undefined
    },
    state.projects.map((item) => item.id)
  );
  await createProjectVault(context.homeDir, project);
  await saveState(context.homeDir, upsertProject(state, project));
  return { project, created: true };
}

async function getProject(context: RequestContext, projectId: string) {
  const { state } = await loadState(context.homeDir);
  const project = getProjectOrThrow(state, projectId);
  return enrichProjectSummary(context.homeDir, state, project);
}

async function getProjectDashboard(context: RequestContext, projectId: string) {
  const { state } = await loadState(context.homeDir);
  const project = getProjectOrThrow(state, projectId);
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const runs = state.runs.filter((run) => run.projectId === project.id);
  const decisions = state.decisions.filter((decision) => decision.projectId === project.id);
  const [memoryStatus, brief] = await Promise.all([
    getProjectMemoryConsolidationStatus(context.homeDir, project).catch(() => undefined),
    readProjectMemoryBrief(context.homeDir, project, tasks, runs, decisions).catch(() => undefined)
  ]);
  const taskCounts = countBy(tasks, (task) => task.status);
  const latestRun = runs.sort(byUpdatedAtDesc)[0];
  const latestPromotion = state.promotions.filter((promotion) => promotion.projectId === project.id).sort(byUpdatedAtDesc)[0];
  const latestValidation = state.validationRuns.filter((run) => run.projectId === project.id).sort(byUpdatedAtDesc)[0];
  const runsAwaitingDecision = await getRunsAwaitingDecision(runs, decisions);
  const openRun = runs.filter((run) => !["FINALIZED", "BLOCKED"].includes(run.status)).sort(byUpdatedAtDesc)[0];
  const openRunWorkspace = openRun ? state.workspaces.find((workspace) => workspace.runId === openRun.id) : undefined;
  const openRunPromotion = openRun ? state.promotions.find((promotion) => promotion.runId === openRun.id) : undefined;
  const openRunDecision = openRun ? state.decisions.find((decision) => decision.runId === openRun.id) : undefined;
  const openRunNextAction = openRun ? (await buildNextActions(openRun, openRunWorkspace, openRunPromotion, openRunDecision))[0] : undefined;

  // Run counts by status
  const activeRuns = runs.filter((run) => ["PREPARED", "SUPERVISOR_PLANNED", "EXECUTOR_READY", "EXECUTOR_REPORTED", "REVIEW_READY", "REVIEWED"].includes(run.status));
  const completedRuns = runs.filter((run) => run.status === "FINALIZED").sort(byUpdatedAtDesc);
  const blockedRuns = runs.filter((run) => run.status === "BLOCKED");
  const latestCompletedRun = completedRuns[0];

  return {
    project,
    taskCounts,
    totalTasks: tasks.length,
    openTasks: tasks.filter((task) => !["DONE", "CANCELLED"].includes(task.status)).length,
    reviewNeededTasks: tasks.filter((task) => task.status === "REVIEW_NEEDED"),
    highPriorityTasks: tasks.filter((task) => ["HIGH", "URGENT"].includes(task.priority) && !["DONE", "CANCELLED"].includes(task.status)),
    latestRun,
    openRuns: runs.filter((run) => !["FINALIZED", "BLOCKED"].includes(run.status)),
    runsAwaitingDecision,
    latestDecision: decisions.sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0],
    latestPromotion,
    latestValidation,
    memoryStatus,
    brief,
    runCounts: {
      active: activeRuns.length,
      completed: completedRuns.length,
      blocked: blockedRuns.length
    },
    latestCompletedRun: latestCompletedRun ? {
      id: latestCompletedRun.id,
      goal: latestCompletedRun.goal,
      finalizedAt: latestCompletedRun.finalizedAt,
      finalCommit: latestCompletedRun.finalCommit
    } : undefined,
    nextStep: openRunNextAction?.description || brief?.nextStep || getProjectNextStep(project, tasks, runsAwaitingDecision)
  };
}

async function getProjectMemoryBriefRoute(context: RequestContext, projectId: string) {
  const { state } = await loadState(context.homeDir);
  const project = getProjectOrThrow(state, projectId);
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const runs = state.runs.filter((run) => run.projectId === project.id);
  const decisions = state.decisions.filter((decision) => decision.projectId === project.id);
  return readProjectMemoryBrief(context.homeDir, project, tasks, runs, decisions);
}

async function getProjectMemoryFile(context: RequestContext, projectId: string, fileName: string) {
  const { state } = await loadState(context.homeDir);
  getProjectOrThrow(state, projectId);
  const normalized = normalizeRunFileName(fileName);

  if (!MEMORY_FILE_ALLOWLIST.has(normalized)) {
    throw new ApiError(400, `Memory file is not exposed through the UI API: ${normalized}`);
  }

  const projectVaultDir = path.join(getMaestroPaths(context.homeDir).projectsVaultDir, projectId);
  const filePath = path.resolve(projectVaultDir, normalized);
  assertPathInside(projectVaultDir, filePath);
  const content = await fs.readFile(filePath, "utf8").catch(() => undefined);

  if (content === undefined) {
    throw new ApiError(404, "Memory file not found.");
  }

  return { fileName: normalized, path: filePath, content };
}

async function runProjectMemoryAction(context: RequestContext, projectId: string) {
  const body = asRecord(context.body);
  const action = requireString(body.action, "action");
  const { state } = await loadState(context.homeDir);
  const project = getProjectOrThrow(state, projectId);
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const runs = state.runs.filter((run) => run.projectId === project.id);
  const decisions = state.decisions.filter((decision) => decision.projectId === project.id);

  if (action === "REFRESH") {
    return refreshProjectMemory(context.homeDir, project, tasks, runs, decisions);
  }

  if (action === "PACK") {
    return createContextPack(context.homeDir, project, tasks, decisions, runs);
  }

  throw new ApiError(400, `Unsupported memory action: ${action}`);
}

async function getProjectTasks(context: RequestContext, projectId: string) {
  const { state } = await loadState(context.homeDir);
  getProjectOrThrow(state, projectId);
  return { tasks: state.tasks.filter((task) => task.projectId === projectId).sort(byCreatedAtDesc) };
}

async function createProjectTaskRoute(context: RequestContext, projectId: string) {
  const body = asRecord(context.body);
  const { state } = await loadState(context.homeDir);
  const project = getProjectOrThrow(state, projectId);
  const title = requireString(body.title, "title");
  const now = new Date().toISOString();
  const task: ProjectTask = {
    id: makeUniqueId(`${project.id}-task-${title}`, state.tasks.map((item) => item.id)),
    projectId: project.id,
    title,
    description: optionalString(body.description) || "",
    status: (optionalString(body.status) as TaskStatus | undefined) || "TODO",
    priority: (optionalString(body.priority) as TaskPriority | undefined) || "MEDIUM",
    tags: parseCsv(body.tags),
    relatedRunIds: [],
    createdAt: now,
    updatedAt: now
  };
  const nextState = upsertTask(state, task);
  await appendTaskAddedToBacklog(context.homeDir, project, task);
  await syncTaskBoardToVault(context.homeDir, project, nextState.tasks.filter((item) => item.projectId === project.id), nextState.decisions);
  await saveState(context.homeDir, nextState);
  return { task };
}

async function getProjectRuns(context: RequestContext, projectId: string) {
  const { state } = await loadState(context.homeDir);
  getProjectOrThrow(state, projectId);
  return { runs: state.runs.filter((run) => run.projectId === projectId).sort(byUpdatedAtDesc) };
}

async function prepareProjectRunRoute(context: RequestContext, projectId: string) {
  const body = asRecord(context.body);
  const { state } = await loadState(context.homeDir);
  const project = getProjectOrThrow(state, projectId);
  const taskId = optionalString(body.taskId);
  const task = taskId ? getTaskOrThrow(state, taskId) : undefined;

  if (task && task.projectId !== project.id) {
    throw new ApiError(400, "Task does not belong to project.");
  }

  const goal = task ? renderTaskGoal(task, optionalString(body.goal)) : requireString(body.goal, "goal");
  const prepared = await prepareManualRun(context.homeDir, project, goal, { taskId: task?.id });
  let nextState = upsertRun(state, prepared.runRecord);

  if (task) {
    const nextTask: ProjectTask = {
      ...task,
      status: "IN_PROGRESS",
      relatedRunIds: unique([...task.relatedRunIds, prepared.runRecord.id]),
      updatedAt: new Date().toISOString()
    };
    nextState = upsertTask(nextState, nextTask);
  }

  await saveState(context.homeDir, nextState);
  return { run: prepared.runRecord, files: prepared.files, taskId: task?.id };
}

async function getRun(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const task = run.taskId ? state.tasks.find((item) => item.id === run.taskId) : undefined;
  const files = await getRunFileStatuses(run);
  const extraFiles = await getExtraRunFiles(run);
  const workspace = state.workspaces.find((item) => item.runId === run.id);
  const promotion = state.promotions.find((item) => item.runId === run.id);
  const decision = state.decisions.find((item) => item.runId === run.id);
  const validationRuns = state.validationRuns.filter((item) => item.runId === run.id).sort(byUpdatedAtDesc);
  const checklist = await buildRunChecklist(run, workspace, promotion, decision, validationRuns);
  const nextActions = await buildNextActions(run, workspace, promotion, decision);

  return {
    run,
    project,
    task,
    files: [...files, ...extraFiles],
    workspace,
    promotion,
    decision,
    validationRuns,
    agentProfiles: getRunAgentProfiles(state, project.id),
    agentInvocations: state.agentInvocations.filter((item) => item.runId === run.id).sort(byAgentInvocationTimeDesc),
    nextStep: nextActions[0]?.description || getNextRunStep(run),
    checklist,
    nextActions
  };
}

async function getRunAgentsRoute(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);

  return {
    agents: getRunAgentProfiles(state, project.id),
    invocations: state.agentInvocations.filter((item) => item.runId === run.id).sort(byAgentInvocationTimeDesc)
  };
}

async function invokeRunAgentRoute(context: RequestContext, runId: string) {
  const body = asRecord(context.body);
  const role = requireString(body.role, "role") as AgentRole;
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);

  if (run.status === "FINALIZED" || run.status === "BLOCKED") {
    throw new ApiError(409, `Cannot invoke agent for run ${run.id} because it is ${run.status}. Create a new run or use a future audit mode.`);
  }

  const profile = getAgentProfileForRoleOrThrow(state, role, project.id);
  const workspace = state.workspaces.find((item) => item.runId === run.id);
  const result = await prepareAgentInvocation({
    run,
    project,
    profile,
    workspace,
    openClaudeConfig: await readOpenClaudeRuntimeConfig(context.homeDir)
  });

  let nextState = upsertAgentInvocation(state, result.invocation);
  let stageOutputPath: string | undefined;
  let updatedRun: RunRecord | undefined;

  // For FULL_STACK_EXECUTOR, process patch before promotion
  if (result.invocation.role === "FULL_STACK_EXECUTOR" && result.invocation.status === "SUCCEEDED") {
    try {
      const { processExecutorPatchFlow } = await import("@maestro/agents");
      const patchResult = await processExecutorPatchFlow({
        homeDir: context.homeDir,
        invocation: result.invocation,
        outputPath: result.outputPath,
        project,
        run,
        workspace,
        state: nextState,
        openClaudeConfig: await readOpenClaudeRuntimeConfig(context.homeDir),
        contextPackMarkdown: result.contextPackMarkdown,
        originalPrompt: result.originalPrompt,
        maxRepairAttempts: 1
      });
      
      // Update invocation and state with patch processing result
      nextState = upsertAgentInvocation(patchResult.state, patchResult.invocation);
      
      // If patch processing failed, don't promote to stage
      if (patchResult.invocation.status === "FAILED") {
        await saveState(context.homeDir, nextState);
        return {
          ...result,
          invocation: patchResult.invocation,
          run
        };
      }
      
      // Log patch processing success
      if (patchResult.patchArtifactPath) {
        console.log(`Patch applied successfully to workspace`);
        console.log(`Patch artifact: ${patchResult.patchArtifactPath}`);
        console.log(`Workspace: ${patchResult.workspacePath}`);
        console.log(`Files changed: ${patchResult.changedFilesCount || 0}`);
      }
    } catch (error) {
      // If patch processing fails, mark invocation as failed
      const failedInvocation = {
        ...result.invocation,
        status: "FAILED" as const,
        errorMessage: `Patch processing error: ${error instanceof Error ? error.message : String(error)}`
      };
      nextState = upsertAgentInvocation(nextState, failedInvocation);
      await saveState(context.homeDir, nextState);
      return {
        ...result,
        invocation: failedInvocation,
        run
      };
    }
  }

  // Automatic stage promotion: if invocation succeeded, promote output to run stage
  if (result.invocation.status === "SUCCEEDED") {
    const stage = runStageForAgentInvocationStage(result.invocation.stage);
    if (stage) {
      try {
        const attachResult = await attachRunStage(project, run, stage, result.outputPath);
        nextState = upsertRun(nextState, attachResult.runRecord);
        stageOutputPath = attachResult.outputPath;
        updatedRun = attachResult.runRecord;
      } catch (error) {
        // Log error but don't fail the invocation
        console.error(`Failed to promote agent output to run stage: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await saveState(context.homeDir, nextState);
  return {
    ...result,
    stageOutputPath,
    run: updatedRun || run
  };
}

async function attachRunAgentOutputRoute(context: RequestContext, runId: string, invocationId: string | undefined) {
  if (!invocationId) {
    throw new ApiError(400, "Agent invocation id is required.");
  }

  const body = asRecord(context.body);
  const content = requireString(body.content, "content");
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const invocation = getAgentInvocationOrThrow(state, invocationId);

  if (invocation.runId !== run.id) {
    throw new ApiError(400, `Invocation ${invocation.id} does not belong to run ${run.id}.`);
  }

  if (run.status === "FINALIZED" || run.status === "BLOCKED") {
    throw new ApiError(409, `Cannot attach agent output for run ${run.id} because it is ${run.status}. Create a new run or use a future audit mode.`);
  }

  const attachmentPath = path.join(run.path, ".ui-attachments", `agent-${invocation.id}-${Date.now()}.md`);
  await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
  await fs.writeFile(attachmentPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");

  let nextState: MaestroState = state;
  const stage = runStageForAgentInvocationStage(invocation.stage);
  let runRecord: RunRecord | undefined;
  let stageOutputPath: string | undefined;

  if (stage) {
    const attachResult = await attachRunStage(project, run, stage, attachmentPath);
    nextState = upsertRun(nextState, attachResult.runRecord);
    runRecord = attachResult.runRecord;
    stageOutputPath = attachResult.outputPath;
  }

  const outputResult = await attachAgentInvocationOutput(invocation, attachmentPath);
  nextState = upsertAgentInvocation(nextState, outputResult.invocation);
  await saveState(context.homeDir, nextState);

  return {
    invocation: outputResult.invocation,
    outputPath: outputResult.outputPath,
    stageOutputPath,
    run: runRecord || run
  };
}

async function getRunTimeline(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const events = await generateRunTimeline(run);

  return {
    runId: run.id,
    events
  };
}

async function getRunFile(context: RequestContext, runId: string, fileName: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const normalized = normalizeRunFileName(fileName);

  if (!TEXT_FILE_ALLOWLIST.has(normalized)) {
    throw new ApiError(400, `File is not exposed through the UI API: ${normalized}`);
  }

  const filePath = path.resolve(run.path, normalized);
  assertPathInside(run.path, filePath);
  const content = await fs.readFile(filePath, "utf8").catch(() => undefined);

  if (content === undefined) {
    throw new ApiError(404, "Run file not found.");
  }

  return { fileName: normalized, path: filePath, content };
}

async function attachRunOutputRoute(context: RequestContext, runId: string) {
  const body = asRecord(context.body);
  const stage = requireString(body.stage, "stage") as "supervisor" | "executor" | "reviewer";
  const content = requireString(body.content, "content");
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const attachmentPath = path.join(run.path, ".ui-attachments", `${stage}-${Date.now()}.md`);

  await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
  await fs.writeFile(attachmentPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");

  const result = await attachRunStage(project, run, stage, attachmentPath);
  await saveState(context.homeDir, upsertRun(state, result.runRecord));
  return { run: result.runRecord, outputPath: result.outputPath };
}

async function attachCommitRoute(context: RequestContext, runId: string) {
  const body = asRecord(context.body);
  const commitSha = requireString(body.commit, "commit");
  const commitMessage = requireString(body.message, "message");
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  
  const result = await attachFinalCommit(project, run, commitSha, commitMessage);
  await saveState(context.homeDir, upsertRun(state, result.runRecord));
  return { run: result.runRecord, commitFilePath: result.commitFilePath };
}

async function runControlledAction(context: RequestContext, runId: string): Promise<unknown> {
  const body = asRecord(context.body) as RunActionBody;
  const action = requireString(body.action, "action");

  switch (action) {
    case "NEXT_STEP":
      return executeNextStepAction(context, runId);
    case "CREATE_WORKSPACE":
      return createWorkspaceAction(context, runId, Boolean(body.force));
    case "GENERATE_HANDOFF":
      return generateHandoffAction(context, runId);
    case "CAPTURE_DIFF":
      return captureDiffAction(context, runId);
    case "GENERATE_REVIEW_PACKAGE":
      return generateReviewPackageAction(context, runId);
    case "PATCH_EXPORT":
      return exportPatchAction(context, runId);
    case "PATCH_CHECK":
      return checkPatchAction(context, runId);
    case "PATCH_PLAN":
      return planPatchAction(context, runId);
    case "VALIDATION_WORKSPACE":
      return runValidationAction(context, runId, "WORKSPACE");
    case "VALIDATION_ORIGINAL":
      return runValidationAction(context, runId, "ORIGINAL_REPO");
    case "FINALIZE":
      return finalizeRunAction(context, runId);
    case "DECIDE":
      return decideRunAction(context, runId, body);
    case "PATCH_APPLY":
      throw new ApiError(403, "PATCH_APPLY is intentionally disabled in the UI MVP.");
    default:
      throw new ApiError(400, `Unsupported run action: ${action}`);
  }
}

async function executeNextStepAction(context: RequestContext, runId: string): Promise<unknown> {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  
  // Determine next action based on run status and artifacts
  const nextAction = await determineNextAction(run, state, context.homeDir);
  
  switch (nextAction.type) {
    case "INVOKE_AGENT":
      // For FULL_STACK_EXECUTOR, ensure workspace exists before invocation
      if (nextAction.role === "FULL_STACK_EXECUTOR") {
        const workspace = state.workspaces.find((item) => item.runId === run.id);
        if (!workspace) {
          // Create workspace automatically before invoking executor
          await createWorkspaceAction(context, runId, false);
          // Reload state to get updated workspace
          const { state: updatedState } = await loadState(context.homeDir);
          context = { ...context, body: { role: nextAction.role } };
          // Use updated state for invocation
          return invokeRunAgentRoute(context, runId);
        }
      }
      
      // Invoke the specified agent role
      const invokeContext = {
        ...context,
        body: { role: nextAction.role }
      };
      return invokeRunAgentRoute(invokeContext, runId);
    
    case "RUN_ACTION":
      // Execute a run action (patch export, check, plan, etc)
      const actionContext = {
        ...context,
        body: { action: nextAction.action }
      };
      return runControlledAction(actionContext, runId);
    
    case "NEEDS_HUMAN_DECISION":
      return {
        nextStep: "NEEDS_HUMAN_DECISION",
        message: "Reviewer completed. Human decision required.",
        reviewerVerdict: nextAction.reviewerVerdict,
        canApprove: true
      };
    
    case "NEEDS_APPLY_CONFIRMATION":
      return {
        nextStep: "NEEDS_APPLY_CONFIRMATION",
        message: "Patch plan ready. Apply confirmation required.",
        patchPlanPath: nextAction.patchPlanPath
      };
    
    case "NEEDS_MANUAL_COMMIT":
      return {
        nextStep: "NEEDS_MANUAL_COMMIT",
        message: "Patch applied to original repo. Manual commit required."
      };
    
    case "COMPLETED":
      return {
        nextStep: "COMPLETED",
        message: "Run is finalized."
      };
    
    case "UNKNOWN_STATUS":
      throw new ApiError(400, `Cannot determine next step for run status: ${run.status}`);
    
    default:
      throw new ApiError(500, `Unhandled next action type: ${(nextAction as any).type}`);
  }
}

interface NextStepAction {
  type: "INVOKE_AGENT" | "RUN_ACTION" | "NEEDS_HUMAN_DECISION" | "NEEDS_APPLY_CONFIRMATION" | "NEEDS_MANUAL_COMMIT" | "COMPLETED" | "UNKNOWN_STATUS";
  role?: AgentRole;
  action?: string;
  reviewerVerdict?: string;
  patchPlanPath?: string;
}

async function determineNextAction(run: RunRecord, state: MaestroState, homeDir: string): Promise<NextStepAction> {
  // Check for artifacts to determine intermediate states
  const hasPromotionPatch = await fileExists(path.join(run.path, "17-promotion-patch.patch"));
  const hasPromotionCheck = await fileExists(path.join(run.path, "19-promotion-check.md"));
  const hasApplyPlan = await fileExists(path.join(run.path, "20-apply-plan.md"));
  const hasApplyResult = await fileExists(path.join(run.path, "22-apply-result.md"));
  const hasFinalCommit = await fileExists(path.join(run.path, "26-final-commit.md"));
  
  const decision = state.decisions.find(d => d.runId === run.id);
  const reviewerInvocation = state.agentInvocations
    .filter(inv => inv.runId === run.id && inv.role === "CODE_REVIEWER")
    .sort(byAgentInvocationTimeDesc)[0];
  
  switch (run.status) {
    case "PREPARED":
      return { type: "INVOKE_AGENT", role: "CTO_SUPERVISOR" };
    
    case "SUPERVISOR_PLANNED":
      return { type: "INVOKE_AGENT", role: "FULL_STACK_EXECUTOR" };
    
    case "EXECUTOR_REPORTED":
      return { type: "INVOKE_AGENT", role: "CODE_REVIEWER" };
    
    case "REVIEWED":
      if (!decision) {
        // Check reviewer verdict from invocation output
        let reviewerVerdict = "UNKNOWN";
        if (reviewerInvocation?.outputPath) {
          try {
            const output = await fs.readFile(reviewerInvocation.outputPath, "utf8");
            if (output.includes("APPROVED")) reviewerVerdict = "APPROVED";
            else if (output.includes("NEEDS_CHANGES")) reviewerVerdict = "NEEDS_CHANGES";
            else if (output.includes("REJECTED")) reviewerVerdict = "REJECTED";
          } catch {}
        }
        return { type: "NEEDS_HUMAN_DECISION", reviewerVerdict };
      }
      
      if (decision.status === "APPROVED") {
        // Check if patch already exported
        if (hasPromotionPatch) {
          if (hasPromotionCheck) {
            if (hasApplyPlan) {
              return { type: "NEEDS_APPLY_CONFIRMATION", patchPlanPath: path.join(run.path, "20-apply-plan.md") };
            }
            return { type: "RUN_ACTION", action: "PATCH_PLAN" };
          }
          return { type: "RUN_ACTION", action: "PATCH_CHECK" };
        }
        return { type: "RUN_ACTION", action: "PATCH_EXPORT" };
      }
      
      // NEEDS_CHANGES, REJECTED, or BLOCKED
      return { type: "NEEDS_HUMAN_DECISION", reviewerVerdict: decision.status };
    
    case "FINALIZED":
      return { type: "COMPLETED" };
    
    case "BLOCKED":
      return { type: "NEEDS_HUMAN_DECISION", reviewerVerdict: "BLOCKED" };
    
    default:
      return { type: "UNKNOWN_STATUS" };
  }
}

async function createWorkspaceAction(context: RequestContext, runId: string, force: boolean) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const paths = getMaestroPaths(context.homeDir);
  const workspacePath = path.join(paths.workspacesDir, project.id, run.id);
  const existing = state.workspaces.find((item) => item.runId === run.id);

  if (existing && !force && await directoryExists(existing.workspacePath)) {
    return { workspace: existing, created: false };
  }

  if (force && await directoryExists(workspacePath)) {
    assertPathInside(paths.workspacesDir, workspacePath);
    await fs.rm(workspacePath, { recursive: true, force: true });
  }

  const workspace = await createRunWorkspace({
    projectId: project.id,
    runId: run.id,
    sourceRepoPath: project.repoPath,
    workspacePath
  });
  await fs.writeFile(path.join(run.path, "16-workspace.md"), renderWorkspaceSummary(workspace), "utf8");
  await saveState(context.homeDir, upsertRunWorkspace(state, workspace));
  return { workspace, created: true };
}

async function generateHandoffAction(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const task = run.taskId ? state.tasks.find((item) => item.id === run.taskId) : undefined;
  const workspace = state.workspaces.find((item) => item.runId === run.id);
  return createHandoffPackage(run, project, task, workspace);
}

async function captureDiffAction(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const workspace = state.workspaces.find((item) => item.runId === run.id);
  const useWorkspace = workspace && await directoryExists(workspace.workspacePath);
  const result = await captureRunGitDiff(project, run, {
    repoPath: useWorkspace ? workspace.workspacePath : project.repoPath,
    source: useWorkspace ? "WORKSPACE_SANDBOX" : "ORIGINAL_REPO"
  });

  if (workspace && useWorkspace) {
    await saveState(context.homeDir, upsertRunWorkspace(state, { ...workspace, status: "CAPTURED", updatedAt: new Date().toISOString() }));
  }

  return result;
}

async function generateReviewPackageAction(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const task = run.taskId ? state.tasks.find((item) => item.id === run.taskId) : undefined;
  return createReviewPackage(run, project, task);
}

async function exportPatchAction(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const workspace = getWorkspaceOrThrow(state, run.id);
  const patchPath = path.join(run.path, "17-promotion-patch.patch");

  await exportWorkspacePatch({
    runId: run.id,
    projectId: project.id,
    workspacePath: workspace.workspacePath,
    outPath: patchPath,
    baselineCommit: workspace.baselineCommit
  });

  const patchInfo = await inspectPatch({ patchPath });
  const now = new Date().toISOString();
  const promotion: PatchPromotion = {
    id: `${run.id}-promotion`,
    runId: run.id,
    projectId: project.id,
    workspaceId: workspace.id,
    sourceWorkspacePath: workspace.workspacePath,
    targetRepoPath: project.repoPath,
    patchPath,
    status: "EXPORTED",
    createdAt: now,
    updatedAt: now
  };
  await fs.writeFile(path.join(run.path, "18-promotion-summary.md"), renderPromotionSummary(promotion, patchInfo), "utf8");
  await saveState(context.homeDir, upsertPatchPromotion(state, promotion));
  return { promotion, patchInfo };
}

async function checkPatchAction(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const promotion = getPromotionOrThrow(state, runId);
  const guard = getGitGuardStatus(await inspectGitRepo(promotion.targetRepoPath));
  let nextPromotion: PatchPromotion;
  let output: string;

  if (guard !== "CLEAN") {
    output = `Target repo is ${guard}. Clean or review it before checking the patch.`;
    nextPromotion = { ...promotion, status: "BLOCKED", checkOutput: output, updatedAt: new Date().toISOString() };
  } else {
    const check = await checkPatchApplies({ targetRepoPath: promotion.targetRepoPath, patchPath: promotion.patchPath });
    output = check.output;
    nextPromotion = {
      ...promotion,
      status: check.ok ? "CHECK_PASSED" : "CHECK_FAILED",
      checkOutput: output,
      updatedAt: new Date().toISOString()
    };
  }

  await fs.writeFile(path.join(getRunOrThrow(state, runId).path, "19-promotion-check.md"), renderPromotionCheck(nextPromotion, guard, output), "utf8");
  await saveState(context.homeDir, upsertPatchPromotion(state, nextPromotion));
  return { promotion: nextPromotion, guard };
}

async function planPatchAction(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const promotion = getPromotionOrThrow(state, run.id);
  const patchInfo = await inspectPatch({ patchPath: promotion.patchPath });
  const planPath = path.join(run.path, "20-apply-plan.md");

  await fs.writeFile(planPath, renderApplyPlan(run, project, promotion, patchInfo), "utf8");
  return { planPath, promotion, patchInfo };
}

async function decideRunAction(context: RequestContext, runId: string, body: RunActionBody) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const task = run.taskId ? state.tasks.find((item) => item.id === run.taskId) : undefined;
  const status = body.status || "APPROVED";
  const now = new Date().toISOString();
  let nextState = state;
  let nextTask = task;
  let followUpTask: ProjectTask | undefined;

  if (task) {
    nextTask = updateTaskForDecision(task, status, optionalString(body.notes));
    nextState = upsertTask(nextState, nextTask);
  }

  if (body.createFollowUpTask) {
    followUpTask = createFollowUpTask(project, state, run, body);
    nextState = upsertTask(nextState, followUpTask);
    await appendTaskAddedToBacklog(context.homeDir, project, followUpTask);
  }

  const decision: HumanReviewDecision = {
    id: makeUniqueId(`${run.id}-${status.toLowerCase()}-decision`, state.decisions.map((item) => item.id)),
    runId: run.id,
    projectId: project.id,
    taskId: task?.id,
    status,
    notes: optionalString(body.notes) || "",
    createFollowUpTask: Boolean(body.createFollowUpTask),
    followUpTaskId: followUpTask?.id,
    decidedAt: now
  };

  await writeHumanReviewDecisionArtifacts(context.homeDir, project, run, decision, nextTask, followUpTask);
  nextState = upsertHumanReviewDecision(nextState, decision);
  await saveState(context.homeDir, nextState);
  return { decision, task: nextTask, followUpTask };
}

async function finalizeRunAction(context: RequestContext, runId: string) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const decision = state.decisions.find((item) => item.runId === run.id);
  const result = await finalizeRun(context.homeDir, project, run, decision);
  await saveState(context.homeDir, upsertRun(state, result.runRecord));
  return result;
}

async function runValidationAction(context: RequestContext, runId: string, target: ValidationTarget) {
  const { state } = await loadState(context.homeDir);
  const run = getRunOrThrow(state, runId);
  const project = getProjectOrThrow(state, run.projectId);
  const profile = state.validationProfiles.find((item) => item.projectId === project.id);

  if (!profile || profile.commands.length === 0) {
    throw new ApiError(400, "No validation profile configured for this project.");
  }

  const workspace = state.workspaces.find((item) => item.runId === run.id);
  const cwd = target === "WORKSPACE" ? workspace?.workspacePath : project.repoPath;

  if (!cwd) {
    throw new ApiError(400, `No ${target} path is available for validation.`);
  }

  const commands = profile.commands.filter((command) => command.cwdTarget === target);
  if (commands.length === 0) {
    throw new ApiError(400, `No validation commands configured for ${target}.`);
  }

  const createdAt = new Date().toISOString();
  const validationId = `${run.id}-${target.toLowerCase()}-${createdAt.replace(/[:.]/g, "-")}`;
  const outputDir = path.join(run.path, "validation", validationId);
  const commandResults = [];

  for (const command of commands) {
    const stdoutPath = path.join(outputDir, `${command.id}-stdout.log`);
    const stderrPath = path.join(outputDir, `${command.id}-stderr.log`);
    const result = await runValidationCommand({
      command: command.command,
      args: command.args,
      cwd,
      timeoutMs: command.timeoutMs,
      stdoutPath,
      stderrPath
    });
    const status: ValidationStatus = result.exitCode === null ? "BLOCKED" : result.exitCode === 0 ? "PASSED" : "FAILED";
    commandResults.push({
      commandId: command.id,
      label: command.label,
      commandLine: [command.command, ...command.args].join(" "),
      resolvedCommand: result.resolvedCommand,
      exitCode: result.exitCode,
      status,
      stdoutPath,
      stderrPath,
      durationMs: result.durationMs
    });
  }

  const overallStatus: ValidationStatus = commandResults.some((result) => result.status === "FAILED")
    ? "FAILED"
    : commandResults.some((result) => result.status === "BLOCKED")
      ? "BLOCKED"
      : "PASSED";
  const validationRun: ValidationRun = {
    id: validationId,
    runId: run.id,
    projectId: project.id,
    target,
    status: overallStatus,
    commandResults,
    createdAt,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(outputDir, "validation-summary.json"), `${JSON.stringify(validationRun, null, 2)}\n`, "utf8");
  await saveState(context.homeDir, upsertValidationRun(state, validationRun));
  return { validationRun };
}

async function startPilotRoute(context: RequestContext) {
  const body = asRecord(context.body);
  const projectId = requireString(body.projectId, "projectId");
  const title = optionalString(body.title) || "Pilot task from Maestro UI";
  return createProjectTaskRoute({ ...context, body: { ...body, title, tags: unique([...parseCsv(body.tags), "pilot", "ceo-request"]) } }, projectId);
}

async function getPilotStatusRoute(context: RequestContext, projectId: string) {
  const { state } = await loadState(context.homeDir);
  getProjectOrThrow(state, projectId);
  const tasks = state.tasks.filter((task) => task.projectId === projectId && task.tags.includes("pilot"));
  const runs = state.runs.filter((run) => run.projectId === projectId && (!run.taskId || tasks.some((task) => task.id === run.taskId)));
  return { active: tasks.some((task) => !["DONE", "CANCELLED"].includes(task.status)), tasks, runs };
}

async function getPilotNextRoute(context: RequestContext, projectId: string) {
  const status = await getPilotStatusRoute(context, projectId) as { tasks: ProjectTask[]; runs: RunRecord[] };
  const task = status.tasks.find((item) => item.status === "TODO" || item.status === "READY");
  const run = status.runs.find((item) => !["FINALIZED", "BLOCKED"].includes(item.status));

  if (run) {
    return { next: getNextRunStep(run), run };
  }

  if (task) {
    return { next: `Prepare a run for task ${task.id}.`, task };
  }

  return { next: "Create a pilot task or choose the next project task." };
}

async function loadState(homeDir: string): Promise<{ state: MaestroState }> {
  await createProjectVaultIfNeeded(homeDir);
  return ensureStateFile(homeDir);
}

async function ensureDefaultAgentModelMap(homeDir: string): Promise<string> {
  const modelMapPath = path.join(getMaestroPaths(homeDir).configDir, "agent-model-map.json");
  const exists = await fs.stat(modelMapPath).then((stats) => stats.isFile()).catch(() => false);

  await fs.mkdir(path.dirname(modelMapPath), { recursive: true });
  if (!exists) {
    await fs.writeFile(modelMapPath, `${JSON.stringify(DEFAULT_AGENT_MODEL_MAP, null, 2)}\n`, "utf8");
  }

  return modelMapPath;
}

async function readOpenClaudeRuntimeConfig(homeDir: string): Promise<OpenClaudeAdapterConfig | undefined> {
  const configPath = path.join(getMaestroPaths(homeDir).configDir, "openclaude-runtime.json");
  const content = await fs.readFile(configPath, "utf8").catch(() => undefined);

  if (!content) {
    return undefined;
  }

  return JSON.parse(content) as OpenClaudeAdapterConfig;
}

async function createProjectVaultIfNeeded(homeDir: string): Promise<void> {
  await ensureStateFile(homeDir);
}

async function enrichProjectSummary(homeDir: string, state: MaestroState, project: Project) {
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const runs = state.runs.filter((run) => run.projectId === project.id);
  const decisions = state.decisions.filter((decision) => decision.projectId === project.id);
  const memoryStatus = await getProjectMemoryConsolidationStatus(homeDir, project).catch(() => undefined);
  const contextStatus = await getProjectContextStatus(homeDir, project.id).catch(() => undefined);

  return {
    ...project,
    totalTasks: tasks.length,
    openRuns: runs.filter((run) => !["FINALIZED", "BLOCKED"].includes(run.status)).length,
    reviewNeededTasks: tasks.filter((task) => task.status === "REVIEW_NEEDED").length,
    latestDecision: decisions.sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0],
    activeContextExists: memoryStatus?.activeContextExists || false,
    contextStatus
  };
}

async function getRunsAwaitingDecision(runs: RunRecord[], decisions: HumanReviewDecision[]): Promise<RunRecord[]> {
  const awaiting: RunRecord[] = [];
  for (const run of runs) {
    if (decisions.some((decision) => decision.runId === run.id)) continue;
    if (await fileExists(path.join(run.path, "09-reviewer-output.md"))) awaiting.push(run);
  }
  return awaiting;
}

async function getExtraRunFiles(run: RunRecord) {
  const names = [
    "17-promotion-patch.patch",
    "18-promotion-summary.md",
    "19-promotion-check.md",
    "20-apply-plan.md",
    "handoff/07-kiro-prompt.md",
    "review/08-codex-reviewer-prompt.md"
  ];

  return Promise.all(names.map(async (fileName) => {
    const filePath = path.join(run.path, fileName);
    const stats = await fs.stat(filePath).catch(() => undefined);
    return { fileName, path: filePath, exists: Boolean(stats?.isFile()), sizeBytes: stats?.size || 0 };
  }));
}

async function buildRunChecklist(
  run: RunRecord,
  workspace: RunWorkspace | undefined,
  promotion: PatchPromotion | undefined,
  decision: HumanReviewDecision | undefined,
  validationRuns: ValidationRun[]
) {
  return [
    { id: "supervisor", label: "Supervisor plan anexado", done: await fileExists(path.join(run.path, "07-supervisor-output.md")) },
    { id: "workspace", label: "Workspace criado", done: Boolean(workspace) },
    { id: "handoff", label: "Handoff gerado", done: await fileExists(path.join(run.path, "handoff", "07-kiro-prompt.md")) },
    { id: "executor", label: "Executor output anexado", done: await fileExists(path.join(run.path, "08-executor-output.md")) },
    { id: "diff", label: "Diff capturado", done: await fileExists(path.join(run.path, "13-git-diff.md")) },
    { id: "reviewPackage", label: "Review package gerado", done: await fileExists(path.join(run.path, "review", "08-codex-reviewer-prompt.md")) },
    { id: "reviewer", label: "Reviewer output anexado", done: await fileExists(path.join(run.path, "09-reviewer-output.md")) },
    { id: "decision", label: "Decisao humana registrada", done: Boolean(decision) },
    { id: "patchExport", label: "Patch exportado", done: Boolean(promotion) },
    { id: "patchCheck", label: "Patch check passou", done: promotion?.status === "CHECK_PASSED" || promotion?.status === "APPLIED" },
    { id: "patchPlan", label: "Patch plan gerado", done: await fileExists(path.join(run.path, "20-apply-plan.md")) },
    { id: "patchApplied", label: "Patch aplicado", done: promotion?.status === "APPLIED" },
    { id: "validationOriginal", label: "Validacao original rodada", done: validationRuns.some((item) => item.target === "ORIGINAL_REPO") }
  ];
}

async function buildNextActions(
  run: RunRecord,
  workspace: RunWorkspace | undefined,
  promotion: PatchPromotion | undefined,
  decision: HumanReviewDecision | undefined
): Promise<NextAction[]> {
  const hasSupervisor = await fileExists(path.join(run.path, "07-supervisor-output.md"));
  const hasHandoff = await fileExists(path.join(run.path, "handoff", "07-kiro-prompt.md"));
  const hasExecutor = await fileExists(path.join(run.path, "08-executor-output.md"));
  const hasDiff = await fileExists(path.join(run.path, "13-git-diff.md"));
  const hasReviewPackage = await fileExists(path.join(run.path, "review", "08-codex-reviewer-prompt.md"));
  const hasReviewer = await fileExists(path.join(run.path, "09-reviewer-output.md"));
  const hasPatchPlan = await fileExists(path.join(run.path, "20-apply-plan.md"));

  if (!hasSupervisor) {
    return [
      {
        label: "Copiar prompt do Codex Supervisor",
        description: "Copie o prompt, cole no Codex e peça um plano tecnico sem modificar arquivos.",
        actionType: "COPY_PROMPT",
        primary: true,
        fileToOpen: "03-codex-supervisor-prompt.md"
      },
      {
        label: "Anexar plano do Supervisor",
        description: "Depois que o Codex responder, cole a resposta em Anexar saida do Codex Supervisor.",
        actionType: "ATTACH_OUTPUT",
        stage: "supervisor"
      }
    ];
  }

  if (!workspace) {
    return [
      {
        label: "Criar workspace sandbox",
        description: "Crie a copia segura da run. O Kiro trabalhara somente nesse workspace.",
        actionType: "RUN_ACTION",
        primary: true,
        runAction: "CREATE_WORKSPACE"
      }
    ];
  }

  if (!hasHandoff) {
    return [
      {
        label: "Gerar Kiro Handoff",
        description: "Monte o pacote fechado com plano aprovado, regras, contrato da task e prompt do Kiro.",
        actionType: "RUN_ACTION",
        primary: true,
        runAction: "GENERATE_HANDOFF"
      }
    ];
  }

  if (!hasExecutor) {
    return [
      {
        label: "Copiar prompt do Kiro",
        description: "Entregue o prompt ao Kiro manualmente. Ele deve trabalhar somente no workspace sandbox.",
        actionType: "COPY_PROMPT",
        primary: true,
        fileToOpen: "handoff/07-kiro-prompt.md"
      },
      {
        label: "Anexar relatorio do Kiro",
        description: "Depois da execucao manual, cole o relatorio do executor.",
        actionType: "ATTACH_OUTPUT",
        stage: "executor"
      }
    ];
  }

  if (!hasDiff) {
    return [
      {
        label: "Capturar diff real",
        description: "Capture o diff do workspace para o Codex Reviewer revisar evidencia real.",
        actionType: "RUN_ACTION",
        primary: true,
        runAction: "CAPTURE_DIFF"
      }
    ];
  }

  if (!hasReviewPackage) {
    return [
      {
        label: "Gerar Codex Review Package",
        description: "Monte o pacote de revisao com plano, relatorio do executor e diff real.",
        actionType: "RUN_ACTION",
        primary: true,
        runAction: "GENERATE_REVIEW_PACKAGE"
      }
    ];
  }

  if (!hasReviewer) {
    return [
      {
        label: "Copiar prompt do Codex Reviewer",
        description: "Cole o prompt no Codex para revisar o diff real e depois anexe o veredito.",
        actionType: "COPY_PROMPT",
        primary: true,
        fileToOpen: "review/08-codex-reviewer-prompt.md"
      },
      {
        label: "Anexar revisao do Codex",
        description: "Cole o veredito do Codex Reviewer.",
        actionType: "ATTACH_OUTPUT",
        stage: "reviewer"
      }
    ];
  }

  if (!decision) {
    return [
      {
        label: "Registrar decisao humana",
        description: "O Codex recomenda, mas o aceite final e humano.",
        actionType: "MANUAL",
        primary: true
      }
    ];
  }

  if (!promotion) {
    return [
      {
        label: "Exportar patch de promocao",
        description: "Gere o patch a partir do sandbox aprovado. Ele ainda nao sera aplicado no repo original.",
        actionType: "RUN_ACTION",
        primary: true,
        runAction: "PATCH_EXPORT"
      }
    ];
  }

  if (promotion.status !== "CHECK_PASSED" && promotion.status !== "APPLIED") {
    return [
      {
        label: "Checar patch",
        description: "Valide com git apply --check se o patch aplicaria no repo original limpo.",
        actionType: "RUN_ACTION",
        primary: true,
        runAction: "PATCH_CHECK"
      }
    ];
  }

  if (!hasPatchPlan) {
    return [
      {
        label: "Gerar plano de apply",
        description: "Crie o documento de promocao futura. A UI ainda nao aplica patch.",
        actionType: "RUN_ACTION",
        primary: true,
        runAction: "PATCH_PLAN"
      }
    ];
  }

  return [
    {
      label: "Run pronta para proxima etapa manual",
      description: "O plano de promocao existe. A aplicacao no repo original exige passo futuro com confirmacao explicita.",
      actionType: "MANUAL",
      primary: true
    }
  ];
}

function getProjectNextStep(project: Project, tasks: ProjectTask[], runsAwaitingDecision: RunRecord[]): string {
  if (runsAwaitingDecision.length > 0) return `Registrar decisao humana para ${runsAwaitingDecision[0].id}.`;
  const reviewTask = tasks.find((task) => task.status === "REVIEW_NEEDED");
  if (reviewTask) return `Decidir destino da task ${reviewTask.id}.`;
  const openTask = tasks.find((task) => task.status === "TODO" || task.status === "READY");
  if (openTask) return `Preparar run para ${openTask.id}.`;
  return project.description || "Criar ou priorizar a proxima task.";
}

function updateTaskForDecision(task: ProjectTask, status: HumanDecisionStatus, notes?: string): ProjectTask {
  const now = new Date().toISOString();
  if (status === "APPROVED") return { ...task, status: "DONE", completedAt: now, updatedAt: now };
  if (status === "BLOCKED") return { ...task, status: "BLOCKED", blockedReason: notes, updatedAt: now };
  return { ...task, status: "TODO", updatedAt: now };
}

function createFollowUpTask(project: Project, state: MaestroState, run: RunRecord, body: RunActionBody): ProjectTask {
  const now = new Date().toISOString();
  const title = body.followUpTitle || `Correcoes da run ${run.id}`;
  return {
    id: makeUniqueId(`${project.id}-follow-up-${title}`, state.tasks.map((item) => item.id)),
    projectId: project.id,
    title,
    description:
      body.followUpDescription ||
      [`Follow-up da run ${run.id}.`, "", "Objetivo original:", run.goal, "", "Notas humanas:", body.notes || "Not provided."].join("\n"),
    status: "TODO",
    priority: body.followUpPriority || "HIGH",
    tags: unique(["follow-up", "review-fix", ...parseCsv(body.followUpTags)]),
    relatedRunIds: [run.id],
    createdAt: now,
    updatedAt: now
  };
}

function renderTaskGoal(task: ProjectTask, extraGoal?: string): string {
  return [
    `Task: ${task.title}`,
    "",
    "Description:",
    task.description || "Not provided.",
    "",
    `Task id: ${task.id}`,
    extraGoal ? `\nAdditional note:\n${extraGoal}` : ""
  ].join("\n");
}

function renderWorkspaceSummary(workspace: RunWorkspace): string {
  return `# Run Workspace Sandbox

## Status

${workspace.status}

## Source repo

${workspace.sourceRepoPath}

## Workspace path

${workspace.workspacePath}

## Baseline commit

${workspace.baselineCommit || "not available"}

## Regras

- O Kiro deve trabalhar somente neste workspace.
- Nao trabalhar no repo original.
- O diff da execucao sera capturado a partir deste sandbox.
`;
}

function renderPromotionSummary(promotion: PatchPromotion, patchInfo: Awaited<ReturnType<typeof inspectPatch>>): string {
  return `# Patch Promotion Summary

## Run

${promotion.runId}

## Projeto

${promotion.projectId}

## Workspace source

${promotion.sourceWorkspacePath}

## Target repo

${promotion.targetRepoPath}

## Patch path

${promotion.patchPath}

## Arquivos alterados

${patchInfo.filesChanged.map((file) => `- ${file}`).join("\n") || "- none"}

## Tamanho do patch

${patchInfo.sizeBytes} bytes

## Status

${promotion.status}

## Observacoes

Este patch foi gerado a partir do workspace sandbox.
Ele ainda nao foi aplicado no repo original.
`;
}

function renderPromotionCheck(promotion: PatchPromotion, guard: string, output: string): string {
  return `# Patch Promotion Check

## Status

${promotion.status}

## Target repo clean?

${guard === "CLEAN" ? "sim" : "nao"}

## Comando executado

${guard === "CLEAN" ? `git apply --check ${promotion.patchPath}` : "nao executado - repo original nao esta limpo"}

## Saida

\`\`\`text
${output || "No output."}
\`\`\`

## Proximo passo sugerido

${promotion.status === "CHECK_PASSED" ? "Gerar o apply plan." : "Resolver o bloqueio ou conflito antes de promover."}
`;
}

function renderApplyPlan(
  run: RunRecord,
  project: Project,
  promotion: PatchPromotion,
  patchInfo: Awaited<ReturnType<typeof inspectPatch>>
): string {
  return `# Apply Plan

## Run

${run.id}

## Projeto

${project.name} (${project.id})

## Target repo

${promotion.targetRepoPath}

## Patch

${promotion.patchPath}

## Status do check

${promotion.status}

## Pre-condicoes

- Repo original precisa estar limpo.
- Patch precisa ter status CHECK_PASSED.
- Decisao humana precisa ser APPROVED.
- Usuario precisa executar o apply explicitamente em passo futuro.

## Arquivos que serao alterados

${patchInfo.filesChanged.map((file) => `- ${file}`).join("\n") || "- none"}

## Riscos

- O repo original pode ter mudado desde a criacao do workspace.
- O patch pode precisar de revisao manual se houver conflitos.
- Validacoes devem rodar depois da aplicacao futura.

## Comando futuro de aplicacao

\`\`\`bash
corepack pnpm run maestro run patch apply --run ${run.id} --confirm APPLY_TO_ORIGINAL_REPO
\`\`\`
`;
}

function normalizeRunFileName(fileName: string): string {
  return fileName.replace(/\\/g, "/").replace(/^\/+/u, "");
}

function getProjectOrThrow(state: MaestroState, projectId: string): Project {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new ApiError(404, `Project not found: ${projectId}`);
  return project;
}

function getRunOrThrow(state: MaestroState, runId: string): RunRecord {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) throw new ApiError(404, `Run not found: ${runId}`);
  return run;
}

function getRunAgentProfiles(state: MaestroState, projectId: string) {
  return state.agentProfiles.filter((profile) => !profile.projectIds || profile.projectIds.includes(projectId));
}

function getAgentProfileForRoleOrThrow(state: MaestroState, role: AgentRole, projectId: string) {
  const profile = state.agentProfiles.find((item) => item.role === role && (!item.projectIds || item.projectIds.includes(projectId)));

  if (!profile) {
    throw new ApiError(404, `Agent profile not found for role ${role}. Run agents init-defaults first.`);
  }

  return profile;
}

function getAgentInvocationOrThrow(state: MaestroState, invocationId: string): AgentInvocation {
  const invocation = state.agentInvocations.find((item) => item.id === invocationId);

  if (!invocation) {
    throw new ApiError(404, `Agent invocation not found: ${invocationId}`);
  }

  return invocation;
}

function runStageForAgentInvocationStage(stage: AgentInvocation["stage"]): "supervisor" | "executor" | "reviewer" | undefined {
  switch (stage) {
    case "SUPERVISOR_PLAN":
      return "supervisor";
    case "EXECUTOR_IMPLEMENT":
      return "executor";
    case "REVIEWER_REVIEW":
      return "reviewer";
    case "CEO_INTAKE":
    case "QA_VALIDATE":
      return undefined;
  }
}

function getTaskOrThrow(state: MaestroState, taskId: string): ProjectTask {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new ApiError(404, `Task not found: ${taskId}`);
  return task;
}

function getWorkspaceOrThrow(state: MaestroState, runId: string): RunWorkspace {
  const workspace = state.workspaces.find((item) => item.runId === runId);
  if (!workspace) throw new ApiError(400, `Workspace not found for run: ${runId}`);
  return workspace;
}

function getPromotionOrThrow(state: MaestroState, runId: string): PatchPromotion {
  const promotion = state.promotions.find((item) => item.runId === runId);
  if (!promotion) throw new ApiError(400, `Patch promotion not found for run: ${runId}`);
  return promotion;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, `${name} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseCsv(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[getKey(item)] = (counts[getKey(item)] || 0) + 1;
  return counts;
}

function byUpdatedAtDesc<T extends { updatedAt: string }>(left: T, right: T): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function byAgentInvocationTimeDesc(left: { startedAt?: string; completedAt?: string }, right: { startedAt?: string; completedAt?: string }): number {
  const leftTime = left.completedAt || left.startedAt || "";
  const rightTime = right.completedAt || right.startedAt || "";
  return rightTime.localeCompare(leftTime);
}

function byCreatedAtDesc<T extends { createdAt: string }>(left: T, right: T): number {
  return right.createdAt.localeCompare(left.createdAt);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function fileExists(filePath: string): Promise<boolean> {
  const stats = await fs.stat(filePath).catch(() => undefined);
  return Boolean(stats?.isFile());
}

async function directoryExists(dirPath: string): Promise<boolean> {
  const stats = await fs.stat(dirPath).catch(() => undefined);
  return Boolean(stats?.isDirectory());
}

function assertPathInside(rootDir: string, targetPath: string): void {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(400, `Path is outside allowed directory: ${target}`);
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;

  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

function writeJson(res: ServerResponse, statusCode: number, value: unknown): void {
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/u.test(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

class ApiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

if (require.main === module) {
  startServer();
}
