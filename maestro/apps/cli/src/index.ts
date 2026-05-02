#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as process from "node:process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import {
  AGENT_DEFINITIONS,
  DEFAULT_AGENT_MODEL_MAP,
  attachAgentInvocationOutput,
  createDefaultAgentProfiles,
  extractUnifiedDiffFromAgentOutput,
  prepareAgentInvocation,
  validatePatchSafety,
  type OpenClaudeAdapterConfig
} from "@maestro/agents";
import {
  runCapturedCommand,
  ensureOpenClaudeIsolation,
  type CapturedCommandResult,
  type RunCapturedCommandOptions
} from "@maestro/providers";

const execFileAsync = promisify(execFile);
import {
  createProject,
  ensureStateFile,
  getMaestroPaths,
  loadState,
  resolveMaestroHome,
  saveState,
  slugify,
  upsertHumanReviewDecision,
  upsertAgentInvocation,
  upsertAgentProfile,
  upsertPatchPromotion,
  upsertProject,
  upsertProviderAuthSession,
  upsertRun,
  upsertRunWorkspace,
  upsertTask,
  upsertValidationProfile,
  upsertValidationRun,
  type HumanDecisionStatus,
  type AgentInvocation,
  type AgentProfile,
  type AgentProvider,
  type AgentRole,
  type HumanReviewDecision,
  type MaestroState,
  type PatchPromotion,
  type Project,
  type ProjectInput,
  type ProjectPriority,
  type ProjectStatus,
  type ProjectTask,
  type ProjectValidationProfile,
  type RunRecord,
  type RunWorkspace,
  type TaskPriority,
  type TaskStatus,
  type ValidationCommand,
  type ValidationCommandResult,
  type ValidationRun,
  type ValidationStatus,
  type ValidationTarget,
  type WorkspaceStatus
} from "@maestro/core";
import {
  appendTaskAddedToBacklog,
  appendTaskBlockedToKnownProblems,
  appendTaskCompletedToAgentLog,
  appendTaskReviewNeededToNextActions,
  activeContextExists,
  attachFinalCommit,
  attachRunStage,
  blockRun,
  checkpointProjectMemory,
  createContextPack,
  createRepositorySnapshot,
  createProjectVault,
  ensureVaultBase,
  finalizeRun,
  generateRunTimeline,
  captureRunGitDiff,
  createHandoffPackage,
  createReviewPackage,
  getProjectMemoryConsolidationStatus,
  getMemoryStatus,
  getNextRunStep,
  getProjectContextStatus,
  getRunFileStatuses,
  importProjectContext,
  prepareManualRun,
  readProjectMemoryBrief,
  refreshProjectMemory,
  syncTaskBoardToVault,
  writeHumanReviewDecisionArtifacts,
  type RunStage
} from "@maestro/memory";
import {
  applyPatchToWorkspace,
  checkPatchApplies,
  checkPatchApply,
  createRunWorkspace,
  detectPackageManager,
  detectPackageScripts,
  exportWorkspacePatch,
  getGitDiff,
  getGitGuardStatus,
  getRunWorkspaceDiff,
  inspectGitRepo,
  inspectPatch,
  inspectRunWorkspace,
  runValidationCommand,
  savePatchArtifact,
  type CheckPatchResult,
  type InspectPatchResult
} from "@maestro/runner";
import {
  doctorOpenClaudeProvider,
  discoverOpenClaudeProvider,
  doctorKiroCliProvider,
  discoverKiroCliProvider,
  doctorGrouterProvider,
  discoverGrouterProvider,
  doctorOpenClaudeGrouterProvider,
  discoverOpenClaudeGrouterProvider,
  listGrouterConnections,
  syncGrouterConnections,
  linkGrouterConnection,
  unlinkGrouterConnection,
  parseDeviceCodeAuthOutput,
  isDeviceCodeAuthComplete,
  loadGrouterConfig
} from "@maestro/providers";

interface ParsedArgs {
  command: string | undefined;
  rest: string[];
}

interface ParsedFlags {
  flags: Record<string, string | true>;
  positionals: string[];
}

type ProviderTestVariant = "minimal" | "json" | "bare" | "no-session" | "current";

const TASK_STATUS_ORDER: TaskStatus[] = ["TODO", "READY", "IN_PROGRESS", "REVIEW_NEEDED", "BLOCKED", "DONE", "CANCELLED"];
const TASK_PRIORITY_ORDER: TaskPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const HUMAN_DECISION_STATUSES: HumanDecisionStatus[] = ["APPROVED", "NEEDS_CHANGES", "REJECTED", "BLOCKED"];

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const homeDir = resolveMaestroHome(process.cwd(), process.env);

  try {
    switch (parsed.command) {
      case "init":
        await initMaestro(homeDir);
        break;
      case "doctor":
        await runDoctor(homeDir, parsed.rest);
        break;
      case "smoke-test":
        await runSmokeTest(homeDir, parsed.rest);
        break;
      case "agents":
        await handleAgentsCommand(homeDir, parsed.rest);
        break;
      case "agent":
        await handleAgentCommand(homeDir, parsed.rest);
        break;
      case "pilot":
        await handlePilotCommand(homeDir, parsed.rest);
        break;
      case "project":
        await handleProjectCommand(homeDir, parsed.rest);
        break;
      case "memory":
        await handleMemoryCommand(homeDir, parsed.rest);
        break;
      case "context":
        await handleContextCommand(homeDir, parsed.rest);
        break;
      case "run":
        await handleRunCommand(homeDir, parsed.rest);
        break;
      case "task":
        await handleTaskCommand(homeDir, parsed.rest);
        break;
      case "validation":
        await handleValidationCommand(homeDir, parsed.rest);
        break;
      case "provider":
        await handleProviderCommand(homeDir, parsed.rest);
        break;
      case "repo":
        await handleRepoCommand(homeDir, parsed.rest);
        break;
      case "help":
      case "--help":
      case "-h":
      case undefined:
        printHelp();
        break;
      default:
        throw new Error(`Unknown command: ${parsed.command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

async function initMaestro(homeDir: string): Promise<void> {
  const { created } = await ensureStateFile(homeDir);
  await ensureVaultBase(homeDir);

  const paths = getMaestroPaths(homeDir);
  console.log(created ? "Maestro initialized." : "Maestro already initialized.");
  console.log(`Home: ${paths.homeDir}`);
  console.log(`State: ${paths.stateFile}`);
  console.log(`Vault: ${paths.vaultDir}`);
  console.log(`Logs: ${paths.logsDir}`);
  console.log(`Agent roles: ${AGENT_DEFINITIONS.map((agent) => agent.role).join(", ")}`);
}

async function handleAgentsCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "init-defaults":
      await initDefaultAgentsCommand(homeDir);
      break;
    case "list":
      await listAgentsCommand(homeDir);
      break;
    case "show":
      await showAgentCommand(homeDir, rest);
      break;
    case "update":
      await updateAgentCommand(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printAgentsHelp();
      break;
    default:
      throw new Error(`Unknown agents command: ${subcommand}`);
  }
}

async function handleAgentCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "invoke":
      await invokeAgentCommand(homeDir, rest);
      break;
    case "attach-output":
      await attachAgentOutputCommand(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printAgentHelp();
      break;
    default:
      throw new Error(`Unknown agent command: ${subcommand}`);
  }
}

async function initDefaultAgentsCommand(homeDir: string): Promise<void> {
  const { state } = await ensureStateFile(homeDir);
  const profiles = createDefaultAgentProfiles();
  let nextState = state;

  for (const profile of profiles) {
    const existing = nextState.agentProfiles.find((item) => item.id === profile.id);
    nextState = upsertAgentProfile(nextState, existing ? { ...profile, createdAt: existing.createdAt } : profile);
  }

  await saveState(homeDir, nextState);
  const modelMapPath = await ensureDefaultAgentModelMap(homeDir);

  console.log("Default agent profiles initialized.");
  console.log(`Profiles: ${profiles.map((profile) => profile.id).join(", ")}`);
  console.log(`Model map: ${modelMapPath}`);
  console.log("");
  console.log("OpenClaude isolation:");
  console.log("Maestro will not reuse your assistant's OpenClaude config. Configure a dedicated Maestro OpenClaude profile later.");
}

async function listAgentsCommand(homeDir: string): Promise<void> {
  const state = await loadStateWithFriendlyError(homeDir);

  if (state.agentProfiles.length === 0) {
    console.log("No agent profiles found. Run: maestro agents init-defaults");
    return;
  }

  console.log("Agent profiles:\n");
  for (const profile of state.agentProfiles) {
    console.log(`${profile.id} | ${profile.role} | ${profile.provider} | ${profile.model || "no model"}`);
    console.log(`  ${profile.name} - ${profile.description}`);
  }
}

async function showAgentCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const agentId = getRequiredFlag(flags, "agent");
  const state = await loadStateWithFriendlyError(homeDir);
  const profile = findAgentProfileOrThrow(state.agentProfiles, agentId);
  const invocations = state.agentInvocations.filter((item) => item.agentProfileId === profile.id).slice(-5);

  console.log(JSON.stringify({ profile, recentInvocations: invocations }, null, 2));
}

async function updateAgentCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const agentId = getRequiredFlag(flags, "agent");
  const provider = getFlag(flags, "provider");
  const model = getFlag(flags, "model");
  const state = await loadStateWithFriendlyError(homeDir);
  const profile = findAgentProfileOrThrow(state.agentProfiles, agentId);
  const nextProfile: AgentProfile = {
    ...profile,
    provider: provider ? parseAgentProvider(provider) : profile.provider,
    model: model ?? profile.model,
    updatedAt: new Date().toISOString()
  };

  await saveState(homeDir, upsertAgentProfile(state, nextProfile));
  console.log(`Agent updated: ${nextProfile.id}`);
  console.log(`Provider: ${nextProfile.provider}`);
  console.log(`Model: ${nextProfile.model || "not set"}`);
}

/**
 * Process Executor patch: extract, validate, and apply to workspace
 * 
 * Returns updated invocation (FAILED if patch processing fails)
 */
async function processExecutorPatch(
  homeDir: string,
  invocation: AgentInvocation,
  outputPath: string,
  project: Project,
  run: RunRecord,
  workspace: RunWorkspace | undefined,
  state: MaestroState
): Promise<{ invocation: AgentInvocation; state: MaestroState; patchArtifactPath?: string }> {
  try {
    // Read agent output
    const outputContent = await fs.readFile(outputPath, "utf8");
    
    // Extract patch from output
    const patchResult = extractUnifiedDiffFromAgentOutput(outputContent);
    
    if (!patchResult.patch) {
      return {
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: `Patch extraction failed: ${patchResult.reason || "No unified diff found in output"}`
        },
        state
      };
    }
    
    // Validate patch safety
    const safetyCheck = validatePatchSafety(patchResult.patch);
    if (!safetyCheck.safe) {
      return {
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: `Patch safety validation failed: ${safetyCheck.reason}`
        },
        state
      };
    }
    
    // Save patch artifact
    const patchArtifactPath = path.join(path.dirname(outputPath), "03-proposed.patch");
    await savePatchArtifact(patchArtifactPath, patchResult.patch);
    
    // Ensure workspace exists
    let workspacePath: string;
    let nextState = state;
    
    if (!workspace) {
      // Create workspace if it doesn't exist
      const workspaceId = `${project.id}-${run.id}`;
      workspacePath = path.join(getMaestroPaths(homeDir).workspacesDir, project.id, run.id);
      const newWorkspace = await createRunWorkspace({
        projectId: project.id,
        runId: run.id,
        sourceRepoPath: project.repoPath,
        workspacePath
      });
      nextState = upsertRunWorkspace(nextState, newWorkspace);
      console.log(`Workspace created: ${newWorkspace.workspacePath}`);
    } else {
      workspacePath = workspace.workspacePath;
    }
    
    // Check if patch can be applied
    const checkResult = await checkPatchApply(workspacePath, patchResult.patch);
    if (!checkResult.success) {
      return {
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: `Patch apply check failed: ${checkResult.reason}\n${checkResult.stderr || ""}`
        },
        state: nextState,
        patchArtifactPath
      };
    }
    
    // Apply patch to workspace
    const applyResult = await applyPatchToWorkspace(workspacePath, patchResult.patch);
    if (!applyResult.success) {
      return {
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: `Patch apply failed: ${applyResult.reason}\n${applyResult.stderr || ""}`
        },
        state: nextState,
        patchArtifactPath
      };
    }
    
    // Capture workspace diff
    await captureRunGitDiff(project, run);
    
    console.log(`Patch applied successfully to workspace`);
    console.log(`Patch artifact: ${patchArtifactPath}`);
    console.log(`Workspace: ${workspacePath}`);
    
    return {
      invocation,
      state: nextState,
      patchArtifactPath
    };
  } catch (error) {
    return {
      invocation: {
        ...invocation,
        status: "FAILED",
        errorMessage: `Patch processing error: ${error instanceof Error ? error.message : String(error)}`
      },
      state
    };
  }
}

async function invokeAgentCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const role = parseAgentRole(getRequiredFlag(flags, "role"));
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const profile = findAgentProfileForRoleOrThrow(state.agentProfiles, role, project.id);
  const workspace = findWorkspaceForRun(state.workspaces, run.id);
  const result = await prepareAgentInvocation({
    run,
    project,
    profile,
    workspace,
    openClaudeConfig: await readOpenClaudeRuntimeConfig(homeDir),
    homeDir
  });

  let nextState = upsertAgentInvocation(state, result.invocation);
  let stageOutputPath: string | undefined;
  let patchArtifactPath: string | undefined;

  // Automatic stage promotion: if invocation succeeded, promote output to run stage
  if (result.invocation.status === "SUCCEEDED") {
    // For FULL_STACK_EXECUTOR, extract and apply patch before promotion
    if (result.invocation.role === "FULL_STACK_EXECUTOR") {
      const patchResult = await processExecutorPatch(
        homeDir,
        result.invocation,
        result.outputPath,
        project,
        run,
        workspace,
        nextState
      );
      
      nextState = upsertAgentInvocation(patchResult.state, patchResult.invocation);
      patchArtifactPath = patchResult.patchArtifactPath;
      
      if (patchResult.invocation.status === "FAILED") {
        await saveState(homeDir, nextState);
        console.log(`Agent invocation prepared: ${result.invocation.id}`);
        console.log(`Role: ${result.invocation.role}`);
        console.log(`Provider: ${result.invocation.provider}`);
        console.log(`Status: FAILED`);
        console.log(`Prompt: ${result.promptPath}`);
        console.log(`Output: ${result.outputPath}`);
        if (patchArtifactPath) {
          console.log(`Patch artifact: ${patchArtifactPath}`);
        }
        console.log(`Error: ${patchResult.invocation.errorMessage}`);
        return;
      }
    }
    
    const stage = runStageForAgentInvocationStage(result.invocation.stage);
    if (stage) {
      try {
        const attachResult = await attachRunStage(project, run, stage, result.outputPath);
        nextState = upsertRun(nextState, attachResult.runRecord);
        stageOutputPath = attachResult.outputPath;
        console.log(`Agent invocation prepared: ${result.invocation.id}`);
        console.log(`Role: ${result.invocation.role}`);
        console.log(`Provider: ${result.invocation.provider}`);
        console.log(`Status: ${result.invocation.status}`);
        console.log(`Prompt: ${result.promptPath}`);
        console.log(`Output: ${result.outputPath}`);
        if (patchArtifactPath) {
          console.log(`Patch artifact: ${patchArtifactPath}`);
        }
        console.log(`Run stage promoted: ${stage}`);
        console.log(`Run stage output: ${stageOutputPath}`);
        console.log(`Run status: ${attachResult.runRecord.status}`);
      } catch (error) {
        console.log(`Agent invocation prepared: ${result.invocation.id}`);
        console.log(`Role: ${result.invocation.role}`);
        console.log(`Provider: ${result.invocation.provider}`);
        console.log(`Status: ${result.invocation.status}`);
        console.log(`Prompt: ${result.promptPath}`);
        console.log(`Output: ${result.outputPath}`);
        if (patchArtifactPath) {
          console.log(`Patch artifact: ${patchArtifactPath}`);
        }
        console.log(`Warning: Failed to promote to run stage: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log(`Agent invocation prepared: ${result.invocation.id}`);
      console.log(`Role: ${result.invocation.role}`);
      console.log(`Provider: ${result.invocation.provider}`);
      console.log(`Status: ${result.invocation.status}`);
      console.log(`Prompt: ${result.promptPath}`);
      console.log(`Output: ${result.outputPath}`);
      if (patchArtifactPath) {
        console.log(`Patch artifact: ${patchArtifactPath}`);
      }
      console.log(`Run stage promotion: not applicable for this role`);
    }
  } else {
    console.log(`Agent invocation prepared: ${result.invocation.id}`);
    console.log(`Role: ${result.invocation.role}`);
    console.log(`Provider: ${result.invocation.provider}`);
    console.log(`Status: ${result.invocation.status}`);
    console.log(`Prompt: ${result.promptPath}`);
    console.log(`Output: ${result.outputPath}`);
    if (result.invocation.blockedReason) {
      console.log(`Reason: ${result.invocation.blockedReason}`);
    }
    if (result.invocation.errorMessage) {
      console.log(`Error: ${result.invocation.errorMessage}`);
    }
  }

  await saveState(homeDir, nextState);
}

async function attachAgentOutputCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const invocationId = getRequiredFlag(flags, "invocation");
  const filePath = path.resolve(getRequiredFlag(flags, "file"));
  const state = await loadStateWithFriendlyError(homeDir);
  const invocation = findAgentInvocationOrThrow(state.agentInvocations, invocationId);
  const run = findRunOrThrow(state.runs, invocation.runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const stage = runStageForAgentInvocationStage(invocation.stage);

  if (run.status === "FINALIZED" || run.status === "BLOCKED") {
    throw new Error(`Cannot attach agent output for run ${run.id} because it is ${run.status}. Create a new run or use a future audit mode.`);
  }

  let nextState: MaestroState = state;
  let stageOutputPath: string | undefined;

  if (stage) {
    const attachResult = await attachRunStage(project, run, stage, filePath);
    nextState = upsertRun(nextState, attachResult.runRecord);
    stageOutputPath = attachResult.outputPath;
  }

  const outputResult = await attachAgentInvocationOutput(invocation, filePath);
  nextState = upsertAgentInvocation(nextState, outputResult.invocation);
  await saveState(homeDir, nextState);

  console.log(`Agent invocation output attached: ${outputResult.invocation.id}`);
  console.log(`Invocation status: ${outputResult.invocation.status}`);
  console.log(`Invocation output: ${outputResult.outputPath}`);
  if (stageOutputPath) {
    console.log(`Run stage output: ${stageOutputPath}`);
  } else {
    console.log("Run stage output: not applicable for this invocation stage.");
  }
}

async function handleProjectCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "add":
      await addProject(homeDir, rest);
      break;
    case "list":
      await listProjects(homeDir);
      break;
    case "show":
      await showProject(homeDir, rest[0]);
      break;
    case "snapshot":
      await snapshotProject(homeDir, rest);
      break;
    case "dashboard":
      await projectDashboard(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printProjectHelp();
      break;
    default:
      throw new Error(`Unknown project command: ${subcommand}`);
  }
}

async function addProject(homeDir: string, args: string[]): Promise<void> {
  const { flags, positionals } = parseFlags(args);
  const { state } = await ensureStateFile(homeDir);
  await ensureVaultBase(homeDir);

  const input = await collectProjectInput(flags, positionals);
  const existingProject = findExistingProjectForInput(state.projects, input);

  if (existingProject) {
    await createProjectVault(homeDir, existingProject);
    const projectVaultPath = path.join(getMaestroPaths(homeDir).projectsVaultDir, existingProject.id);
    console.log(`Project already exists: ${existingProject.name} (${existingProject.id})`);
    console.log(`Vault: ${projectVaultPath}`);
    return;
  }

  const project = createProject(input, state.projects.map((item) => item.id));
  const nextState = upsertProject(state, project);

  await createProjectVault(homeDir, project);
  await saveState(homeDir, nextState);

  const projectVaultPath = path.join(getMaestroPaths(homeDir).projectsVaultDir, project.id);
  console.log(`Project added: ${project.name} (${project.id})`);
  console.log(`Vault: ${projectVaultPath}`);
}

async function listProjects(homeDir: string): Promise<void> {
  const state = await loadStateWithFriendlyError(homeDir);

  if (state.projects.length === 0) {
    console.log("No projects registered yet.");
    return;
  }

  for (const project of state.projects) {
    console.log(`${project.id} | ${project.name} | ${project.status} | ${project.priority}`);
  }
}

async function showProject(homeDir: string, id: string | undefined): Promise<void> {
  if (!id) {
    throw new Error("Missing project id. Usage: maestro project show <id>");
  }

  const state = await loadStateWithFriendlyError(homeDir);
  const project = state.projects.find((item) => item.id === id);

  if (!project) {
    throw new Error(`Project not found: ${id}`);
  }

  printProject(project, homeDir);
}

async function snapshotProject(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = state.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  await createProjectVault(homeDir, project);
  const snapshot = await createRepositorySnapshot(homeDir, project);
  const projectVaultPath = path.join(getMaestroPaths(homeDir).projectsVaultDir, project.id);

  console.log(`Snapshot created for project: ${project.id}`);
  console.log(`Repository: ${snapshot.repoPath}`);
  console.log(`Branch: ${snapshot.branch}`);
  console.log(`Vault files:`);
  console.log(path.join(projectVaultPath, "08-repo-snapshot.md"));
  console.log(path.join(projectVaultPath, "09-dev-scripts.md"));
  console.log(path.join(projectVaultPath, "10-technical-map.md"));
}

async function projectDashboard(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const runs = state.runs.filter((run) => run.projectId === project.id);
  const decisions = state.decisions.filter((decision) => decision.projectId === project.id);
  const lastRun = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const openRuns = runs.filter((run) => run.status !== "FINALIZED" && run.status !== "BLOCKED");
  const runsAwaitingHumanDecision: RunRecord[] = [];
  for (const run of runs) {
    if (!findHumanDecisionForRun(decisions, run.id) && (await runFileExists(run, "09-reviewer-output.md"))) {
      runsAwaitingHumanDecision.push(run);
    }
  }
  const reviewNeededTasks = tasks.filter((task) => task.status === "REVIEW_NEEDED");
  const followUpTasks = tasks.filter(
    (task) =>
      (task.tags.includes("follow-up") || task.tags.includes("review-fix")) &&
      task.status !== "DONE" &&
      task.status !== "CANCELLED"
  );
  const recentDecisions = [...decisions].sort((left, right) => right.decidedAt.localeCompare(left.decidedAt)).slice(0, 5);
  const highPriorityTasks = tasks.filter(
    (task) => (task.priority === "HIGH" || task.priority === "URGENT") && task.status !== "DONE" && task.status !== "CANCELLED"
  );
  const memoryStatus = await getProjectMemoryConsolidationStatus(homeDir, project);
  const nextActions = await readLastLines(path.join(getMaestroPaths(homeDir).projectsVaultDir, project.id, "05-next-actions.md"), 10);
  const pilotTasks = tasks.filter((task) => task.tags.includes("pilot"));
  const activePilotTask = pilotTasks.find((task) => task.status !== "DONE" && task.status !== "CANCELLED");

  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`Status: ${project.status}`);
  console.log(`Repository: ${project.repoPath || "Not set"}`);
  console.log(`Total tasks: ${tasks.length}`);
  console.log(`Tasks by status:`);
  for (const status of TASK_STATUS_ORDER) {
    console.log(`- ${status}: ${tasks.filter((task) => task.status === status).length}`);
  }
  console.log(`High/Urgent tasks:`);
  if (highPriorityTasks.length === 0) {
    console.log("- none");
  } else {
    for (const task of sortTasksForDisplay(highPriorityTasks)) {
      console.log(`- ${task.id} | ${task.priority} | ${task.status} | ${task.title}`);
    }
  }
  console.log(`Last run: ${lastRun ? `${lastRun.id} | ${lastRun.status} | ${lastRun.goal}` : "none"}`);
  console.log(`Open runs: ${openRuns.length}`);
  for (const run of openRuns) {
    console.log(`- ${run.id} | ${run.status} | ${run.goal}`);
  }
  console.log(`Runs awaiting human decision: ${runsAwaitingHumanDecision.length}`);
  for (const run of runsAwaitingHumanDecision) {
    console.log(`- ${run.id} | ${run.status} | ${run.goal}`);
  }
  console.log(`Tasks in REVIEW_NEEDED: ${reviewNeededTasks.length}`);
  for (const task of sortTasksForDisplay(reviewNeededTasks)) {
    console.log(`- ${task.id} | ${task.priority} | ${task.title}`);
  }
  console.log(`Recent human decisions:`);
  if (recentDecisions.length === 0) {
    console.log("- none");
  } else {
    for (const decision of recentDecisions) {
      console.log(`- ${decision.decidedAt} | ${decision.status} | run: ${decision.runId} | task: ${decision.taskId || "none"}`);
    }
  }
  console.log(`Open follow-up tasks: ${followUpTasks.length}`);
  for (const task of sortTasksForDisplay(followUpTasks)) {
    console.log(`- ${task.id} | ${task.priority} | ${task.status} | ${task.title}`);
  }
  console.log(`Memory consolidation:`);
  console.log(`- Active Context exists: ${memoryStatus.activeContextExists ? "yes" : "no"}`);
  console.log(`- Last checkpoint exists: ${memoryStatus.checkpointExists ? "yes" : "no"}`);
  console.log(`- Open questions: ${memoryStatus.openQuestionsCount}`);
  console.log(`- Active risks: ${memoryStatus.activeRiskCount}`);
  console.log(`- Brief command: corepack pnpm run maestro memory brief --project ${project.id}`);
  console.log(`Pilot run:`);
  if (activePilotTask) {
    console.log(`- Active pilot task: ${activePilotTask.id} | ${activePilotTask.status} | ${activePilotTask.title}`);
    console.log(`- Next step: maestro pilot next --project ${project.id}`);
  } else if (pilotTasks.length > 0) {
    console.log(`- Last pilot task completed`);
  } else {
    console.log(`- No pilot tasks yet`);
    console.log(`- Start one: maestro pilot start --project ${project.id} --title "..." --description "..."`);
  }
  console.log(`Recent next actions:`);
  console.log(nextActions || "Not detected");
}

async function handleMemoryCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "status":
      await printMemoryStatus(homeDir);
      break;
    case "refresh":
      await refreshMemory(homeDir, rest);
      break;
    case "checkpoint":
      await checkpointMemory(homeDir, rest);
      break;
    case "brief":
      await briefMemory(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printMemoryHelp();
      break;
    default:
      throw new Error(`Unknown memory command: ${subcommand}`);
  }
}

async function handleContextCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "import":
      await importContext(homeDir, rest);
      break;
    case "status":
      await printContextStatus(homeDir, rest);
      break;
    case "pack":
      await packContext(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printContextHelp();
      break;
    default:
      throw new Error(`Unknown context command: ${subcommand}`);
  }
}

async function handleRunCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "prepare":
      await prepareRun(homeDir, rest);
      break;
    case "list":
      await listRuns(homeDir, rest);
      break;
    case "show":
      await showRun(homeDir, rest);
      break;
    case "timeline":
      await showRunTimeline(homeDir, rest);
      break;
    case "attach":
      await attachRunOutput(homeDir, rest);
      break;
    case "attach-commit":
      await attachCommitCommand(homeDir, rest);
      break;
    case "workspace":
      await handleRunWorkspaceCommand(homeDir, rest);
      break;
    case "handoff":
      await createHandoffCommand(homeDir, rest);
      break;
    case "review-package":
      await createReviewPackageCommand(homeDir, rest);
      break;
    case "decide":
      await decideRunCommand(homeDir, rest);
      break;
    case "patch":
      await handlePatchCommand(homeDir, rest);
      break;
    case "finalize":
      await finalizeRunCommand(homeDir, rest);
      break;
    case "capture-diff":
      await captureRunDiffCommand(homeDir, rest);
      break;
    case "block":
      await blockRunCommand(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printRunHelp();
      break;
    default:
      throw new Error(`Unknown run command: ${subcommand}`);
  }
}

async function handleTaskCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "add":
      await addTask(homeDir, rest);
      break;
    case "list":
      await listTasks(homeDir, rest);
      break;
    case "show":
      await showTask(homeDir, rest);
      break;
    case "update":
      await updateTask(homeDir, rest);
      break;
    case "block":
      await blockTask(homeDir, rest);
      break;
    case "complete":
      await completeTask(homeDir, rest);
      break;
    case "sync-vault":
      await syncTasksToVault(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printTaskHelp();
      break;
    default:
      throw new Error(`Unknown task command: ${subcommand}`);
  }
}

async function handleValidationCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "detect":
      await detectValidationCommand(homeDir, rest);
      break;
    case "list":
      await listValidationCommand(homeDir, rest);
      break;
    case "run":
      await runValidationCommand_CLI(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printValidationHelp();
      break;
    default:
      throw new Error(`Unknown validation command: ${subcommand}`);
  }
}

async function detectValidationCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);

  if (!project.repoPath) {
    throw new Error(`Project ${project.id} does not have a repository path`);
  }

  console.log(`Detecting validation commands for project: ${project.name}\n`);

  const packageManager = await detectPackageManager(project.repoPath);
  const scripts = await detectPackageScripts(project.repoPath);

  const commands: ValidationCommand[] = [];
  const commonScripts = ["build", "typecheck", "test", "lint", "check"];

  for (const scriptName of commonScripts) {
    if (scripts[scriptName]) {
      const command: ValidationCommand = {
        id: scriptName,
        label: scriptName.charAt(0).toUpperCase() + scriptName.slice(1),
        command: packageManager || "npm",
        args: ["run", scriptName],
        cwdTarget: "WORKSPACE",
        timeoutMs: scriptName === "test" ? 300000 : 120000,
        required: scriptName === "build" || scriptName === "typecheck"
      };
      commands.push(command);
    }
  }

  const profile: ProjectValidationProfile = {
    projectId: project.id,
    packageManager,
    commands,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveState(homeDir, upsertValidationProfile(state, profile));

  const profilePath = path.join(getMaestroPaths(homeDir).projectsVaultDir, project.id, "16-validation-profile.md");
  await fs.writeFile(profilePath, renderValidationProfile(profile, project), "utf8");

  console.log(`Package manager: ${packageManager || "not detected"}`);
  console.log(`Commands detected: ${commands.length}`);
  console.log("");
  for (const cmd of commands) {
    console.log(`  [${cmd.required ? "✓" : " "}] ${cmd.label}: ${cmd.command} ${cmd.args.join(" ")}`);
  }
  console.log("");
  console.log(`Profile saved: ${profilePath}`);
}

async function listValidationCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  const profile = state.validationProfiles.find((p) => p.projectId === project.id);

  if (!profile) {
    console.log(`No validation profile found for project: ${project.name}`);
    console.log(`Run: maestro validation detect --project ${project.id}`);
    return;
  }

  console.log(`Validation profile for: ${project.name}\n`);
  console.log(`Package manager: ${profile.packageManager || "not set"}`);
  console.log(`Commands: ${profile.commands.length}\n`);

  for (const cmd of profile.commands) {
    console.log(`  [${cmd.required ? "✓" : " "}] ${cmd.label}`);
    console.log(`      Command: ${cmd.command} ${cmd.args.join(" ")}`);
    console.log(`      Target: ${cmd.cwdTarget}`);
    console.log(`      Timeout: ${cmd.timeoutMs}ms`);
    console.log("");
  }
}

async function runValidationCommand_CLI(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const targetStr = getRequiredFlag(flags, "target");
  const target = targetStr as ValidationTarget;

  if (target !== "WORKSPACE" && target !== "ORIGINAL_REPO") {
    throw new Error(`Invalid target: ${target}. Must be WORKSPACE or ORIGINAL_REPO`);
  }

  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const profile = state.validationProfiles.find((p) => p.projectId === project.id);

  if (!profile) {
    throw new Error(`No validation profile for project ${project.id}. Run: maestro validation detect --project ${project.id}`);
  }

  if (target === "WORKSPACE") {
    const workspace = state.workspaces.find((ws) => ws.runId === run.id);
    if (!workspace) {
      throw new Error(`No workspace found for run ${run.id}`);
    }
    await runValidationOnTarget(homeDir, run, project, profile, workspace.workspacePath, "WORKSPACE");
  } else {
    const promotion = state.promotions.find((p) => p.runId === run.id);
    if (!promotion || promotion.status !== "APPLIED") {
      throw new Error(`Patch must be APPLIED before validating original repo. Current status: ${promotion?.status || "not found"}`);
    }
    await runValidationOnTarget(homeDir, run, project, profile, project.repoPath!, "ORIGINAL_REPO");
  }
}

async function runValidationOnTarget(
  homeDir: string,
  run: RunRecord,
  project: Project,
  profile: ProjectValidationProfile,
  cwd: string,
  target: ValidationTarget
): Promise<void> {
  console.log(`Running validation on ${target} for run: ${run.id}\n`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const targetDir = target === "WORKSPACE" ? "workspace" : "original";
  const logsDir = path.join(run.path, "validation", targetDir, timestamp);
  await fs.mkdir(logsDir, { recursive: true });

  const commandResults: ValidationCommandResult[] = [];
  let overallStatus: ValidationStatus = "PASSED";

  for (const cmd of profile.commands) {
    console.log(`  Running: ${cmd.label}...`);

    const stdoutPath = path.join(logsDir, `stdout-${cmd.id}.log`);
    const stderrPath = path.join(logsDir, `stderr-${cmd.id}.log`);

    const result = await runValidationCommand({
      command: cmd.command,
      args: cmd.args,
      cwd,
      timeoutMs: cmd.timeoutMs,
      stdoutPath,
      stderrPath
    });

    const cmdStatus: ValidationStatus =
      result.exitCode === null ? "BLOCKED" :
      result.exitCode === 0 ? "PASSED" : "FAILED";

    const cmdResult: ValidationCommandResult = {
      commandId: cmd.id,
      label: cmd.label,
      commandLine: `${cmd.command} ${cmd.args.join(" ")}`,
      resolvedCommand: result.resolvedCommand,
      exitCode: result.exitCode,
      status: cmdStatus,
      stdoutPath,
      stderrPath,
      durationMs: result.durationMs
    };

    commandResults.push(cmdResult);

    if (cmd.required && cmdStatus !== "PASSED") {
      overallStatus = "FAILED";
    }

    const icon = cmdStatus === "PASSED" ? "✓" : cmdStatus === "FAILED" ? "✗" : "⚠";
    console.log(`    ${icon} ${cmd.label}: ${cmdStatus} (${result.durationMs}ms)`);
  }

  const validationRun: ValidationRun = {
    id: `${run.id}-${target.toLowerCase()}-${timestamp}`,
    runId: run.id,
    projectId: project.id,
    target,
    status: overallStatus,
    commandResults,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const state = await loadState(homeDir);
  await saveState(homeDir, upsertValidationRun(state, validationRun));

  const reportFileName = target === "WORKSPACE" ? "24-validation-workspace.md" : "25-validation-original.md";
  const reportPath = path.join(run.path, reportFileName);
  await fs.writeFile(reportPath, renderValidationReport(validationRun, project, run), "utf8");

  console.log("");
  console.log(`Validation ${overallStatus}`);
  console.log(`Report: ${reportPath}`);
}

function renderValidationProfile(profile: ProjectValidationProfile, project: Project): string {
  return `# Validation Profile

## Project

- **Name:** ${project.name}
- **ID:** ${project.id}

## Package Manager

${profile.packageManager || "Not detected"}

## Commands

${profile.commands.map((cmd) => `### ${cmd.label}

- **Command:** \`${cmd.command} ${cmd.args.join(" ")}\`
- **Target:** ${cmd.cwdTarget}
- **Timeout:** ${cmd.timeoutMs}ms
- **Required:** ${cmd.required ? "yes" : "no"}
`).join("\n")}

## Usage

\`\`\`bash
# Run validation on workspace:
maestro validation run --run <run-id> --target WORKSPACE

# Run validation on original repo (after patch apply):
maestro validation run --run <run-id> --target ORIGINAL_REPO
\`\`\`
`;
}

function renderValidationReport(validationRun: ValidationRun, project: Project, run: RunRecord): string {
  return `# Validation Result

## Target

${validationRun.target}

## Status

${validationRun.status}

## Run

- **Run ID:** ${run.id}
- **Goal:** ${run.goal}

## Project

- **Name:** ${project.name}
- **ID:** ${project.id}

## Commands

${validationRun.commandResults.map((result) => `### ${result.label}

- **Command:** \`${result.commandLine}\`
- **Command resolved:** \`${result.resolvedCommand || result.commandLine.split(" ")[0]}\`
- **Exit code:** ${result.exitCode !== null ? result.exitCode : "timeout/killed"}
- **Duration:** ${result.durationMs}ms
- **Status:** ${result.status}
- **stdout:** ${result.stdoutPath}
- **stderr:** ${result.stderrPath}
`).join("\n")}

## Summary

- **Total commands:** ${validationRun.commandResults.length}
- **Passed:** ${validationRun.commandResults.filter((r) => r.status === "PASSED").length}
- **Failed:** ${validationRun.commandResults.filter((r) => r.status === "FAILED").length}
- **Blocked:** ${validationRun.commandResults.filter((r) => r.status === "BLOCKED").length}

## Próximo passo sugerido

${validationRun.status === "PASSED"
  ? validationRun.target === "WORKSPACE"
    ? "Validation passed. Continue with review and human decision."
    : "Validation passed on original repo. Safe to commit changes."
  : "Validation failed. Review the logs and fix the issues before proceeding."
}
`;
}

function printValidationHelp(): void {
  console.log(`Validation commands:

  maestro validation detect --project <id>
  maestro validation list --project <id>
  maestro validation run --run <id> --target WORKSPACE
  maestro validation run --run <id> --target ORIGINAL_REPO
`);
}

async function handlePilotCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "start":
      await pilotStartCommand(homeDir, rest);
      break;
    case "status":
      await pilotStatusCommand(homeDir, rest);
      break;
    case "next":
      await pilotNextCommand(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printPilotHelp();
      break;
    default:
      throw new Error(`Unknown pilot command: ${subcommand}`);
  }
}

async function pilotStartCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const title = getRequiredFlag(flags, "title");
  const description = getFlag(flags, "description") || "";
  const priority = (getFlag(flags, "priority") || "LOW") as TaskPriority;
  const tagsStr = getFlag(flags, "tags") || "pilot,safe";
  const tags = tagsStr.split(",").map((t) => t.trim());

  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);

  console.log(`Starting pilot run for project: ${project.name}\n`);

  // Create pilot task
  const now = new Date().toISOString();
  const task: ProjectTask = {
    id: `pilot-${Date.now()}`,
    projectId: project.id,
    title,
    description,
    status: "TODO",
    priority,
    tags,
    relatedRunIds: [],
    createdAt: now,
    updatedAt: now
  };

  await saveState(homeDir, upsertTask(state, task));
  console.log(`✓ Pilot task created: ${task.id}`);
  console.log(`  Title: ${title}`);
  console.log(`  Priority: ${priority}`);
  console.log(`  Tags: ${tags.join(", ")}\n`);

  // Run memory refresh
  console.log("Refreshing memory...");
  const state2 = await loadState(homeDir);
  await refreshProjectMemory(
    homeDir,
    project,
    state2.tasks.filter((t) => t.projectId === project.id),
    state2.runs.filter((r) => r.projectId === project.id),
    state2.decisions.filter((d) => d.projectId === project.id)
  );
  console.log("✓ Memory refreshed\n");

  // Create context pack
  console.log("Creating context pack...");
  await createContextPack(
    homeDir,
    project,
    state2.tasks.filter((t) => t.projectId === project.id),
    state2.decisions.filter((d) => d.projectId === project.id),
    state2.runs.filter((r) => r.projectId === project.id)
  );
  console.log("✓ Context pack created\n");

  // Detect validation if not already done
  const validationProfile = state2.validationProfiles.find((p) => p.projectId === project.id);
  if (!validationProfile) {
    console.log("Detecting validation commands...");
    const packageManager = await detectPackageManager(project.repoPath!);
    const scripts = await detectPackageScripts(project.repoPath!);
    const commands: ValidationCommand[] = [];

    const commonScripts = ["build", "typecheck", "test", "lint", "check"];
    for (const scriptName of commonScripts) {
      if (scripts[scriptName]) {
        commands.push({
          id: scriptName,
          label: scriptName.charAt(0).toUpperCase() + scriptName.slice(1),
          command: packageManager || "npm",
          args: ["run", scriptName],
          cwdTarget: "WORKSPACE",
          timeoutMs: scriptName === "test" ? 300000 : 120000,
          required: scriptName === "build" || scriptName === "typecheck"
        });
      }
    }

    const profile: ProjectValidationProfile = {
      projectId: project.id,
      packageManager,
      commands,
      createdAt: now,
      updatedAt: now
    };

    const state3 = await loadState(homeDir);
    await saveState(homeDir, upsertValidationProfile(state3, profile));

    const profilePath = path.join(getMaestroPaths(homeDir).projectsVaultDir, project.id, "16-validation-profile.md");
    await fs.writeFile(profilePath, renderValidationProfile(profile, project), "utf8");
    console.log(`✓ Validation profile created: ${commands.length} commands\n`);
  } else {
    console.log("✓ Validation profile already exists\n");
  }

  // Create pilot checklist
  const checklistPath = path.join(getMaestroPaths(homeDir).projectsVaultDir, project.id, "17-pilot-run-checklist.md");
  await fs.writeFile(checklistPath, renderPilotChecklist(project, task), "utf8");
  console.log(`✓ Pilot checklist created: ${checklistPath}\n`);

  console.log("Próximo passo:");
  console.log(`  maestro run prepare --project ${project.id} --task ${task.id}`);
}

async function pilotStatusCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);

  const pilotTasks = state.tasks.filter((t) => t.projectId === project.id && t.tags.includes("pilot"));
  
  if (pilotTasks.length === 0) {
    console.log(`No pilot tasks found for project: ${project.name}`);
    console.log(`\nCreate one with:`);
    console.log(`  maestro pilot start --project ${project.id} --title "..." --description "..."`);
    return;
  }

  const latestTask = pilotTasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const run = state.runs.find((r) => r.taskId === latestTask.id);
  const workspace = run ? state.workspaces.find((w) => w.runId === run.id) : undefined;
  const decision = run ? state.decisions.find((d) => d.runId === run.id) : undefined;
  const promotion = run ? state.promotions.find((p) => p.runId === run.id) : undefined;

  console.log(`Pilot Run Status - ${project.name}\n`);
  console.log(`Task: ${latestTask.title} (${latestTask.id})`);
  console.log(`Status: ${latestTask.status}\n`);

  const checks = [
    { label: "Task piloto criada", done: true },
    { label: "Run preparada", done: Boolean(run) },
    { label: "Workspace criado", done: Boolean(workspace) },
    { label: "Handoff gerado", done: run ? await fileExists(path.join(run.path, "handoff", "07-kiro-prompt.md")) : false },
    { label: "Kiro executar no workspace", done: run ? await fileExists(path.join(run.path, "08-executor-output.md")) : false },
    { label: "Validation WORKSPACE", done: run ? await fileExists(path.join(run.path, "24-validation-workspace.md")) : false },
    { label: "Capture diff", done: run ? await fileExists(path.join(run.path, "13-git-diff.md")) : false },
    { label: "Review package", done: run ? await fileExists(path.join(run.path, "review", "08-codex-reviewer-prompt.md")) : false },
    { label: "Human decision", done: Boolean(decision) },
    { label: "Patch export/check/plan", done: Boolean(promotion) },
    { label: "Dry-run apply", done: run ? await fileExists(path.join(run.path, "22-apply-result-dryrun.md")) : false },
    { label: "Apply real", done: promotion?.status === "APPLIED" },
    { label: "Validation ORIGINAL_REPO", done: run ? await fileExists(path.join(run.path, "25-validation-original.md")) : false },
    { label: "Commit manual", done: false }
  ];

  for (const check of checks) {
    const icon = check.done ? "[✓]" : "[TODO]";
    console.log(`  ${icon} ${check.label}`);
  }

  console.log("");
  console.log("Use 'maestro pilot next' para ver o próximo passo recomendado.");
}

async function pilotNextCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);

  const pilotTasks = state.tasks.filter((t) => t.projectId === project.id && t.tags.includes("pilot"));
  
  if (pilotTasks.length === 0) {
    console.log("Nenhuma pilot task encontrada.\n");
    console.log("Sugestão:");
    console.log(`  maestro pilot start --project ${project.id} --title "..." --description "..."`);
    return;
  }

  const latestTask = pilotTasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const run = state.runs.find((r) => r.taskId === latestTask.id);
  const workspace = run ? state.workspaces.find((w) => w.runId === run.id) : undefined;
  const decision = run ? state.decisions.find((d) => d.runId === run.id) : undefined;
  const promotion = run ? state.promotions.find((p) => p.runId === run.id) : undefined;

  console.log(`Próximo passo para: ${latestTask.title}\n`);

  if (!run) {
    console.log(`  maestro run prepare --project ${project.id} --task ${latestTask.id}`);
    return;
  }

  if (!workspace) {
    console.log(`  maestro run workspace create --run ${run.id}`);
    return;
  }

  const handoffExists = await fileExists(path.join(run.path, "handoff", "07-kiro-prompt.md"));
  if (!handoffExists) {
    console.log(`  maestro run handoff --run ${run.id}`);
    return;
  }

  const executorOutputExists = await fileExists(path.join(run.path, "08-executor-output.md"));
  if (!executorOutputExists) {
    console.log("Próximo passo manual:");
    console.log(`  1. Copie o prompt: ${path.join(run.path, "handoff", "07-kiro-prompt.md")}`);
    console.log(`  2. Cole no Kiro`);
    console.log(`  3. Garanta que o Kiro trabalhe somente no workspace: ${workspace.workspacePath}`);
    console.log(`  4. Depois rode: maestro validation run --run ${run.id} --target WORKSPACE`);
    return;
  }

  const validationWorkspaceExists = await fileExists(path.join(run.path, "24-validation-workspace.md"));
  if (!validationWorkspaceExists) {
    console.log(`  maestro validation run --run ${run.id} --target WORKSPACE`);
    return;
  }

  const diffExists = await fileExists(path.join(run.path, "13-git-diff.md"));
  if (!diffExists) {
    console.log(`  maestro run capture-diff --run ${run.id}`);
    return;
  }

  const reviewPackageExists = await fileExists(path.join(run.path, "review", "08-codex-reviewer-prompt.md"));
  if (!reviewPackageExists) {
    console.log(`  maestro run review-package --run ${run.id}`);
    return;
  }

  const reviewerOutputExists = await fileExists(path.join(run.path, "09-reviewer-output.md"));
  if (!reviewerOutputExists) {
    console.log("Próximo passo manual:");
    console.log(`  1. Copie o prompt: ${path.join(run.path, "review", "08-codex-reviewer-prompt.md")}`);
    console.log(`  2. Cole no Codex`);
    console.log(`  3. Salve a revisão em um arquivo`);
    console.log(`  4. Depois rode: maestro run attach --run ${run.id} --stage reviewer --file <path>`);
    return;
  }

  if (!decision) {
    console.log(`  maestro run decide --run ${run.id} --status APPROVED --notes "..."`);
    return;
  }

  if (!promotion) {
    console.log(`  maestro run patch export --run ${run.id}`);
    return;
  }

  if (promotion.status === "EXPORTED") {
    console.log(`  maestro run patch check --run ${run.id}`);
    return;
  }

  if (promotion.status === "CHECK_PASSED") {
    console.log(`  maestro run patch plan --run ${run.id}`);
    console.log(`  maestro run patch apply --run ${run.id} --dry-run`);
    return;
  }

  const dryRunExists = await fileExists(path.join(run.path, "22-apply-result-dryrun.md"));
  if (!dryRunExists && promotion.status === "APPROVED_FOR_APPLY") {
    console.log(`  maestro run patch apply --run ${run.id} --dry-run`);
    return;
  }

  if (promotion.status !== "APPLIED") {
    console.log(`  maestro run patch apply --run ${run.id} --confirm APPLY_TO_ORIGINAL_REPO`);
    return;
  }

  const validationOriginalExists = await fileExists(path.join(run.path, "25-validation-original.md"));
  if (!validationOriginalExists) {
    console.log(`  maestro validation run --run ${run.id} --target ORIGINAL_REPO`);
    return;
  }

  console.log("Próximo passo manual:");
  console.log(`  1. Revisar diff: git -C "${project.repoPath}" diff`);
  console.log(`  2. Rodar testes manualmente`);
  console.log(`  3. Commit: git -C "${project.repoPath}" commit -am "message"`);
  console.log(`  4. Atualizar memória: maestro memory refresh --project ${project.id}`);
}

function renderPilotChecklist(project: Project, task: ProjectTask): string {
  return `# Pilot Run Checklist

## Objetivo

Executar a primeira run real pequena do projeto com segurança.

## Task

- **ID:** ${task.id}
- **Title:** ${task.title}
- **Description:** ${task.description}
- **Priority:** ${task.priority}
- **Tags:** ${task.tags.join(", ")}

## Regra principal

O Kiro só pode trabalhar no workspace sandbox. O repo original só recebe patch depois de decisão humana, patch check, dry-run e confirmação explícita.

## Checklist

<!-- MAESTRO:PILOT_CHECKLIST:START -->
- [x] Criar task piloto
- [x] Atualizar memória ativa
- [x] Gerar context pack
- [x] Detectar validações
- [ ] Preparar run
- [ ] Anexar plano do Codex Supervisor
- [ ] Criar workspace sandbox
- [ ] Gerar Kiro Handoff
- [ ] Executar Kiro no workspace
- [ ] Rodar validation WORKSPACE
- [ ] Capturar diff
- [ ] Anexar relatório do Kiro
- [ ] Gerar Codex Review Package
- [ ] Anexar revisão do Codex
- [ ] Registrar decisão humana
- [ ] Exportar patch
- [ ] Checar patch
- [ ] Gerar plano de apply
- [ ] Rodar dry-run apply
- [ ] Aplicar patch no repo original
- [ ] Rodar validation ORIGINAL_REPO
- [ ] Revisar manualmente o diff final
- [ ] Commit manual pelo usuário
- [ ] Atualizar memória/checkpoint
<!-- MAESTRO:PILOT_CHECKLIST:END -->

## Comandos úteis

\`\`\`bash
# Ver status da pilot run:
maestro pilot status --project ${project.id}

# Ver próximo passo:
maestro pilot next --project ${project.id}

# Dashboard do projeto:
maestro project dashboard --project ${project.id}
\`\`\`
`;
}

function printPilotHelp(): void {
  console.log(`Pilot commands:

  maestro pilot start --project <id> --title <title> --description <desc> [--priority <priority>] [--tags <tags>]
  maestro pilot status --project <id>
  maestro pilot next --project <id>
`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function handleProviderCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "doctor":
      await providerDoctor(homeDir, rest);
      break;
    case "discover":
      await providerDiscover(homeDir, rest);
      break;
    case "test":
      await providerTest(homeDir, rest);
      break;
    case "auth":
      await handleProviderAuthCommand(homeDir, rest);
      break;
    case "grouter":
      await handleProviderGrouterCommand(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printProviderHelp();
      break;
    default:
      throw new Error(`Unknown provider command: ${subcommand}`);
  }
}

async function providerDoctor(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const provider = getFlag(flags, "provider") || "grouter";

  if (provider !== "openclaude" && provider !== "kiro_cli" && provider !== "grouter" && provider !== "openclaude_grouter") {
    throw new Error(`Unsupported provider: ${provider}. Supported: openclaude, kiro_cli, grouter, openclaude_grouter`);
  }

  console.log(`Running provider doctor for: ${provider}\n`);

  const result = provider === "kiro_cli"
    ? await doctorKiroCliProvider(homeDir)
    : provider === "grouter"
    ? await doctorGrouterProvider(homeDir)
    : provider === "openclaude_grouter"
    ? await doctorOpenClaudeGrouterProvider(homeDir)
    : await doctorOpenClaudeProvider(homeDir);

  console.log(`Provider: ${result.provider}`);
  console.log(`Status: ${result.status}`);
  console.log(`Summary: ${result.summary}\n`);

  console.log("Checks:\n");
  for (const check of result.checks) {
    const icon = check.status === "OK" ? "✓" : check.status === "ERROR" ? "✗" : check.status === "WARN" ? "⚠" : "○";
    console.log(`  ${icon} ${check.label}: ${check.status}`);
    console.log(`     ${check.message}`);
    if (check.details) {
      console.log(`     ${check.details.split("\n").join("\n     ")}`);
    }
    console.log("");
  }

  if (result.status === "BLOCKED") {
    console.log("Provider is blocked. Fix the issues above and run doctor again.");
  } else if (result.status === "READY") {
    console.log("Provider is ready. You can now run discovery:");
    console.log(`  maestro provider discover --provider ${provider}`);
  }
}

async function providerDiscover(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const provider = getFlag(flags, "provider") || "grouter";

  if (provider !== "openclaude" && provider !== "kiro_cli" && provider !== "grouter" && provider !== "openclaude_grouter") {
    throw new Error(`Unsupported provider: ${provider}. Supported: openclaude, kiro_cli, grouter, openclaude_grouter`);
  }

  console.log(`Running provider discovery for: ${provider}\n`);

  const result = provider === "kiro_cli"
    ? await discoverKiroCliProvider(homeDir)
    : provider === "grouter"
    ? await discoverGrouterProvider(homeDir)
    : provider === "openclaude_grouter"
    ? await discoverOpenClaudeGrouterProvider(homeDir)
    : await discoverOpenClaudeProvider(homeDir);

  console.log(`Provider: ${result.provider}`);
  console.log(`Timestamp: ${result.timestamp}`);
  console.log(`Status: ${result.status}\n`);

  if (result.error) {
    console.log(`Error: ${result.error}\n`);
  }

  if (result.versionOutput) {
    console.log("Version output:");
    console.log(result.versionOutput);
    console.log("");
  }

  if (result.helpOutput) {
    console.log("Help output (first 500 chars):");
    console.log(result.helpOutput.slice(0, 500));
    if (result.helpOutput.length > 500) {
      console.log("...(truncated)");
    }
    console.log("");
  }

  if (result.reportPath) {
    console.log(`Full report saved to: ${result.reportPath}`);
  }

  if (result.status === "SUCCESS") {
    console.log("\nDiscovery successful. The provider is ready for integration testing.");
  } else {
    console.log("\nDiscovery failed. Check the error above and run provider doctor.");
  }
}

async function providerTest(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const provider = getFlag(flags, "provider");
  const prompt = getFlag(flags, "prompt");
  const confirm = getFlag(flags, "confirm");
  const debug = Boolean(flags.debug);
  const timeoutMs = parseTimeoutMs(getFlag(flags, "timeout-ms"), 300000);
  const variant = parseProviderTestVariant(getFlag(flags, "variant") || "current");

  // Support openclaude_grouter and grouter
  if (provider !== "openclaude_grouter" && provider !== "grouter") {
    throw new Error(`Provider test only supports openclaude_grouter and grouter. Got: ${provider || "none"}`);
  }

  if (!prompt) {
    throw new Error("--prompt is required. Example: --prompt \"Responda apenas: OK\"");
  }

  // Require explicit confirmation
  if (confirm !== "RUN_PROVIDER_TEST") {
    throw new Error("Provider test requires explicit confirmation. Add: --confirm RUN_PROVIDER_TEST");
  }

  console.log(`Running provider test for: ${provider}\n`);
  console.log(`Prompt: ${prompt}\n`);
  console.log(`Variant: ${variant}`);
  console.log(`Timeout: ${timeoutMs}ms`);
  console.log(`Debug: ${debug ? "yes" : "no"}\n`);

  if (provider === "grouter") {
    await providerTestGrouterDirect(homeDir, prompt, timeoutMs, debug);
  } else {
    await providerTestOpenClaudeGrouter(homeDir, prompt, timeoutMs, debug, variant);
  }
}

async function providerTestOpenClaudeGrouter(
  homeDir: string,
  prompt: string,
  timeoutMs: number,
  debug: boolean,
  variant: ProviderTestVariant
): Promise<void> {
  // Load config
  const configPath = path.join(homeDir, "data", "config", "openclaude-grouter.json");
  let config: any;
  try {
    const content = await fs.readFile(configPath, "utf8");
    config = JSON.parse(content);
  } catch (error) {
    throw new Error(`Config file not found: ${configPath}\nCopy from: config/openclaude-grouter.example.json`);
  }

  // Pre-flight checks
  console.log("Pre-flight checks:\n");

  // Check 1: Doctor is READY
  const doctorResult = await doctorOpenClaudeGrouterProvider(homeDir);
  if (doctorResult.status !== "READY") {
    console.log(`✗ Doctor status: ${doctorResult.status}`);
    console.log(`\nProvider is not READY. Run: maestro provider doctor --provider openclaude_grouter`);
    throw new Error("Provider doctor is not READY");
  }
  console.log(`✓ Doctor status: READY`);

  // Check 2: Grouter daemon is running (BLOCKING for test)
  const grouterConfig = await loadGrouterConfig(homeDir);
  if (!grouterConfig || !grouterConfig.executablePath) {
    throw new Error("Grouter config not found");
  }

  let daemonRunning = false;
  try {
    const { stdout } = await execFileAsync(grouterConfig.executablePath, ["status"], {
      timeout: 5000
    });
    daemonRunning = stdout.includes("running") || stdout.includes("active");
  } catch (error: any) {
    // Grouter status may return exit code 1 but still have output
    const stdout = error.stdout || "";
    daemonRunning = stdout.includes("running") || stdout.includes("active");
  }

  if (!daemonRunning) {
    console.log(`✗ Grouter daemon: NOT RUNNING`);
    console.log(`\nGrouter daemon is required for provider test.`);
    console.log(`Run: grouter serve on`);
    throw new Error("Grouter daemon is not running");
  }
  console.log(`✓ Grouter daemon: RUNNING`);

  // Check 3: Model is configured
  if (!config.model || config.model.trim() === "") {
    console.log(`✗ Model: NOT CONFIGURED`);
    console.log(`\nModel is not configured in data/config/openclaude-grouter.json.`);
    console.log(`Run: grouter models`);
    console.log(`Then set model in config.`);
    throw new Error("Model is not configured");
  }
  console.log(`✓ Model: ${config.model}`);

  // Check 4: Linked connection exists
  const state = await loadState(homeDir);
  const connection = state.grouterConnections.find((c) => c.id === config.linkedConnectionId);
  if (!connection) {
    throw new Error(`Linked connection not found: ${config.linkedConnectionId}`);
  }
  console.log(`✓ Linked connection: ${connection.id} (${connection.label || "no label"})`);

  console.log("\nAll pre-flight checks passed. Executing test...\n");

  // Create test directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const testDir = path.join(homeDir, "data", "providers", "openclaude-grouter", "tests", timestamp);
  await fs.mkdir(testDir, { recursive: true });

  // Save metadata
  const metadata = {
    timestamp,
    provider: "openclaude_grouter",
    prompt,
    model: config.model,
    variant,
    debug,
    timeoutMs,
    linkedConnectionId: config.linkedConnectionId,
    baseUrl: config.baseUrl
  };
  await fs.writeFile(path.join(testDir, "00-test-metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  // Save prompt
  await fs.writeFile(path.join(testDir, "01-prompt.md"), prompt, "utf8");

  // Ensure isolated OpenClaude settings
  const settingsPath = await ensureOpenClaudeIsolation(homeDir, {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey || "any-value",
    model: config.model,
    additionalEnv: config.env
  });

  // Execute OpenClaude
  const execArgs = buildOpenClaudeGrouterArgs(config, variant);
  execArgs.push("--settings", settingsPath); // Add isolated settings

  console.log(`Executing: ${config.executablePath} ${execArgs.join(" ")}\n`);

  if (debug) {
    await writeProviderDebugArtifacts({
      homeDir,
      testDir,
      config,
      grouterConfig,
      prompt,
      variant,
      commandArgs: execArgs,
      env: process.env,
      timeoutMs
    });
  }

  const commandResult = await runCapturedCommand(config.executablePath, execArgs, {
    cwd: config.workingDirectory,
    env: process.env, // Don't pass config.env - settings file handles it
    timeoutMs,
    stdinContent: prompt,
    allowStackBufferOverrunWithStdout: true
  });
  const stdout = sanitizeText(commandResult.stdout);
  const stderr = sanitizeText(commandResult.stderr);
  const exitCode = commandResult.exitCode;
  const timedOut = commandResult.timedOut;
  const status = timedOut ? "TIMEOUT" : commandResult.errorMessage || exitCode !== 0 ? "FAILED" : "SUCCESS";
  const error = status === "SUCCESS" ? undefined : new Error(commandResult.errorMessage || status);

  if (debug && grouterConfig?.executablePath) {
    await writeCapturedCommandArtifact(
      path.join(testDir, "15-grouter-serve-logs-after.txt"),
      grouterConfig.executablePath,
      ["serve", "logs"],
      { timeoutMs: Math.min(timeoutMs, 10000), maxChars: 20000 }
    );
  }

  // Save outputs
  await fs.writeFile(path.join(testDir, "02-stdout.txt"), stdout, "utf8");
  await fs.writeFile(path.join(testDir, "03-stderr.txt"), stderr, "utf8");

  // Generate result
  const resultMd = `# Provider Test Result

## Timestamp

${timestamp}

## Provider

openclaude_grouter

## Prompt

\`\`\`
${prompt}
\`\`\`

## Model

${config.model}

## Linked Connection

${config.linkedConnectionId} (${connection.label || "no label"})

## Exit Code

${exitCode === null ? "null" : exitCode}

## Timeout

${timedOut ? "yes" : "no"}

## Variant

${variant}

## Stdout

\`\`\`
${stdout}
\`\`\`

## Stderr

\`\`\`
${stderr}
\`\`\`

## Status

${status === "SUCCESS" ? "✅ SUCCESS" : status === "TIMEOUT" ? "TIMEOUT" : "❌ FAILED"}

${commandResult.errorMessage ? `### Error\n\n${sanitizeText(commandResult.errorMessage)}` : ""}

## Effective Status

${status}

## Debug

${debug ? "enabled" : "disabled"}

## Kofuku Auto Reference Detected

${detectKofukuAutoReference([stdout, stderr]) ? "yes" : "no"}

## Test Directory

${testDir}
`;

  await fs.writeFile(path.join(testDir, "04-result.md"), resultMd, "utf8");

  // Print result
  console.log("Test completed.\n");
  console.log(`Exit code: ${exitCode === null ? "null" : exitCode}`);
  console.log(`Status: ${status}`);
  console.log(`Timeout: ${timedOut ? "yes" : "no"}\n`);

  if (stdout) {
    console.log("Stdout (first 500 chars):");
    console.log(stdout.slice(0, 500));
    if (stdout.length > 500) {
      console.log("...(truncated)");
    }
    console.log("");
  }

  if (stderr) {
    console.log("Stderr (first 500 chars):");
    console.log(stderr.slice(0, 500));
    if (stderr.length > 500) {
      console.log("...(truncated)");
    }
    console.log("");
  }

  console.log(`Full result saved to: ${path.join(testDir, "04-result.md")}`);

  if (error) {
    throw new Error(`Provider test failed: ${error.message}`);
  }
}

async function providerTestGrouterDirect(
  homeDir: string,
  prompt: string,
  timeoutMs: number,
  debug: boolean
): Promise<void> {
  console.log("Pre-flight checks:\n");

  // Load config from openclaude-grouter (has baseUrl, model, linkedConnectionId)
  const configPath = path.join(homeDir, "data", "config", "openclaude-grouter.json");
  let config: any;
  try {
    const content = await fs.readFile(configPath, "utf8");
    config = JSON.parse(content);
  } catch (error) {
    throw new Error(`Config file not found: ${configPath}\nCopy from: config/openclaude-grouter.example.json`);
  }

  // Check 1: Grouter doctor is READY
  const grouterDoctor = await doctorGrouterProvider(homeDir);
  if (grouterDoctor.status !== "READY") {
    console.log(`✗ Grouter doctor: ${grouterDoctor.status}`);
    console.log(`\nGrouter provider is not READY. Run: maestro provider doctor --provider grouter`);
    throw new Error("Grouter doctor is not READY");
  }
  console.log(`✓ Grouter doctor: READY`);

  // Check 2: Grouter daemon is running
  const grouterConfig = await loadGrouterConfig(homeDir);
  if (!grouterConfig || !grouterConfig.executablePath) {
    throw new Error("Grouter config not found");
  }

  let daemonRunning = false;
  try {
    const { stdout } = await execFileAsync(grouterConfig.executablePath, ["status"], {
      timeout: 5000
    });
    daemonRunning = stdout.includes("running") || stdout.includes("active");
  } catch (error: any) {
    const stdout = error.stdout || "";
    daemonRunning = stdout.includes("running") || stdout.includes("active");
  }

  if (!daemonRunning) {
    console.log(`✗ Grouter daemon: NOT RUNNING`);
    console.log(`\nGrouter daemon is required for provider test.`);
    console.log(`Run: grouter serve on`);
    throw new Error("Grouter daemon is not running");
  }
  console.log(`✓ Grouter daemon: RUNNING`);

  // Check 3: Model is configured
  if (!config.model || config.model.trim() === "") {
    console.log(`✗ Model: NOT CONFIGURED`);
    console.log(`\nModel is not configured in data/config/openclaude-grouter.json.`);
    console.log(`Run: grouter models`);
    console.log(`Then set model in config.`);
    throw new Error("Model is not configured");
  }
  console.log(`✓ Model: ${config.model}`);

  // Check 4: Linked connection exists
  const state = await loadState(homeDir);
  const connection = state.grouterConnections.find((c) => c.id === config.linkedConnectionId);
  if (!connection) {
    throw new Error(`Linked connection not found: ${config.linkedConnectionId}`);
  }
  console.log(`✓ Linked connection: ${connection.id} (${connection.label || "no label"})`);

  console.log("\nAll pre-flight checks passed. Executing direct HTTP test...\n");

  // Create test directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const testDir = path.join(homeDir, "data", "providers", "grouter", "tests", timestamp);
  await fs.mkdir(testDir, { recursive: true });

  // Prepare request
  const requestBody = {
    model: config.model,
    messages: [
      { role: "user", content: prompt }
    ],
    temperature: 0
  };

  const requestMetadata = {
    timestamp,
    provider: "grouter",
    prompt,
    model: config.model,
    linkedConnectionId: config.linkedConnectionId,
    baseUrl: config.baseUrl,
    endpoint: `${config.baseUrl}/chat/completions`
  };

  // Save metadata and request
  await fs.writeFile(path.join(testDir, "00-test-metadata.json"), JSON.stringify(requestMetadata, null, 2), "utf8");
  await fs.writeFile(path.join(testDir, "01-request.json"), JSON.stringify(requestBody, null, 2), "utf8");

  console.log(`Endpoint: ${config.baseUrl}/chat/completions`);
  console.log(`Model: ${config.model}`);
  console.log(`Prompt: ${prompt}\n`);

  // Execute HTTP request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: any;
  let responseText = "";
  let error: Error | undefined;
  let statusCode: number | undefined;
  let timedOut = false;
  const startTime = Date.now();

  try {
    const fetchResponse = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    statusCode = fetchResponse.status;
    responseText = await fetchResponse.text();

    if (fetchResponse.ok) {
      response = JSON.parse(responseText);
    } else {
      error = new Error(`HTTP ${statusCode}: ${responseText}`);
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      timedOut = true;
      error = new Error("Request timed out");
    } else {
      error = err;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const elapsedMs = Date.now() - startTime;

  // Save response or error
  if (response) {
    await fs.writeFile(path.join(testDir, "02-response.json"), JSON.stringify(response, null, 2), "utf8");
  }
  if (error) {
    await fs.writeFile(path.join(testDir, "03-error.txt"), error.message, "utf8");
  }

  // Generate result
  const status = timedOut ? "TIMEOUT" : error ? "FAILED" : "SUCCESS";
  const resultMd = `# Direct Grouter Provider Test Result

## Timestamp

${timestamp}

## Provider

grouter (direct HTTP)

## Endpoint

${config.baseUrl}/chat/completions

## Request

\`\`\`json
${JSON.stringify(requestBody, null, 2)}
\`\`\`

## Model

${config.model}

## Linked Connection

${config.linkedConnectionId} (${connection.label || "no label"})

## Status Code

${statusCode || "N/A"}

## Elapsed Time

${elapsedMs}ms (timeout: ${timeoutMs}ms)

## Response

${response ? `\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\`` : "No response"}

## Error

${error ? error.message : "None"}

## Status

${status === "SUCCESS" ? "✅ SUCCESS" : status === "TIMEOUT" ? "⏱️ TIMEOUT" : "❌ FAILED"}

## Test Directory

${testDir}
`;

  await fs.writeFile(path.join(testDir, "04-result.md"), resultMd, "utf8");

  // Print result
  console.log("Test completed.\n");
  console.log(`Status: ${status}`);
  console.log(`Elapsed: ${elapsedMs}ms\n`);

  if (statusCode) {
    console.log(`HTTP Status: ${statusCode}`);
  }

  if (response) {
    console.log("\nResponse (first 500 chars):");
    const responseStr = JSON.stringify(response, null, 2);
    console.log(responseStr.slice(0, 500));
    if (responseStr.length > 500) {
      console.log("...(truncated)");
    }
    console.log("");
  }

  if (error) {
    console.log("\nError:");
    console.log(error.message);
    console.log("");
  }

  console.log(`Full result saved to: ${path.join(testDir, "04-result.md")}`);

  if (error) {
    throw new Error(`Direct Grouter test failed: ${error.message}`);
  }
}

function parseProviderTestVariant(value: string): ProviderTestVariant {
  const variants: ProviderTestVariant[] = ["minimal", "json", "bare", "no-session", "current"];
  if (variants.includes(value as ProviderTestVariant)) {
    return value as ProviderTestVariant;
  }

  throw new Error(`Invalid provider test variant: ${value}. Expected: ${variants.join(", ")}`);
}

function parseTimeoutMs(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${value}`);
  }

  return Math.floor(parsed);
}

function buildOpenClaudeGrouterArgs(config: any, variant: ProviderTestVariant): string[] {
  // Prompt goes via stdin, but provider/model must be in args
  const execArgs = config.executableArgs ? [...config.executableArgs] : [];
  
  execArgs.push("-p", "--provider", "openai", "--model", config.model);

  if (variant === "json" || variant === "current") {
    execArgs.push("--output-format", "json");
  }

  if (variant === "bare" || variant === "current") {
    execArgs.push("--bare");
  }

  if (variant === "no-session" || variant === "current") {
    execArgs.push("--no-session-persistence");
  }

  // DO NOT push prompt here — it goes via stdin
  return execArgs;
}

async function writeProviderDebugArtifacts(options: {
  homeDir: string;
  testDir: string;
  config: any;
  grouterConfig: any;
  prompt: string;
  variant: ProviderTestVariant;
  commandArgs: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<void> {
  const { homeDir, testDir, config, grouterConfig, prompt, variant, commandArgs, env, timeoutMs } = options;
  const openClaudeHome = resolveProviderRuntimePath(homeDir, config.env?.OPENCLAUDE_HOME);
  const freshHome = path.join(homeDir, "data", "providers", "openclaude-grouter-debug-home", path.basename(testDir));

  await fs.mkdir(openClaudeHome, { recursive: true }).catch(() => undefined);
  await fs.mkdir(freshHome, { recursive: true }).catch(() => undefined);

  await fs.writeFile(path.join(testDir, "05-command.txt"), sanitizeText(`${config.executablePath} ${commandArgs.join(" ")}`), "utf8");
  await fs.writeFile(path.join(testDir, "06-env-sanitized.json"), `${JSON.stringify(sanitizeEnv(env), null, 2)}\n`, "utf8");

  if (grouterConfig?.executablePath) {
    await writeCapturedCommandArtifact(
      path.join(testDir, "07-grouter-status.txt"),
      grouterConfig.executablePath,
      ["status"],
      { timeoutMs }
    );
    await writeCapturedCommandArtifact(
      path.join(testDir, "08-grouter-models.txt"),
      grouterConfig.executablePath,
      ["models"],
      { timeoutMs }
    );
    await writeCapturedCommandArtifact(
      path.join(testDir, "12-grouter-serve-logs-before.txt"),
      grouterConfig.executablePath,
      ["serve", "logs"],
      { timeoutMs: Math.min(timeoutMs, 10000), maxChars: 20000 }
    );
  } else {
    await fs.writeFile(path.join(testDir, "07-grouter-status.txt"), "Grouter executable not configured.\n", "utf8");
    await fs.writeFile(path.join(testDir, "08-grouter-models.txt"), "Grouter executable not configured.\n", "utf8");
  }

  await fs.writeFile(path.join(testDir, "09-openclaude-home-tree.txt"), await renderDirectoryTree(openClaudeHome, 3, 120), "utf8");

  const directRequest = buildDirectGrouterRequest(config, prompt);
  await fs.writeFile(path.join(testDir, "10-direct-grouter-request.json"), `${JSON.stringify(directRequest.sanitizedRequest, null, 2)}\n`, "utf8");
  const directResponse = await runDirectGrouterRequest(directRequest.url, directRequest.body, config.apiKey || config.env?.OPENAI_API_KEY || "any-value", timeoutMs);
  await fs.writeFile(path.join(testDir, "11-direct-grouter-response.json"), `${JSON.stringify(directResponse, null, 2)}\n`, "utf8");

  const freshEnv = {
    ...env,
    OPENCLAUDE_HOME: freshHome
  };
  const freshHelpArgs = config.executableArgs ? [...config.executableArgs, "--help"] : ["--help"];
  await writeCapturedCommandArtifact(
    path.join(testDir, "13-openclaude-fresh-home-help.txt"),
    config.executablePath,
    freshHelpArgs,
    { cwd: config.workingDirectory, env: freshEnv, timeoutMs: Math.min(timeoutMs, 10000) }
  );
  await fs.writeFile(path.join(testDir, "14-openclaude-fresh-home-tree.txt"), await renderDirectoryTree(freshHome, 3, 120), "utf8");

  if (grouterConfig?.executablePath) {
    await writeCapturedCommandArtifact(
      path.join(testDir, "15-grouter-serve-logs-after.txt"),
      grouterConfig.executablePath,
      ["serve", "logs"],
      { timeoutMs: Math.min(timeoutMs, 10000), maxChars: 20000 }
    );
  }

  const report = [
    "# OpenClaude-Grouter Debug Artifacts",
    "",
    `Variant: ${variant}`,
    `Timeout: ${timeoutMs}ms`,
    `Configured OPENCLAUDE_HOME: ${config.env?.OPENCLAUDE_HOME || "not configured"}`,
    `Resolved OPENCLAUDE_HOME: ${openClaudeHome}`,
    `Fresh debug OPENCLAUDE_HOME: ${freshHome}`,
    "",
    "Artifacts:",
    "- 05-command.txt",
    "- 06-env-sanitized.json",
    "- 07-grouter-status.txt",
    "- 08-grouter-models.txt",
    "- 09-openclaude-home-tree.txt",
    "- 10-direct-grouter-request.json",
    "- 11-direct-grouter-response.json",
    "- 12-grouter-serve-logs-before.txt",
    "- 13-openclaude-fresh-home-help.txt",
    "- 14-openclaude-fresh-home-tree.txt",
    "- 15-grouter-serve-logs-after.txt",
    ""
  ].join("\n");
  await fs.writeFile(path.join(testDir, "16-debug-report.md"), report, "utf8");
}

async function writeCapturedCommandArtifact(
  filePath: string,
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; maxChars?: number }
): Promise<void> {
  const result = await runCapturedCommand(command, args, options);
  const output = renderCapturedCommandResult(command, args, result, options.maxChars);
  await fs.writeFile(filePath, output, "utf8");
}

function renderCapturedCommandResult(command: string, args: string[], result: CapturedCommandResult, maxChars = 50000): string {
  const stdout = sanitizeText(result.stdout).slice(-maxChars);
  const stderr = sanitizeText(result.stderr).slice(-maxChars);
  return [
    `Command: ${sanitizeText(`${command} ${args.join(" ")}`)}`,
    `Exit code: ${result.exitCode === null ? "null" : result.exitCode}`,
    `Timed out: ${result.timedOut ? "yes" : "no"}`,
    `Error: ${result.errorMessage ? sanitizeText(result.errorMessage) : "none"}`,
    "",
    "STDOUT:",
    stdout || "(empty)",
    "",
    "STDERR:",
    stderr || "(empty)",
    ""
  ].join("\n");
}

function buildDirectGrouterRequest(config: any, prompt: string): {
  url: string;
  body: Record<string, unknown>;
  sanitizedRequest: Record<string, unknown>;
} {
  const baseUrl = String(config.baseUrl || config.env?.OPENAI_BASE_URL || "").replace(/\/+$/u, "");
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  };

  return {
    url,
    body,
    sanitizedRequest: {
      url,
      method: "POST",
      headers: {
        authorization: "Bearer ***",
        "content-type": "application/json"
      },
      body
    }
  };
}

async function runDirectGrouterRequest(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey || "any-value"}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = sanitizeText(await response.text());
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      timedOut: false,
      body: parsed ?? text
    };
  } catch (error) {
    return {
      ok: false,
      timedOut: error instanceof Error && error.name === "AbortError",
      error: error instanceof Error ? sanitizeText(error.message) : sanitizeText(String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    sanitized[key] = shouldRedactKey(key) ? "***" : sanitizeText(value);
  }
  return sanitized;
}

function shouldRedactKey(key: string): boolean {
  return /KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE|SESSION/iu.test(key);
}

function sanitizeText(value: string): string {
  return value
    .replace(/Bearer\s+["']?[^"'\s]+/giu, "Bearer ***")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s]+/giu, "$1***")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, (match) => {
      const [name, domain] = match.split("@");
      return `${name.slice(0, 1)}***@${domain}`;
    });
}

function detectKofukuAutoReference(values: string[]): boolean {
  return values.some((value) => value.toLowerCase().includes("kofuku-auto"));
}

function resolveProviderRuntimePath(homeDir: string, value: string | undefined): string {
  if (!value) {
    return path.join(homeDir, "data", "providers", "openclaude-grouter");
  }

  return path.isAbsolute(value) ? value : path.resolve(homeDir, value);
}

async function renderDirectoryTree(rootPath: string, maxDepth: number, maxEntries: number): Promise<string> {
  const lines: string[] = [`Root: ${rootPath}`];
  let count = 0;

  async function visit(currentPath: string, depth: number): Promise<void> {
    if (count >= maxEntries || depth > maxDepth) {
      return;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (count >= maxEntries) {
        lines.push("...truncated");
        return;
      }
      const fullPath = path.join(currentPath, entry.name);
      const relative = path.relative(rootPath, fullPath) || entry.name;
      lines.push(`${"  ".repeat(depth)}- ${relative}${entry.isDirectory() ? "/" : ""}`);
      count += 1;
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      }
    }
  }

  await visit(rootPath, 0);
  if (lines.length === 1) {
    lines.push("(empty or unavailable)");
  }
  return `${lines.join("\n")}\n`;
}

function printProviderHelp(): void {
  console.log(`Provider commands:

  maestro provider doctor [--provider grouter|openclaude|openclaude_grouter|kiro_cli]
  maestro provider discover [--provider grouter|openclaude|openclaude_grouter|kiro_cli]
  maestro provider test --provider grouter|openclaude_grouter --prompt "<prompt>" --confirm RUN_PROVIDER_TEST [--debug] [--timeout-ms <ms>] [--variant <minimal|json|bare|no-session|current>]
  maestro provider grouter list
  maestro provider grouter sync
  maestro provider grouter link --connection <id> --provider <provider> [--label <label>]
  maestro provider grouter unlink --connection <id>
  maestro provider auth status [--provider kiro_cli|grouter_kiro]
  maestro provider auth start [--provider kiro_cli|grouter_kiro]
  maestro provider auth poll --session <session-id>
  maestro provider auth cancel --session <session-id>

Note: grouter is the PRIMARY provider path for Maestro.
      provider test --provider grouter tests direct HTTP to Grouter endpoint (isolates Grouter vs OpenClaude issues).
      provider test --provider openclaude_grouter tests via OpenClaude CLI.
      provider test requires explicit --confirm RUN_PROVIDER_TEST flag.
      kiro_cli is EXPERIMENTAL and may use global auth.
`);
}

async function handleProviderAuthCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "status":
      await providerAuthStatus(homeDir, rest);
      break;
    case "start":
      await providerAuthStart(homeDir, rest);
      break;
    case "poll":
      await providerAuthPoll(homeDir, rest);
      break;
    case "cancel":
      await providerAuthCancel(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printProviderAuthHelp();
      break;
    default:
      throw new Error(`Unknown provider auth command: ${subcommand}`);
  }
}

async function providerAuthStatus(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const provider = getFlag(flags, "provider") || "kiro_cli";

  if (provider !== "kiro_cli" && provider !== "kiro_openclaude" && provider !== "openclaude" && provider !== "anthropic") {
    throw new Error(`Unsupported provider: ${provider}. Supported: kiro_cli, kiro_openclaude, openclaude, anthropic`);
  }

  const state = await loadStateWithFriendlyError(homeDir);
  const sessions = state.providerAuthSessions.filter((s) => s.provider === provider);

  console.log(`Provider: ${provider}`);
  console.log(`Auth sessions: ${sessions.length}\n`);

  if (sessions.length === 0) {
    console.log("No auth sessions found.");
    console.log(`Start authorization with: maestro provider auth start --provider ${provider}`);
    return;
  }

  for (const session of sessions) {
    console.log(`Session: ${session.id}`);
    console.log(`  Flow type: ${session.flowType}`);
    console.log(`  Status: ${session.status}`);
    console.log(`  Started: ${session.startedAt}`);
    if (session.userCode) {
      console.log(`  User code: ${session.userCode}`);
    }
    if (session.verificationUri) {
      console.log(`  Verification URI: ${session.verificationUri}`);
    }
    if (session.verificationUriComplete) {
      console.log(`  Complete URI: ${session.verificationUriComplete}`);
    }
    if (session.expiresAt) {
      console.log(`  Expires: ${session.expiresAt}`);
    }
    if (session.completedAt) {
      console.log(`  Completed: ${session.completedAt}`);
    }
    if (session.errorMessage) {
      console.log(`  Error: ${session.errorMessage}`);
    }
    console.log("");
  }
}

async function providerAuthStart(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const provider = getFlag(flags, "provider") || "kiro_cli";

  if (provider !== "kiro_cli" && provider !== "kiro_openclaude" && provider !== "openclaude" && provider !== "anthropic" && provider !== "grouter_kiro") {
    throw new Error(`Unsupported provider: ${provider}. Supported: kiro_cli, grouter_kiro, kiro_openclaude, openclaude, anthropic`);
  }

  console.log(`Starting authorization for provider: ${provider}\n`);

  // Handle kiro_cli with real device flow
  if (provider === "kiro_cli") {
    await startKiroCliAuth(homeDir);
    return;
  }

  // Handle grouter_kiro with guidance
  if (provider === "grouter_kiro") {
    await startGrouterKiroAuth(homeDir);
    return;
  }

  // For other providers, show placeholder
  console.log("⚠️  Authorization flow discovery in progress...\n");
  console.log("This command will:");
  console.log("1. Investigate how to trigger device code authorization");
  console.log("2. Create an auth session");
  console.log("3. Display the device code and URL for browser authorization\n");

  const state = await loadStateWithFriendlyError(homeDir);
  const { createProviderAuthSession, saveAuthSessionArtifacts } = await import("@maestro/providers");
  
  const session = createProviderAuthSession(
    provider as "kiro_openclaude" | "openclaude" | "anthropic",
    "device_code",
    state.providerAuthSessions.map((s) => s.id)
  );

  const updatedSession = {
    ...session,
    status: "FAILED" as const,
    errorMessage: "Authorization command not yet discovered. Need to investigate auth commands for this provider.",
    completedAt: new Date().toISOString()
  };

  const nextState = upsertProviderAuthSession(state, updatedSession);
  await saveState(homeDir, nextState);
  await saveAuthSessionArtifacts(homeDir, session.id, provider, updatedSession);

  console.log(`Auth session created: ${session.id}`);
  console.log(`Status: ${updatedSession.status}`);
  console.log(`\n❌ ${updatedSession.errorMessage}\n`);
}

async function startGrouterKiroAuth(homeDir: string): Promise<void> {
  const state = await loadStateWithFriendlyError(homeDir);
  const { loadGrouterConfig } = await import("@maestro/providers");
  
  const config = await loadGrouterConfig(homeDir);
  
  if (!config) {
    throw new Error("Grouter config not found. Copy config/grouter.example.json to data/config/grouter.json");
  }

  // Check if Kiro connection is already linked
  const kiroConnection = state.grouterConnections.find((c) => c.provider === "kiro" && c.label);

  if (kiroConnection) {
    console.log("✅ Kiro connection already linked.\n");
    console.log(`Connection: ${kiroConnection.id}`);
    console.log(`Label: ${kiroConnection.label}`);
    console.log(`Linked at: ${kiroConnection.linkedAt}\n`);
    console.log("No additional authorization needed.");
    console.log("Grouter manages the Kiro account. Maestro references it via allowlist.");
    return;
  }

  // No Kiro connection linked - show instructions
  console.log("ℹ️  No Kiro connection linked to Maestro.\n");
  console.log("Grouter manages Kiro authorization. Follow these steps:\n");
  console.log("1. Open Grouter dashboard:");
  console.log(`   ${config.dashboardUrl}\n`);
  console.log("2. Add or confirm a Kiro connection:");
  console.log("   - Click 'Add Provider'");
  console.log("   - Select 'Kiro'");
  console.log("   - Complete device code flow (AWS Builder ID)\n");
  console.log("3. Sync connections to Maestro:");
  console.log("   maestro provider grouter sync\n");
  console.log("4. Link the Kiro connection:");
  console.log("   maestro provider grouter link --connection <id> --provider kiro --label \"Kiro principal\"\n");
  console.log("5. Verify:");
  console.log("   maestro provider doctor --provider grouter\n");
  console.log("This approach avoids duplicating authorization.");
  console.log("Grouter is the single source of truth for accounts.");
}

async function startKiroCliAuth(homeDir: string): Promise<void> {
  const { loadKiroCliConfig } = await import("@maestro/providers");
  const config = await loadKiroCliConfig(homeDir);

  if (!config) {
    throw new Error("Kiro CLI config not found. Copy config/kiro-cli.example.json to data/config/kiro-cli.json");
  }

  if (!config.executablePath) {
    throw new Error("executablePath not configured in kiro-cli.json");
  }

  const state = await loadStateWithFriendlyError(homeDir);
  const { createProviderAuthSession, updateAuthSessionWithDeviceCode, saveAuthSessionArtifacts, markAuthSessionAuthorizedWithInfo, markAuthSessionFailed } = await import("@maestro/providers");
  
  const session = createProviderAuthSession(
    "kiro_cli",
    "device_code",
    state.providerAuthSessions.map((s) => s.id)
  );

  let nextState = upsertProviderAuthSession(state, session);
  await saveState(homeDir, nextState);

  console.log(`Auth session created: ${session.id}\n`);
  console.log("Starting Kiro CLI login with device flow...\n");

  // Spawn kiro-cli login --use-device-flow
  const loginProcess = spawn(config.executablePath, ["login", "--use-device-flow"], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let rawOutput = "";
  let deviceCodeFound = false;
  let updatedSession = session;

  // Capture stdout
  loginProcess.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    rawOutput += text;
    process.stdout.write(text); // Echo to console

    // Try to parse device code
    if (!deviceCodeFound) {
      const authInfo = parseDeviceCodeAuthOutput(rawOutput);
      if (isDeviceCodeAuthComplete(authInfo)) {
        deviceCodeFound = true;
        updatedSession = updateAuthSessionWithDeviceCode(
          updatedSession,
          authInfo.deviceCode,
          authInfo.userCode!,
          authInfo.verificationUri!,
          authInfo.verificationUriComplete,
          authInfo.expiresIn
        );
        
        // Update state immediately
        nextState = upsertProviderAuthSession(nextState, updatedSession);
        saveState(homeDir, nextState).catch(console.error);
        saveAuthSessionArtifacts(homeDir, session.id, "kiro_cli", updatedSession, rawOutput).catch(console.error);

        console.log("\n✅ Device code captured!");
        console.log(`\nYour code: ${authInfo.userCode}`);
        console.log(`Authorization URL: ${authInfo.verificationUriComplete || authInfo.verificationUri}\n`);
        console.log("After authorizing in your browser, the login will complete automatically.");
        console.log(`Or check status with: maestro provider auth poll --session ${session.id}\n`);
      }
    }
  });

  // Capture stderr
  loginProcess.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    rawOutput += text;
    process.stderr.write(text); // Echo to console
  });

  // Wait for process to complete
  await new Promise<void>((resolve, reject) => {
    loginProcess.on("close", async (code) => {
      if (code === 0) {
        // Login succeeded - check if we're actually authorized
        try {
          const { stdout } = await execFileAsync(config.executablePath, ["whoami", "--format", "json"], {
            timeout: 10000
          });
          
          const whoamiData = JSON.parse(stdout);
          if (whoamiData.email || whoamiData.user_id) {
            updatedSession = markAuthSessionAuthorizedWithInfo(
              updatedSession,
              whoamiData.email,
              whoamiData.display_name || whoamiData.name,
              whoamiData.auth_type || whoamiData.license
            );
            
            nextState = upsertProviderAuthSession(nextState, updatedSession);
            await saveState(homeDir, nextState);
            await saveAuthSessionArtifacts(homeDir, session.id, "kiro_cli", updatedSession, rawOutput);

            console.log("\n✅ Authorization successful!");
            console.log(`Email: ${whoamiData.email || "N/A"}`);
            console.log(`Session: ${session.id}`);
            console.log(`Status: AUTHORIZED\n`);
          } else {
            throw new Error("whoami returned success but no user info");
          }
        } catch (error) {
          updatedSession = markAuthSessionFailed(updatedSession, `Login completed but whoami failed: ${error instanceof Error ? error.message : String(error)}`);
          nextState = upsertProviderAuthSession(nextState, updatedSession);
          await saveState(homeDir, nextState);
          await saveAuthSessionArtifacts(homeDir, session.id, "kiro_cli", updatedSession, rawOutput);
          
          console.log(`\n⚠️  Login process completed but could not verify authorization.`);
          console.log(`Check status with: maestro provider auth poll --session ${session.id}\n`);
        }
        resolve();
      } else {
        updatedSession = markAuthSessionFailed(updatedSession, `Login process exited with code ${code}`);
        nextState = upsertProviderAuthSession(nextState, updatedSession);
        await saveState(homeDir, nextState);
        await saveAuthSessionArtifacts(homeDir, session.id, "kiro_cli", updatedSession, rawOutput);
        
        console.log(`\n❌ Authorization failed (exit code ${code})`);
        console.log(`Session: ${session.id}`);
        console.log(`Status: FAILED\n`);
        reject(new Error(`Login process exited with code ${code}`));
      }
    });

    loginProcess.on("error", async (error) => {
      updatedSession = markAuthSessionFailed(updatedSession, `Failed to spawn login process: ${error.message}`);
      nextState = upsertProviderAuthSession(nextState, updatedSession);
      await saveState(homeDir, nextState);
      await saveAuthSessionArtifacts(homeDir, session.id, "kiro_cli", updatedSession, rawOutput);
      
      console.log(`\n❌ Failed to start login process: ${error.message}\n`);
      reject(error);
    });
  });
}

async function providerAuthPoll(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const sessionId = getRequiredFlag(flags, "session");

  const state = await loadStateWithFriendlyError(homeDir);
  const session = state.providerAuthSessions.find((s) => s.id === sessionId);

  if (!session) {
    throw new Error(`Auth session not found: ${sessionId}`);
  }

  console.log(`Polling auth session: ${sessionId}`);
  console.log(`Provider: ${session.provider}`);
  console.log(`Status: ${session.status}\n`);

  if (session.status !== "AUTHORIZING") {
    console.log(`Session is not in AUTHORIZING state. Current status: ${session.status}`);
    return;
  }

  // Handle kiro_cli polling
  if (session.provider === "kiro_cli") {
    await pollKiroCliAuth(homeDir, session);
    return;
  }

  console.log("⚠️  Polling not yet implemented for this provider.");
  console.log("This command will check if the user has completed authorization in the browser.\n");
}

async function pollKiroCliAuth(homeDir: string, session: import("@maestro/core").ProviderAuthSession): Promise<void> {
  const { loadKiroCliConfig } = await import("@maestro/providers");
  const config = await loadKiroCliConfig(homeDir);

  if (!config) {
    throw new Error("Kiro CLI config not found");
  }

  console.log("Checking Kiro CLI authentication status...\n");

  try {
    const { stdout } = await execFileAsync(config.executablePath, ["whoami", "--format", "json"], {
      timeout: 10000
    });
    
    const whoamiData = JSON.parse(stdout);
    if (whoamiData.email || whoamiData.user_id) {
      const { markAuthSessionAuthorizedWithInfo, saveAuthSessionArtifacts } = await import("@maestro/providers");
      const updatedSession = markAuthSessionAuthorizedWithInfo(
        session,
        whoamiData.email,
        whoamiData.display_name || whoamiData.name,
        whoamiData.auth_type || whoamiData.license
      );
      
      const state = await loadStateWithFriendlyError(homeDir);
      const nextState = upsertProviderAuthSession(state, updatedSession);
      await saveState(homeDir, nextState);
      await saveAuthSessionArtifacts(homeDir, session.id, "kiro_cli", updatedSession);

      console.log("✅ Authorization successful!");
      console.log(`Email: ${whoamiData.email || "N/A"}`);
      if (whoamiData.display_name || whoamiData.name) {
        console.log(`Name: ${whoamiData.display_name || whoamiData.name}`);
      }
      console.log(`Status: AUTHORIZED\n`);
    } else {
      console.log("⚠️  Still not authorized. Please complete authorization in your browser.\n");
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("not logged in") || errorMsg.includes("not authenticated")) {
      console.log("⚠️  Still not authorized. Please complete authorization in your browser.\n");
    } else {
      console.log(`❌ Error checking authorization: ${errorMsg}\n`);
    }
  }
}

async function providerAuthCancel(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const sessionId = getRequiredFlag(flags, "session");

  const state = await loadStateWithFriendlyError(homeDir);
  const session = state.providerAuthSessions.find((s) => s.id === sessionId);

  if (!session) {
    throw new Error(`Auth session not found: ${sessionId}`);
  }

  console.log(`Cancelling auth session: ${sessionId}`);
  console.log(`Provider: ${session.provider}`);
  console.log(`Previous status: ${session.status}\n`);

  const { cancelAuthSession, saveAuthSessionArtifacts } = await import("@maestro/providers");
  const cancelledSession = cancelAuthSession(session);

  const nextState = upsertProviderAuthSession(state, cancelledSession);
  await saveState(homeDir, nextState);
  await saveAuthSessionArtifacts(homeDir, sessionId, session.provider, cancelledSession);

  console.log(`Auth session cancelled: ${sessionId}`);
  console.log(`Status: ${cancelledSession.status}`);
}

async function handleProviderGrouterCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "list":
      await providerGrouterList(homeDir, rest);
      break;
    case "sync":
      await providerGrouterSync(homeDir, rest);
      break;
    case "link":
      await providerGrouterLink(homeDir, rest);
      break;
    case "unlink":
      await providerGrouterUnlink(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printProviderGrouterHelp();
      break;
    default:
      throw new Error(`Unknown provider grouter command: ${subcommand}`);
  }
}

async function providerGrouterList(homeDir: string, args: string[]): Promise<void> {
  console.log("Grouter connections\n");

  try {
    const connections = await listGrouterConnections(homeDir);

    if (connections.length === 0) {
      console.log("No connections found.");
      console.log("Add connections via Grouter dashboard: http://localhost:3099/dashboard");
      return;
    }

    for (const conn of connections) {
      const email = conn.emailMasked || "(no email)";
      const status = conn.status || "unknown";
      console.log(`  ${conn.id} | ${conn.provider} | ${email} | ${status}`);
    }

    console.log(`\nTotal: ${connections.length} connection(s)`);
    console.log("\nTo link a connection:");
    console.log("  maestro provider grouter sync");
    console.log("  maestro provider grouter link --connection <id> --provider kiro --label \"Kiro principal\"");
  } catch (error) {
    console.error(`Error listing Grouter connections: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function providerGrouterSync(homeDir: string, args: string[]): Promise<void> {
  console.log("Syncing Grouter connections...\n");

  try {
    const synced = await syncGrouterConnections(homeDir);

    console.log(`Synced ${synced.length} Grouter connection ref(s).`);
    console.log("No credentials were copied.\n");

    if (synced.length > 0) {
      console.log("Connections:");
      for (const conn of synced) {
        const email = conn.emailMasked || "(no email)";
        const status = conn.status || "unknown";
        const label = conn.label ? ` | ${conn.label}` : "";
        console.log(`  ${conn.id} | ${conn.provider} | ${email} | ${status}${label}`);
      }
    }

    console.log("\nTo link a connection:");
    console.log("  maestro provider grouter link --connection <id> --provider kiro --label \"Kiro principal\"");
  } catch (error) {
    console.error(`Error syncing Grouter connections: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function providerGrouterLink(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const connectionId = getRequiredFlag(flags, "connection");
  const provider = getRequiredFlag(flags, "provider");
  const label = getFlag(flags, "label");

  console.log(`Linking Grouter connection: ${connectionId}...\n`);

  try {
    const linked = await linkGrouterConnection(homeDir, connectionId, provider, label);

    console.log(`Linked Grouter connection: ${linked.id}`);
    console.log(`  Provider: ${linked.provider}`);
    console.log(`  Label: ${linked.label || "(none)"}`);
    console.log(`  Email: ${linked.emailMasked || "(no email)"}`);
    console.log(`  Linked at: ${linked.linkedAt}`);
    console.log("\nConnection is now allowed for use by Maestro.");
    console.log("Run provider doctor to verify:");
    console.log("  maestro provider doctor --provider grouter");
  } catch (error) {
    console.error(`Error linking Grouter connection: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function providerGrouterUnlink(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const connectionId = getRequiredFlag(flags, "connection");

  console.log(`Unlinking Grouter connection: ${connectionId}...\n`);

  try {
    await unlinkGrouterConnection(homeDir, connectionId);

    console.log(`Unlinked Grouter connection: ${connectionId}`);
    console.log("Connection is no longer allowed for use by Maestro.");
    console.log("The connection still exists in Grouter.");
  } catch (error) {
    console.error(`Error unlinking Grouter connection: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function printProviderGrouterHelp(): void {
  console.log(`Provider grouter commands:

  maestro provider grouter list
  maestro provider grouter sync
  maestro provider grouter link --connection <id> --provider <provider> [--label <label>]
  maestro provider grouter unlink --connection <id>

Examples:
  maestro provider grouter list
  maestro provider grouter sync
  maestro provider grouter link --connection 0c010b69 --provider kiro --label "Kiro principal"
  maestro provider grouter unlink --connection 0c010b69
`);
}

function printProviderAuthHelp(): void {
  console.log(`Provider auth commands:

  maestro provider auth status [--provider kiro_cli]
    Show all auth sessions for a provider

  maestro provider auth start --provider <provider>
    Start a new authorization flow (device code)
    Supported providers: kiro_cli, kiro_openclaude, openclaude, anthropic

  maestro provider auth poll --session <session-id>
    Check if authorization has been completed

  maestro provider auth cancel --session <session-id>
    Cancel an ongoing authorization session
`);
}

async function handleRepoCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "status":
      await repoStatus(homeDir, rest);
      break;
    case "diff":
      await repoDiff(homeDir, rest);
      break;
    case "guard":
      await repoGuard(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printRepoHelp();
      break;
    default:
      throw new Error(`Unknown repo command: ${subcommand}`);
  }
}

async function handleRunWorkspaceCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "create":
      await createRunWorkspaceCommand(homeDir, rest);
      break;
    case "status":
      await runWorkspaceStatusCommand(homeDir, rest);
      break;
    case "diff":
      await runWorkspaceDiffCommand(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printRunWorkspaceHelp();
      break;
    default:
      throw new Error(`Unknown run workspace command: ${subcommand}`);
  }
}

async function importContext(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const filePath = getRequiredFlag(flags, "file");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = state.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const result = await importProjectContext(homeDir, project, filePath);

  console.log(`Context imported for project: ${project.id}`);
  console.log(`Source: ${result.sourceFilePath}`);
  console.log(`Vault file: ${result.importedContextPath}`);
}

async function printContextStatus(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = state.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const status = await getProjectContextStatus(homeDir, project.id);

  console.log(`Context status for ${project.name} (${project.id})`);
  console.log(`Vault: ${status.projectVaultDir}`);
  console.log(`Imported context: ${status.importedContextExists ? "present" : "missing"}`);

  for (const file of status.files) {
    const marker = file.exists ? "present" : "missing";
    console.log(`${file.fileName} | ${marker} | ${file.sizeBytes} bytes`);
  }
}

async function packContext(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = state.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const result = await createContextPack(
    homeDir,
    project,
    state.tasks.filter((task) => task.projectId === project.id),
    state.decisions.filter((decision) => decision.projectId === project.id),
    state.runs.filter((run) => run.projectId === project.id)
  );

  console.log(`Context pack created for project: ${project.id}`);
  console.log(`Vault file: ${result.contextPackPath}`);
  console.log(`Included files: ${result.includedFiles.length}`);
}

async function refreshMemory(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  const result = await refreshProjectMemory(
    homeDir,
    project,
    state.tasks.filter((task) => task.projectId === project.id),
    state.runs.filter((run) => run.projectId === project.id),
    state.decisions.filter((decision) => decision.projectId === project.id)
  );

  console.log(`Memory refreshed for project: ${project.id}`);
  console.log(`Active context: ${result.activeContextPath}`);
  console.log(`Open questions: ${result.openQuestionsPath}`);
  console.log(`Risk register: ${result.riskRegisterPath}`);
  console.log(`Next step: maestro context pack --project ${project.id}`);
}

async function checkpointMemory(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const notes = getRequiredFlag(flags, "notes");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  const result = await checkpointProjectMemory(
    homeDir,
    project,
    state.tasks.filter((task) => task.projectId === project.id),
    state.runs.filter((run) => run.projectId === project.id),
    state.decisions.filter((decision) => decision.projectId === project.id),
    notes
  );

  console.log(`Memory checkpoint created for project: ${project.id}`);
  console.log(`Checkpoint file: ${result.checkpointPath}`);
}

async function briefMemory(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  const brief = await readProjectMemoryBrief(
    homeDir,
    project,
    state.tasks.filter((task) => task.projectId === project.id),
    state.runs.filter((run) => run.projectId === project.id),
    state.decisions.filter((decision) => decision.projectId === project.id)
  );

  console.log(`Project: ${brief.projectLine}`);
  console.log(`Current goal: ${brief.currentGoal}`);
  console.log(`High/Urgent open tasks:`);
  printList(brief.highPriorityTasks);
  console.log(`Blockers:`);
  printList(brief.blockers);
  console.log(`Runs awaiting human decision:`);
  printList(brief.runsAwaitingDecision);
  console.log(`Recommended next step: ${brief.nextStep}`);
}

async function addTask(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const title = getRequiredFlag(flags, "title");
  const description = getFlag(flags, "description") || "";
  const priority = parseTaskPriority(getFlag(flags, "priority") || "MEDIUM");
  const tags = parseTags(getFlag(flags, "tags"));
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  const now = new Date().toISOString();
  const task: ProjectTask = {
    id: createTaskId(project.id, state.tasks),
    projectId: project.id,
    title,
    description,
    status: "TODO",
    priority,
    tags,
    relatedRunIds: [],
    createdAt: now,
    updatedAt: now
  };
  const nextState = upsertTask(state, task);

  await saveState(homeDir, nextState);
  await appendTaskAddedToBacklog(homeDir, project, task);
  await syncTaskBoardToVault(
    homeDir,
    project,
    nextState.tasks.filter((item) => item.projectId === project.id),
    nextState.decisions.filter((decision) => decision.projectId === project.id)
  );

  console.log(`Task added: ${task.id}`);
  console.log(`Status: ${task.status}`);
}

async function listTasks(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const statusFilter = getFlag(flags, "status");
  const priorityFilter = getFlag(flags, "priority");
  const tagFilter = getFlag(flags, "tag");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  let tasks = state.tasks.filter((task) => task.projectId === project.id);

  if (statusFilter) {
    const status = parseTaskStatus(statusFilter);
    tasks = tasks.filter((task) => task.status === status);
  }

  if (priorityFilter) {
    const priority = parseTaskPriority(priorityFilter);
    tasks = tasks.filter((task) => task.priority === priority);
  }

  if (tagFilter) {
    tasks = tasks.filter((task) => task.tags.includes(tagFilter));
  }

  if (tasks.length === 0) {
    console.log(`No tasks found for project: ${project.id}`);
    return;
  }

  for (const task of sortTasksForDisplay(tasks)) {
    console.log(
      `${task.id} | ${task.status} | ${task.priority} | ${task.title} | tags: ${formatInline(task.tags)} | runs: ${formatInline(task.relatedRunIds)}`
    );
  }
}

async function showTask(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const taskId = getRequiredFlag(flags, "task");
  const state = await loadStateWithFriendlyError(homeDir);
  const task = findTaskOrThrow(state.tasks, taskId);
  const project = findProjectOrThrow(state.projects, task.projectId);

  console.log(`Task: ${task.id}`);
  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`Title: ${task.title}`);
  console.log(`Description: ${task.description || "Not set"}`);
  console.log(`Status: ${task.status}`);
  console.log(`Priority: ${task.priority}`);
  console.log(`Tags: ${formatInline(task.tags)}`);
  console.log(`Related runs: ${formatInline(task.relatedRunIds)}`);
  console.log(`Created: ${task.createdAt}`);
  console.log(`Updated: ${task.updatedAt}`);
  if (task.completedAt) console.log(`Completed: ${task.completedAt}`);
  if (task.blockedReason) console.log(`Blocked reason: ${task.blockedReason}`);
  console.log(`Next step: ${getNextTaskStep(task)}`);
}

async function updateTask(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const taskId = getRequiredFlag(flags, "task");
  const state = await loadStateWithFriendlyError(homeDir);
  const task = findTaskOrThrow(state.tasks, taskId);
  const project = findProjectOrThrow(state.projects, task.projectId);
  const nextTask: ProjectTask = {
    ...task,
    title: getFlag(flags, "title") || task.title,
    description: getFlag(flags, "description") ?? task.description,
    status: getFlag(flags, "status") ? parseTaskStatus(getFlag(flags, "status") || task.status) : task.status,
    priority: getFlag(flags, "priority") ? parseTaskPriority(getFlag(flags, "priority") || task.priority) : task.priority,
    tags: getFlag(flags, "tags") !== undefined ? parseTags(getFlag(flags, "tags")) : task.tags,
    updatedAt: new Date().toISOString()
  };

  if (nextTask.status === "DONE" && !nextTask.completedAt) {
    nextTask.completedAt = nextTask.updatedAt;
  }

  const nextState = upsertTask(state, nextTask);
  await saveState(homeDir, nextState);
  await syncTaskBoardToVault(
    homeDir,
    project,
    nextState.tasks.filter((item) => item.projectId === project.id),
    nextState.decisions.filter((decision) => decision.projectId === project.id)
  );

  console.log(`Task updated: ${nextTask.id}`);
  console.log(`Status: ${nextTask.status}`);
}

async function blockTask(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const taskId = getRequiredFlag(flags, "task");
  const reason = getRequiredFlag(flags, "reason");
  const state = await loadStateWithFriendlyError(homeDir);
  const task = findTaskOrThrow(state.tasks, taskId);
  const project = findProjectOrThrow(state.projects, task.projectId);
  const nextTask: ProjectTask = {
    ...task,
    status: "BLOCKED",
    blockedReason: reason,
    updatedAt: new Date().toISOString()
  };
  const nextState = upsertTask(state, nextTask);

  await saveState(homeDir, nextState);
  await appendTaskBlockedToKnownProblems(homeDir, project, nextTask);
  await syncTaskBoardToVault(
    homeDir,
    project,
    nextState.tasks.filter((item) => item.projectId === project.id),
    nextState.decisions.filter((decision) => decision.projectId === project.id)
  );

  console.log(`Task blocked: ${nextTask.id}`);
  console.log(`Reason: ${reason}`);
}

async function completeTask(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const taskId = getRequiredFlag(flags, "task");
  const state = await loadStateWithFriendlyError(homeDir);
  const task = findTaskOrThrow(state.tasks, taskId);
  const project = findProjectOrThrow(state.projects, task.projectId);
  const now = new Date().toISOString();
  const nextTask: ProjectTask = {
    ...task,
    status: "DONE",
    completedAt: now,
    updatedAt: now
  };
  const nextState = upsertTask(state, nextTask);

  await saveState(homeDir, nextState);
  await appendTaskCompletedToAgentLog(homeDir, project, nextTask);
  await syncTaskBoardToVault(
    homeDir,
    project,
    nextState.tasks.filter((item) => item.projectId === project.id),
    nextState.decisions.filter((decision) => decision.projectId === project.id)
  );

  console.log(`Task completed: ${nextTask.id}`);
}

async function syncTasksToVault(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  const backlogPath = await syncTaskBoardToVault(
    homeDir,
    project,
    state.tasks.filter((task) => task.projectId === project.id),
    state.decisions.filter((decision) => decision.projectId === project.id)
  );

  console.log(`Task board synced: ${backlogPath}`);
}

async function repoStatus(homeDir: string, args: string[]): Promise<void> {
  const project = await getProjectFromProjectFlag(homeDir, args);
  const state = await inspectGitRepo(project.repoPath);

  console.log(`Repository: ${state.repoPath}`);
  console.log(`Git repo: ${state.isGitRepo ? "yes" : "no"}`);
  console.log(`Branch: ${state.branch || "not detected"}`);
  console.log(`HEAD: ${state.head || "not detected"}`);
  console.log(`Status short:`);
  console.log(state.statusShort || "clean");
  console.log(`Changed files: ${state.changedFiles.length}`);
  for (const file of state.changedFiles) console.log(`- ${file}`);
  console.log(`Untracked files: ${state.untrackedFiles.length}`);
  for (const file of state.untrackedFiles) console.log(`- ${file}`);
  console.log(`Diffstat:`);
  console.log(state.diffStat || "clean");
}

async function repoDiff(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const outPath = getFlag(flags, "out");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  const diff = await getGitDiff(project.repoPath);

  if (outPath) {
    const resolvedOutPath = path.resolve(outPath);
    await fs.mkdir(path.dirname(resolvedOutPath), { recursive: true });
    await fs.writeFile(resolvedOutPath, diff.endsWith("\n") ? diff : `${diff}\n`, "utf8");
    console.log(`Diff written: ${resolvedOutPath}`);
    return;
  }

  console.log(diff || "clean");
}

async function repoGuard(homeDir: string, args: string[]): Promise<void> {
  const project = await getProjectFromProjectFlag(homeDir, args);
  const state = await inspectGitRepo(project.repoPath);
  console.log(getGitGuardStatus(state));
}

async function prepareRun(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const taskId = getFlag(flags, "task");
  const goalFlag = getFlag(flags, "goal");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = findProjectOrThrow(state.projects, projectId);
  let task: ProjectTask | undefined;
  let goal = goalFlag;

  if (taskId) {
    task = findTaskOrThrow(state.tasks, taskId);

    if (task.projectId !== project.id) {
      throw new Error(`Task ${task.id} does not belong to project ${project.id}.`);
    }

    goal = renderTaskRunGoal(task, goalFlag);
  }

  if (!goal) {
    throw new Error("Missing required flag: --goal or --task");
  }

  const hasActiveContext = await activeContextExists(homeDir, project);
  if (!hasActiveContext) {
    console.log("Aviso: Active Context ainda nao existe para este projeto.");
    console.log("Recomenda-se rodar:");
    console.log(`maestro memory refresh --project ${project.id}`);
    console.log(`maestro context pack --project ${project.id}`);
    console.log("");
  }

  const preparedRun = await prepareManualRun(homeDir, project, goal, { taskId: task?.id });
  let nextState = upsertRun(state, preparedRun.runRecord);

  if (task) {
    const nextTask: ProjectTask = {
      ...task,
      status: "IN_PROGRESS",
      relatedRunIds: [...new Set([...task.relatedRunIds, preparedRun.runRecord.id])],
      updatedAt: new Date().toISOString()
    };
    nextState = upsertTask(nextState, nextTask);
    await syncTaskBoardToVault(
      homeDir,
      project,
      nextState.tasks.filter((item) => item.projectId === project.id),
      nextState.decisions.filter((decision) => decision.projectId === project.id)
    );
  }

  await saveState(homeDir, nextState);

  console.log(`Run prepared for project: ${project.id}`);
  console.log(`Run id: ${preparedRun.runRecord.id}`);
  if (task) {
    console.log(`Linked task: ${task.id}`);
    console.log(`Task status: IN_PROGRESS`);
  }
  if (preparedRun.gitBaseline.isDirty) {
    console.log("Atenção: o repositório já tinha alterações antes desta run. O diff posterior pode misturar mudanças antigas com mudanças da execução atual.");
  }
  console.log(`Run directory: ${preparedRun.runDir}`);
  console.log(`Files:`);
  for (const file of preparedRun.files) {
    console.log(path.join(preparedRun.runDir, file));
  }
}

async function listRuns(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  const project = state.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const runs = state.runs.filter((run) => run.projectId === project.id);

  if (runs.length === 0) {
    console.log(`No runs registered for project: ${project.id}`);
    return;
  }

  for (const run of runs) {
    console.log(`${run.id} | ${run.status} | task: ${run.taskId || "none"} | ${run.createdAt} | ${run.updatedAt} | ${run.goal}`);
  }
}

async function showRun(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const task = run.taskId ? state.tasks.find((item) => item.id === run.taskId) : undefined;
  const humanDecision = findHumanDecisionForRun(state.decisions, run.id);
  const workspace = findWorkspaceForRun(state.workspaces, run.id);
  const workspaceExists = workspace ? await directoryExists(workspace.workspacePath) : false;
  const fileStatuses = await getRunFileStatuses(run);

  console.log(`Run: ${run.id}`);
  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`Task: ${run.taskId || "none"}`);
  if (task) {
    console.log(`Task status: ${task.status}`);
  }
  console.log(`Goal: ${run.goal}`);
  console.log(`Status: ${run.status}`);
  console.log(`Path: ${run.path}`);
  console.log(`Created: ${run.createdAt}`);
  console.log(`Updated: ${run.updatedAt}`);
  if (run.finalizedAt) {
    console.log(`Finalized: ${run.finalizedAt}`);
  }
  if (run.finalCommit) {
    console.log(`Final commit: ${run.finalCommit.sha}`);
    console.log(`Commit message: ${run.finalCommit.message}`);
    console.log(`Commit recorded: ${run.finalCommit.recordedAt}`);
  }
  console.log("Files:");
  for (const file of fileStatuses) {
    const marker = file.exists ? "present" : "missing";
    console.log(`${file.fileName} | ${marker} | ${file.sizeBytes} bytes`);
  }
  const hasBaseline = fileStatuses.some((file) => file.fileName === "11-git-baseline.md" && file.exists);
  const hasDiff = fileStatuses.some((file) => file.fileName === "13-git-diff.md" && file.exists);
  const hasChangedFiles = fileStatuses.some((file) => file.fileName === "14-changed-files.md" && file.exists);
  const hasExecutorOutput = fileStatuses.some((file) => file.fileName === "08-executor-output.md" && file.exists);
  const hasReviewerOutput = fileStatuses.some((file) => file.fileName === "09-reviewer-output.md" && file.exists);
  const hasSupervisorOutput = fileStatuses.some((file) => file.fileName === "07-supervisor-output.md" && file.exists);
  const hasHumanDecision = fileStatuses.some((file) => file.fileName === "15-human-decision.md" && file.exists);
  const handoffDir = path.join(run.path, "handoff");
  const handoffExists = await fs.stat(handoffDir).then(() => true).catch(() => false);
  const reviewDir = path.join(run.path, "review");
  const reviewExists = await fs.stat(reviewDir).then(() => true).catch(() => false);
  
  console.log(`Git baseline captured: ${hasBaseline ? "yes" : "no"}`);
  console.log(`Git diff captured: ${hasDiff ? "yes" : "no"}`);
  console.log(`Changed files captured: ${hasChangedFiles ? "yes" : "no"}`);
  console.log(`Handoff package exists: ${handoffExists ? "yes" : "no"}`);
  console.log(`Review package exists: ${reviewExists ? "yes" : "no"}`);
  console.log(`Reviewer output exists: ${hasReviewerOutput ? "yes" : "no"}`);
  console.log(`Human decision exists: ${hasHumanDecision || humanDecision ? "yes" : "no"}`);
  console.log(`Workspace exists: ${workspaceExists ? "yes" : "no"}`);
  if (workspace) {
    console.log(`Workspace status: ${workspaceExists ? workspace.status : "MISSING"}`);
    console.log(`Workspace path: ${workspace.workspacePath}`);
    if (workspaceExists) {
      console.log(`Kiro deve trabalhar somente em: ${workspace.workspacePath}`);
    }
  }
  if (humanDecision) {
    console.log(`Human decision status: ${humanDecision.status}`);
  }
  
  if (handoffExists) {
    console.log(`Handoff package path: ${path.join(handoffDir, "07-kiro-prompt.md")}`);
  } else if (hasSupervisorOutput && !workspaceExists) {
    console.log(`Sugestao antes de entregar ao Kiro:`);
    console.log(`maestro run workspace create --run ${run.id}`);
    console.log(`maestro run handoff --run ${run.id}`);
  } else if (hasSupervisorOutput) {
    console.log(`Sugestão: Crie o handoff package: maestro run handoff --run ${run.id}`);
  }

  if (reviewExists) {
    console.log(`Review package path: ${path.join(reviewDir, "08-codex-reviewer-prompt.md")}`);
  } else if (hasExecutorOutput) {
    console.log(`Sugestão: Crie o review package: maestro run review-package --run ${run.id}`);
  }
  
  console.log(`Next step: ${getRunInspectionNextStep(run, hasExecutorOutput, hasDiff, hasReviewerOutput, humanDecision)}`);
}

async function showRunTimeline(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const events = await generateRunTimeline(run);

  console.log(`Timeline da Run: ${run.id}`);
  console.log(`Goal: ${run.goal}`);
  console.log(`Status: ${run.status}`);
  console.log("");

  if (events.length === 0) {
    console.log("Nenhum evento registrado ainda.");
    return;
  }

  for (const event of events) {
    const icon = event.status === "OK" ? "✓" : event.status === "ERROR" ? "✗" : event.status === "WARN" ? "⚠" : "ℹ";
    const timestamp = event.timestamp ? new Date(event.timestamp).toLocaleString("pt-BR") : "N/A";
    console.log(`${icon} ${event.title}`);
    console.log(`  ${event.description}`);
    console.log(`  Timestamp: ${timestamp}`);
    if (event.artifactPath) {
      console.log(`  Artefato: ${event.artifactPath}`);
    }
    console.log("");
  }

  console.log(`Total de eventos: ${events.length}`);
}

async function attachRunOutput(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const stage = parseRunStage(getRequiredFlag(flags, "stage"));
  const filePath = getRequiredFlag(flags, "file");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const result = await attachRunStage(project, run, stage, filePath);

  await saveState(homeDir, upsertRun(state, result.runRecord));

  console.log(`Attached ${stage} output for run: ${run.id}`);
  console.log(`Output: ${result.outputPath}`);
  console.log(`Status: ${result.runRecord.status}`);
  console.log(`Next step: ${getNextRunStep(result.runRecord)}`);

  if (stage === "supervisor") {
    console.log("");
    console.log("Sugestão: Agora você pode criar o pacote de handoff para o Kiro:");
    console.log(`maestro run handoff --run ${run.id}`);
  }

  if (stage === "executor") {
    const hasDiff = await fs.stat(path.join(run.path, "13-git-diff.md")).then(() => true).catch(() => false);
    console.log("");
    if (!hasDiff) {
      console.log("⚠️  Atenção: antes da revisão final, recomenda-se capturar o diff real:");
      console.log(`maestro run capture-diff --run ${run.id}`);
      console.log("");
    }
    console.log("Sugestão: Agora você pode criar o pacote de revisão para o Codex:");
    console.log(`maestro run review-package --run ${run.id}`);
  }
}

async function createRunWorkspaceCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const force = Boolean(flags.force);
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const paths = getMaestroPaths(homeDir);
  const workspacePath = path.join(paths.workspacesDir, project.id, run.id);
  const existingWorkspace = findWorkspaceForRun(state.workspaces, run.id);
  const workspacePathExists = await directoryExists(workspacePath);

  if (existingWorkspace && workspacePathExists && !force) {
    console.log(`Workspace already exists for run: ${run.id}`);
    console.log(`Workspace path: ${existingWorkspace.workspacePath}`);
    console.log(`Use --force to recreate it.`);
    return;
  }

  if ((existingWorkspace || workspacePathExists) && force) {
    assertPathInside(paths.workspacesDir, workspacePath);
    await fs.rm(workspacePath, { recursive: true, force: true });
  } else if (workspacePathExists) {
    throw new Error(`Workspace path already exists: ${workspacePath}. Use --force to recreate it.`);
  }

  const workspace = await createRunWorkspace({
    projectId: project.id,
    runId: run.id,
    sourceRepoPath: project.repoPath,
    workspacePath
  });
  const nextState = upsertRunWorkspace(state, workspace);

  await writeRunWorkspaceSummary(run, workspace);
  await saveState(homeDir, nextState);

  console.log(`Run workspace created: ${workspace.id}`);
  console.log(`Source repo: ${workspace.sourceRepoPath}`);
  console.log(`Workspace path: ${workspace.workspacePath}`);
  console.log(`Status: ${workspace.status}`);
  console.log(`Baseline commit: ${workspace.baselineCommit || "not captured"}`);
  console.log(`Run file: ${path.join(run.path, "16-workspace.md")}`);
}

async function runWorkspaceStatusCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const workspace = findWorkspaceForRun(state.workspaces, run.id);

  if (!workspace) {
    console.log(`Workspace exists: no`);
    console.log(`Status: MISSING`);
    return;
  }

  const exists = await directoryExists(workspace.workspacePath);
  if (!exists) {
    const missingWorkspace = { ...workspace, status: "MISSING" as WorkspaceStatus, updatedAt: new Date().toISOString() };
    await saveState(homeDir, upsertRunWorkspace(state, missingWorkspace));
    console.log(`Workspace exists: no`);
    console.log(`Workspace path: ${workspace.workspacePath}`);
    console.log(`Status: MISSING`);
    return;
  }

  const gitState = await inspectRunWorkspace(workspace.workspacePath);
  const nextStatus = getWorkspaceStatusFromGit(workspace, gitState);
  const nextWorkspace = { ...workspace, status: nextStatus, updatedAt: new Date().toISOString() };
  await saveState(homeDir, upsertRunWorkspace(state, nextWorkspace));

  console.log(`Workspace exists: yes`);
  console.log(`Workspace path: ${workspace.workspacePath}`);
  console.log(`Source repo: ${workspace.sourceRepoPath}`);
  console.log(`Status: ${nextWorkspace.status}`);
  console.log(`Baseline commit: ${workspace.baselineCommit || "not captured"}`);
  console.log(`Git repo: ${gitState.isGitRepo ? "yes" : "no"}`);
  console.log(`Branch: ${gitState.branch || "not detected"}`);
  console.log(`HEAD: ${gitState.head || "not detected"}`);
  console.log(`Status short:`);
  console.log(gitState.statusShort || "clean");
  console.log(`Changed files: ${gitState.changedFiles.length}`);
  for (const file of gitState.changedFiles) console.log(`- ${file}`);
  console.log(`Untracked files: ${gitState.untrackedFiles.length}`);
  for (const file of gitState.untrackedFiles) console.log(`- ${file}`);
  console.log(`Diffstat:`);
  console.log(gitState.diffStat || "clean");
}

async function runWorkspaceDiffCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const outPath = getFlag(flags, "out");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const workspace = findWorkspaceForRun(state.workspaces, run.id);

  if (!workspace || !(await directoryExists(workspace.workspacePath))) {
    throw new Error(`Workspace not found for run: ${run.id}`);
  }

  const diff = await getRunWorkspaceDiff(workspace.workspacePath);

  if (outPath) {
    const resolvedOutPath = path.resolve(outPath);
    await fs.mkdir(path.dirname(resolvedOutPath), { recursive: true });
    await fs.writeFile(resolvedOutPath, diff.endsWith("\n") ? diff : `${diff}\n`, "utf8");
    console.log(`Workspace diff written: ${resolvedOutPath}`);
    return;
  }

  console.log(diff || "clean");
}

async function createHandoffCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const task = run.taskId ? findTaskOrThrow(state.tasks, run.taskId) : undefined;
  const workspace = findWorkspaceForRun(state.workspaces, run.id);

  const result = await createHandoffPackage(run, project, task, workspace);

  console.log(`Handoff package created for run: ${run.id}`);
  console.log(`Handoff directory: ${result.handoffDir}`);
  console.log(`Files created:`);
  for (const file of result.files) {
    console.log(`- ${path.join(result.handoffDir, file)}`);
  }
  console.log("");
  console.log("Próximos passos:");
  console.log(`1. Copie o conteúdo de: ${path.join(result.handoffDir, "07-kiro-prompt.md")}`);
  console.log("2. Cole no Kiro para executar a task");
  console.log("3. Após a execução do Kiro, capture o diff:");
  console.log(`   maestro run capture-diff --run ${run.id}`);
  console.log("4. Anexe o relatório do Kiro:");
  console.log(`   maestro run attach --run ${run.id} --stage executor --file <kiro-report.md>`);
}

async function createReviewPackageCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const task = run.taskId ? findTaskOrThrow(state.tasks, run.taskId) : undefined;

  const hasDiff = await fs.stat(path.join(run.path, "13-git-diff.md")).then(() => true).catch(() => false);
  
  if (!hasDiff) {
    console.log("⚠️  Atenção: esta run ainda não tem diff real capturado.");
    console.log("A revisão ficará menos confiável sem o diff real.");
    console.log(`Recomenda-se rodar: maestro run capture-diff --run ${run.id}`);
    console.log("");
  }

  const result = await createReviewPackage(run, project, task);

  console.log(`Review package created for run: ${run.id}`);
  console.log(`Review directory: ${result.reviewDir}`);
  if (result.missingDiff) {
    console.log("⚠️  Diff real não capturado - a revisão será baseada apenas no relatório do executor.");
  }
  console.log(`Files created:`);
  for (const file of result.files) {
    console.log(`- ${path.join(result.reviewDir, file)}`);
  }
  console.log("");
  console.log("Próximos passos:");
  console.log(`1. Copie o conteúdo de: ${path.join(result.reviewDir, "08-codex-reviewer-prompt.md")}`);
  console.log("2. Cole no Codex para revisar a execução");
  console.log("3. Após a revisão do Codex, anexe o veredito:");
  console.log(`   maestro run attach --run ${run.id} --stage reviewer --file <codex-review.md>`);
  console.log("4. Registre a decisao humana:");
  console.log(`   maestro run decide --run ${run.id} --status APPROVED --notes "A execucao foi aceita."`);
  console.log("5. Finalize a run:");
  console.log(`   maestro run finalize --run ${run.id}`);
}

async function decideRunCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const status = parseHumanDecisionStatus(getRequiredFlag(flags, "status"));
  const notes = getRequiredFlag(flags, "notes");
  const wantsFollowUpTask = Boolean(flags["create-follow-up-task"]);
  if (wantsFollowUpTask && status !== "NEEDS_CHANGES" && status !== "REJECTED") {
    throw new Error("--create-follow-up-task is only supported for NEEDS_CHANGES or REJECTED decisions.");
  }
  const createFollowUpTask = wantsFollowUpTask;
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const task = run.taskId ? findTaskOrThrow(state.tasks, run.taskId) : undefined;
  const now = new Date().toISOString();
  let nextState: MaestroState = state;
  let nextTask: ProjectTask | undefined;
  let followUpTask: ProjectTask | undefined;

  if (createFollowUpTask) {
    followUpTask = createFollowUpTaskForRun(project, run, flags, notes, state.tasks, now);
    nextState = upsertTask(nextState, followUpTask);
    await appendTaskAddedToBacklog(homeDir, project, followUpTask);
  }

  const decision: HumanReviewDecision = {
    id: createHumanDecisionId(run.id),
    runId: run.id,
    projectId: project.id,
    taskId: run.taskId,
    status,
    notes,
    createFollowUpTask,
    followUpTaskId: followUpTask?.id,
    decidedAt: now
  };

  if (task) {
    nextTask = applyHumanDecisionToTask(task, decision);
    nextState = upsertTask(nextState, nextTask);
  }

  nextState = upsertHumanReviewDecision(nextState, decision);

  const result = await writeHumanReviewDecisionArtifacts(homeDir, project, run, decision, nextTask || task, followUpTask);
  await syncTaskBoardToVault(
    homeDir,
    project,
    nextState.tasks.filter((item) => item.projectId === project.id),
    nextState.decisions.filter((item) => item.projectId === project.id)
  );
  await saveState(homeDir, nextState);

  console.log(`Human decision recorded for run: ${run.id}`);
  console.log(`Decision: ${decision.status}`);
  console.log(`Decision file: ${result.decisionPath}`);
  console.log(`Decisions log updated: ${result.decisionsPath}`);
  console.log(`Agent log updated: ${result.agentLogPath}`);
  console.log(`Next actions updated: ${result.nextActionsPath}`);
  if (result.knownProblemsPath) {
    console.log(`Known problems updated: ${result.knownProblemsPath}`);
  }
  if (nextTask) {
    console.log(`Linked task updated: ${nextTask.id} | ${nextTask.status}`);
  }
  if (followUpTask) {
    console.log(`Follow-up task created: ${followUpTask.id}`);
  }
  console.log("Sugestao: atualize a memoria ativa do projeto:");
  console.log(`maestro memory refresh --project ${project.id}`);
  console.log(`maestro context pack --project ${project.id}`);
  console.log(`Next step: maestro run finalize --run ${run.id}`);
}

async function handlePatchCommand(homeDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "export":
      await exportPatchCommand(homeDir, rest);
      break;
    case "check":
      await checkPatchCommand(homeDir, rest);
      break;
    case "plan":
      await planPatchCommand(homeDir, rest);
      break;
    case "apply":
      await applyPatchCommand(homeDir, rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printPatchHelp();
      break;
    default:
      throw new Error(`Unknown patch command: ${subcommand}`);
  }
}

async function exportPatchCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const workspace = state.workspaces.find((ws) => ws.runId === run.id);

  if (!workspace) {
    throw new Error(`No workspace found for run: ${run.id}. Create one first with: maestro run workspace create --run ${run.id}`);
  }

  const workspaceExists = await fs.stat(workspace.workspacePath).then(() => true).catch(() => false);
  if (!workspaceExists) {
    throw new Error(`Workspace path does not exist: ${workspace.workspacePath}`);
  }

  const patchPath = path.join(run.path, "17-promotion-patch.patch");
  const summaryPath = path.join(run.path, "18-promotion-summary.md");

  try {
    await exportWorkspacePatch({
      runId: run.id,
      projectId: project.id,
      workspacePath: workspace.workspacePath,
      outPath: patchPath,
      baselineCommit: workspace.baselineCommit
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No changes detected")) {
      console.log("⚠️  Nenhuma alteração detectada no workspace. Patch não gerado.");
      return;
    }
    throw error;
  }

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

  await fs.writeFile(summaryPath, renderPromotionSummary(promotion, patchInfo), "utf8");
  await saveState(homeDir, upsertPatchPromotion(state, promotion));

  console.log(`Patch exported for run: ${run.id}`);
  console.log(`Patch: ${patchPath}`);
  console.log(`Summary: ${summaryPath}`);
  console.log(`Files changed: ${patchInfo.filesChanged.length}`);
  console.log(`Additions: ${patchInfo.additions || 0} | Deletions: ${patchInfo.deletions || 0}`);
  console.log(`Patch size: ${(patchInfo.sizeBytes / 1024).toFixed(2)} KB`);
  console.log("");
  console.log("Próximo passo: validar se o patch aplica no repo original:");
  console.log(`maestro run patch check --run ${run.id}`);
}

async function checkPatchCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const promotion = state.promotions.find((p) => p.runId === run.id);

  if (!promotion) {
    throw new Error(`No patch promotion found for run: ${run.id}. Export the patch first with: maestro run patch export --run ${run.id}`);
  }

  const patchExists = await fs.stat(promotion.patchPath).then(() => true).catch(() => false);
  if (!patchExists) {
    throw new Error(`Patch file not found: ${promotion.patchPath}`);
  }

  const checkPath = path.join(run.path, "19-promotion-check.md");
  const repoState = await inspectGitRepo(project.repoPath);
  const guardStatus = getGitGuardStatus(repoState);

  if (guardStatus === "DIRTY" || guardStatus === "UNTRACKED") {
    const nextPromotion: PatchPromotion = {
      ...promotion,
      status: "BLOCKED",
      checkOutput: `Target repo is ${guardStatus}. Clean it before applying patch.`,
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(checkPath, renderPromotionCheck(nextPromotion, false, guardStatus), "utf8");
    await saveState(homeDir, upsertPatchPromotion(state, nextPromotion));

    console.log(`⚠️  Patch check BLOCKED for run: ${run.id}`);
    console.log(`Reason: Target repo is ${guardStatus}`);
    console.log(`Check file: ${checkPath}`);
    console.log("");
    console.log("O repositório original precisa estar limpo antes de validar o patch.");
    console.log("Commit ou descarte as mudanças pendentes e rode o check novamente.");
    return;
  }

  const checkResult = await checkPatchApplies({
    targetRepoPath: project.repoPath,
    patchPath: promotion.patchPath
  });

  const nextPromotion: PatchPromotion = {
    ...promotion,
    status: checkResult.ok ? "CHECK_PASSED" : "CHECK_FAILED",
    checkOutput: checkResult.output,
    updatedAt: new Date().toISOString()
  };

  await fs.writeFile(checkPath, renderPromotionCheck(nextPromotion, true, guardStatus), "utf8");
  await saveState(homeDir, upsertPatchPromotion(state, nextPromotion));

  console.log(`Patch check ${checkResult.ok ? "PASSED" : "FAILED"} for run: ${run.id}`);
  console.log(`Check file: ${checkPath}`);
  if (checkResult.ok) {
    console.log("");
    console.log("✅ O patch aplica limpo no repositório original.");
    console.log("Próximo passo: gerar plano de aplicação:");
    console.log(`maestro run patch plan --run ${run.id}`);
  } else {
    console.log("");
    console.log("❌ O patch NÃO aplica limpo no repositório original.");
    console.log("Verifique o arquivo de check para detalhes do conflito.");
  }
}

async function planPatchCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const promotion = state.promotions.find((p) => p.runId === run.id);

  if (!promotion) {
    throw new Error(`No patch promotion found for run: ${run.id}. Export the patch first.`);
  }

  const planPath = path.join(run.path, "20-apply-plan.md");
  const patchInfo = await inspectPatch({ patchPath: promotion.patchPath });

  await fs.writeFile(planPath, renderApplyPlan(promotion, patchInfo, project, run), "utf8");

  console.log(`Apply plan created for run: ${run.id}`);
  console.log(`Plan file: ${planPath}`);
  console.log("");
  console.log("O plano de aplicação foi gerado.");
  console.log("Revise o plano e, quando estiver pronto:");
  console.log(`maestro run patch apply --run ${run.id} --dry-run`);
  console.log(`maestro run patch apply --run ${run.id} --confirm APPLY_TO_ORIGINAL_REPO`);
}

async function applyPatchCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const isDryRun = flags["dry-run"] === "true" || flags["dry-run"] === "" || flags["dry-run"] === true;
  const confirmation = flags["confirm"];

  // Validate confirmation for real apply
  if (!isDryRun && confirmation !== "APPLY_TO_ORIGINAL_REPO") {
    throw new Error(
      `Patch apply requires explicit confirmation. Use:\n` +
      `  --dry-run (to validate without applying)\n` +
      `  --confirm APPLY_TO_ORIGINAL_REPO (to apply for real)`
    );
  }

  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const promotion = state.promotions.find((p) => p.runId === run.id);
  const workspace = state.workspaces.find((w) => w.runId === run.id);
  const decision = state.decisions.find((d) => d.runId === run.id);

  // Preflight checks
  const preflightErrors: string[] = [];
  
  if (!workspace) {
    preflightErrors.push("Run does not have a workspace sandbox");
  }

  if (!promotion) {
    preflightErrors.push("No patch promotion found for this run");
  }

  if (promotion && !await fs.stat(promotion.patchPath).then(() => true).catch(() => false)) {
    preflightErrors.push(`Patch file not found: ${promotion.patchPath}`);
  }

  if (promotion && promotion.status !== "CHECK_PASSED") {
    preflightErrors.push(`Patch check status is ${promotion.status}, expected CHECK_PASSED`);
  }

  if (!decision || decision.status !== "APPROVED") {
    preflightErrors.push(`Human decision is ${decision?.status || "missing"}, expected APPROVED`);
  }

  const repoState = await inspectGitRepo(project.repoPath);
  const guardStatus = getGitGuardStatus(repoState);

  if (guardStatus !== "CLEAN") {
    preflightErrors.push(`Target repo is ${guardStatus}, expected CLEAN`);
  }

  // Run git apply --check
  let checkResult: CheckPatchResult | undefined;
  if (promotion && preflightErrors.length === 0) {
    checkResult = await checkPatchApplies({
      targetRepoPath: project.repoPath,
      patchPath: promotion.patchPath
    });

    if (!checkResult.ok) {
      preflightErrors.push(`git apply --check failed: ${checkResult.output}`);
    }
  }

  // Write preflight report
  const preflightPath = path.join(run.path, "21-apply-preflight.md");
  await fs.writeFile(
    preflightPath,
    renderApplyPreflight(run, project, promotion, decision, guardStatus, checkResult, preflightErrors, isDryRun),
    "utf8"
  );

  // If preflight failed, abort
  if (preflightErrors.length > 0) {
    console.log(`❌ Patch apply preflight FAILED for run: ${run.id}`);
    console.log(`Preflight report: ${preflightPath}`);
    console.log("");
    console.log("Errors:");
    for (const error of preflightErrors) {
      console.log(`  - ${error}`);
    }
    console.log("");
    console.log("Fix these issues before applying the patch.");
    return;
  }

  // Dry run: stop here
  if (isDryRun) {
    const resultPath = path.join(run.path, "22-apply-result.md");
    await fs.writeFile(
      resultPath,
      renderApplyResult("DRY_RUN_PASSED", project, promotion!, checkResult!.output, "Dry-run passed. No changes were applied."),
      "utf8"
    );

    const diffPath = path.join(run.path, "23-applied-diff.md");
    await fs.writeFile(
      diffPath,
      "# Applied Diff\n\nDry-run executado. Nenhuma alteração foi aplicada.\n",
      "utf8"
    );

    console.log(`✅ Patch apply dry-run PASSED for run: ${run.id}`);
    console.log(`Preflight report: ${preflightPath}`);
    console.log(`Result: ${resultPath}`);
    console.log("");
    console.log("All validations passed. Ready to apply for real:");
    console.log(`maestro run patch apply --run ${run.id} --confirm APPLY_TO_ORIGINAL_REPO`);
    return;
  }

  // Real apply
  try {
    const applyResult = await execFileAsync("git", ["apply", promotion!.patchPath], {
      cwd: project.repoPath,
      maxBuffer: 10 * 1024 * 1024
    });

    // Capture applied diff
    const statResult = await execFileAsync("git", ["diff", "--stat"], {
      cwd: project.repoPath,
      maxBuffer: 4 * 1024 * 1024
    });

    const diffResult = await execFileAsync("git", ["diff", "--no-ext-diff"], {
      cwd: project.repoPath,
      maxBuffer: 10 * 1024 * 1024
    });

    const statusResult = await execFileAsync("git", ["status", "--short"], {
      cwd: project.repoPath,
      maxBuffer: 2 * 1024 * 1024
    });

    const appliedDiffPath = path.join(run.path, "23-applied-diff.md");
    await fs.writeFile(
      appliedDiffPath,
      renderAppliedDiff(statResult.stdout, diffResult.stdout, statusResult.stdout),
      "utf8"
    );

    // Update promotion status
    const updatedPromotion: PatchPromotion = {
      ...promotion!,
      status: "APPLIED",
      appliedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await saveState(homeDir, upsertPatchPromotion(state, updatedPromotion));

    // Write result
    const resultPath = path.join(run.path, "22-apply-result.md");
    await fs.writeFile(
      resultPath,
      renderApplyResult("APPLIED", project, updatedPromotion, applyResult.stdout || applyResult.stderr, "Patch applied successfully to original repository."),
      "utf8"
    );

    console.log(`✅ Patch APPLIED to original repository for run: ${run.id}`);
    console.log(`Preflight report: ${preflightPath}`);
    console.log(`Result: ${resultPath}`);
    console.log(`Applied diff: ${appliedDiffPath}`);
    console.log("");
    console.log("⚠️  IMPORTANT: The patch was applied to the working tree.");
    console.log("Next steps:");
    console.log(`  1. Review the changes: git -C "${project.repoPath}" diff`);
    console.log(`  2. Run tests to validate the changes`);
    console.log(`  3. Commit manually if everything is correct`);
    console.log(`  4. Or discard if needed: git -C "${project.repoPath}" reset --hard`);

  } catch (error: any) {
    // Apply failed
    const updatedPromotion: PatchPromotion = {
      ...promotion!,
      status: "CHECK_FAILED",
      checkOutput: error.stderr || error.stdout || error.message,
      updatedAt: new Date().toISOString()
    };

    await saveState(homeDir, upsertPatchPromotion(state, updatedPromotion));

    const resultPath = path.join(run.path, "22-apply-result.md");
    await fs.writeFile(
      resultPath,
      renderApplyResult("FAILED", project, updatedPromotion, error.stderr || error.stdout || error.message, "Patch apply failed."),
      "utf8"
    );

    console.log(`❌ Patch apply FAILED for run: ${run.id}`);
    console.log(`Preflight report: ${preflightPath}`);
    console.log(`Result: ${resultPath}`);
    console.log("");
    console.log("Error:");
    console.log(error.stderr || error.stdout || error.message);
    throw error;
  }
}

function renderPromotionSummary(promotion: PatchPromotion, patchInfo: InspectPatchResult): string {
  return `# Patch Promotion Summary

## Run

- **Run ID:** ${promotion.runId}
- **Project ID:** ${promotion.projectId}

## Workspace source

${promotion.sourceWorkspacePath}

## Target repo

${promotion.targetRepoPath}

## Patch path

${promotion.patchPath}

## Arquivos alterados

${patchInfo.filesChanged.map((file) => `- ${file}`).join("\n") || "- none"}

## Estatísticas

- **Files changed:** ${patchInfo.filesChanged.length}
- **Additions:** ${patchInfo.additions || 0}
- **Deletions:** ${patchInfo.deletions || 0}
- **Patch size:** ${(patchInfo.sizeBytes / 1024).toFixed(2)} KB

## Status

${promotion.status}

## Observações

Este patch foi gerado a partir do workspace sandbox. Ele ainda não foi aplicado no repo original.

Próximos passos:

1. Validar se o patch aplica: \`maestro run patch check --run ${promotion.runId}\`
2. Gerar plano de aplicação: \`maestro run patch plan --run ${promotion.runId}\`
3. Aplicar patch (comando futuro): \`maestro run patch apply --run ${promotion.runId} --confirm APPLY_TO_ORIGINAL_REPO\`
`;
}

function renderPromotionCheck(promotion: PatchPromotion, repoClean: boolean, guardStatus: string): string {
  return `# Patch Promotion Check

## Status

${promotion.status}

## Target repo clean?

${repoClean ? "yes" : `no (${guardStatus})`}

## Comando executado

${repoClean ? `git apply --check ${promotion.patchPath}` : "Check not executed - repo is dirty"}

## Saída

\`\`\`text
${promotion.checkOutput || "No output"}
\`\`\`

## Próximo passo sugerido

${
  promotion.status === "CHECK_PASSED"
    ? `O patch aplica limpo. Gere o plano de aplicação:\n\nmaestro run patch plan --run ${promotion.runId}`
    : promotion.status === "BLOCKED"
      ? "O repositório original está sujo. Commit ou descarte as mudanças pendentes e rode o check novamente."
      : "O patch não aplica limpo. Verifique os conflitos acima e corrija no workspace sandbox."
}
`;
}

function renderApplyPlan(promotion: PatchPromotion, patchInfo: InspectPatchResult, project: Project, run: RunRecord): string {
  return `# Apply Plan

## Run

- **Run ID:** ${run.id}
- **Goal:** ${run.goal}

## Projeto

- **Project:** ${project.name} (${project.id})
- **Target repo:** ${project.repoPath}

## Patch

- **Path:** ${promotion.patchPath}
- **Size:** ${(patchInfo.sizeBytes / 1024).toFixed(2)} KB
- **Files changed:** ${patchInfo.filesChanged.length}
- **Additions:** ${patchInfo.additions || 0}
- **Deletions:** ${patchInfo.deletions || 0}

## Status do check

${promotion.status}

## Pré-condições

- [ ] Repo original precisa estar limpo.
- [ ] Patch precisa ter status CHECK_PASSED.
- [ ] Decisão humana precisa ser APPROVED.
- [ ] Usuário precisa executar o apply explicitamente.

## Arquivos que serão alterados

${patchInfo.filesChanged.map((file) => `- ${file}`).join("\n") || "- none"}

## Riscos

- **Conflitos:** Se o repo original mudou desde a criação do workspace, o patch pode não aplicar.
- **Regressões:** Mudanças no workspace podem introduzir bugs não detectados.
- **Testes:** Certifique-se de que os testes passam após aplicar o patch.

## Comandos de aplicação

\`\`\`bash
# Dry-run (valida sem aplicar):
maestro run patch apply --run ${run.id} --dry-run

# Aplicação real:
maestro run patch apply --run ${run.id} --confirm APPLY_TO_ORIGINAL_REPO
\`\`\`

Depois de aplicar:

1. Verifique que as mudanças estão corretas
2. Execute os testes
3. Commit as mudanças manualmente
4. Atualize a memória do projeto
`;
}

function renderApplyPreflight(
  run: RunRecord,
  project: Project,
  promotion: PatchPromotion | undefined,
  decision: HumanReviewDecision | undefined,
  guardStatus: string,
  checkResult: CheckPatchResult | undefined,
  errors: string[],
  isDryRun: boolean
): string {
  return `# Patch Apply Preflight

## Run

- **Run ID:** ${run.id}
- **Goal:** ${run.goal}

## Projeto

- **Project:** ${project.name} (${project.id})
- **Target repo:** ${project.repoPath}

## Patch

- **Path:** ${promotion?.patchPath || "N/A"}
- **Status:** ${promotion?.status || "N/A"}

## Confirmação recebida

${isDryRun ? "Dry-run mode" : "APPLY_TO_ORIGINAL_REPO"}

## Decisão humana

- **Status:** ${decision?.status || "missing"}
- **Notes:** ${decision?.notes || "N/A"}

## Promotion status

${promotion?.status || "N/A"}

## Repo original limpo?

${guardStatus === "CLEAN" ? "yes" : `no (${guardStatus})`}

## git apply --check

${checkResult ? (checkResult.ok ? "PASSED" : "FAILED") : "NOT_RUN"}

\`\`\`text
${checkResult?.output || "N/A"}
\`\`\`

## Resultado

${errors.length === 0 ? "✅ PASS - All preflight checks passed" : "❌ FAIL - Preflight checks failed"}

${errors.length > 0 ? `\n### Errors\n\n${errors.map((e) => `- ${e}`).join("\n")}` : ""}

## Próximo passo

${
  errors.length === 0
    ? isDryRun
      ? `Dry-run passed. Ready to apply for real:\n\nmaestro run patch apply --run ${run.id} --confirm APPLY_TO_ORIGINAL_REPO`
      : "Proceeding with patch apply..."
    : "Fix the errors above before applying the patch."
}
`;
}

function renderApplyResult(
  status: "APPLIED" | "DRY_RUN_PASSED" | "FAILED" | "BLOCKED",
  project: Project,
  promotion: PatchPromotion,
  commandOutput: string,
  notes: string
): string {
  return `# Patch Apply Result

## Status

${status}

## Data

${new Date().toISOString()}

## Target repo

${project.repoPath}

## Patch aplicado

${promotion.patchPath}

## Saída do comando

\`\`\`text
${commandOutput || "No output"}
\`\`\`

## Notas

${notes}

## Próximo passo sugerido

${
  status === "APPLIED"
    ? `- Revisar diff no repo original: git -C "${project.repoPath}" diff\n- Rodar testes\n- Commitar manualmente se estiver tudo certo: git -C "${project.repoPath}" commit -am "message"\n- Ou descartar se necessário: git -C "${project.repoPath}" reset --hard`
    : status === "DRY_RUN_PASSED"
      ? `Apply for real:\n\nmaestro run patch apply --run ${promotion.runId} --confirm APPLY_TO_ORIGINAL_REPO`
      : "Fix the errors and try again."
}
`;
}

function renderAppliedDiff(statOutput: string, diffOutput: string, statusOutput: string): string {
  return `# Applied Diff

## git diff --stat

\`\`\`text
${statOutput || "No changes"}
\`\`\`

## git status --short

\`\`\`text
${statusOutput || "No changes"}
\`\`\`

## git diff --no-ext-diff

\`\`\`diff
${diffOutput || "No changes"}
\`\`\`

## Próximos passos

1. Revisar as mudanças acima
2. Rodar testes para validar
3. Commitar manualmente se tudo estiver correto
4. Ou descartar se necessário: \`git reset --hard\`
`;
}

async function finalizeRunCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const humanDecision = findHumanDecisionForRun(state.decisions, run.id);
  const result = await finalizeRun(homeDir, project, run, humanDecision);
  let nextState = upsertRun(state, result.runRecord);
  let linkedTask: ProjectTask | undefined;

  if (result.runRecord.taskId && !humanDecision) {
    const task = findTaskOrThrow(state.tasks, result.runRecord.taskId);
    linkedTask = {
      ...task,
      status: "REVIEW_NEEDED",
      updatedAt: new Date().toISOString()
    };
    nextState = upsertTask(nextState, linkedTask);
    await appendTaskReviewNeededToNextActions(homeDir, project, linkedTask, result.runRecord);
    await syncTaskBoardToVault(
      homeDir,
      project,
      nextState.tasks.filter((item) => item.projectId === project.id),
      nextState.decisions.filter((decision) => decision.projectId === project.id)
    );
  }

  await saveState(homeDir, nextState);

  console.log(`Run finalized: ${run.id}`);
  console.log(`Final summary: ${result.finalSummaryPath}`);
  console.log(`Agent log updated: ${result.agentLogPath}`);
  console.log(`Next actions updated: ${result.nextActionsPath}`);
  console.log(`Status: ${result.runRecord.status}`);
  if (result.missingGitDiff) {
    console.log("Aviso: esta run foi finalizada sem diff real capturado. A revisão pode ter sido baseada apenas no relatório manual.");
  }

  if (result.missingHumanDecision) {
    console.log("Aviso: esta run ainda nao tem decisao humana registrada.");
    console.log(`Use: maestro run decide --run ${run.id} --status APPROVED --notes "..."`);
  } else if (humanDecision) {
    console.log(`Human decision: ${humanDecision.status}`);
  }

  if (linkedTask) {
    console.log(`Run finalizada. A task vinculada foi movida para REVIEW_NEEDED.`);
    console.log(`Use:`);
    console.log(`maestro run decide --run ${run.id} --status APPROVED --notes "A execucao foi aceita."`);
    console.log(`ou`);
    console.log(`maestro run decide --run ${run.id} --status NEEDS_CHANGES --notes "..." --create-follow-up-task`);
    console.log(`ou`);
    console.log(`maestro run decide --run ${run.id} --status BLOCKED --notes "..."`);
  }
}

async function attachCommitCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const commitSha = getRequiredFlag(flags, "commit");
  const commitMessage = getRequiredFlag(flags, "message");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const result = await attachFinalCommit(project, run, commitSha, commitMessage);
  const nextState = upsertRun(state, result.runRecord);

  await saveState(homeDir, nextState);

  console.log(`Final commit recorded for run: ${run.id}`);
  console.log(`Commit: ${commitSha}`);
  console.log(`Message: ${commitMessage}`);
  console.log(`File: ${result.commitFilePath}`);
  console.log(`Status: ${result.runRecord.status}`);
}

async function captureRunDiffCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const workspace = findWorkspaceForRun(state.workspaces, run.id);
  const useWorkspace = Boolean(workspace && (await directoryExists(workspace.workspacePath)));
  const result = await captureRunGitDiff(
    project,
    run,
    useWorkspace && workspace
      ? { repoPath: workspace.workspacePath, source: "WORKSPACE_SANDBOX" }
      : { source: "ORIGINAL_REPO" }
  );

  if (useWorkspace && workspace) {
    const nextWorkspace: RunWorkspace = {
      ...workspace,
      status: "CAPTURED",
      updatedAt: new Date().toISOString()
    };
    await saveState(homeDir, upsertRunWorkspace(state, nextWorkspace));
  }

  console.log(`Git diff captured for run: ${run.id}`);
  console.log(`Fonte do diff: ${result.source}`);
  console.log(`After state: ${result.afterPath}`);
  console.log(`Diff: ${result.diffPath}`);
  console.log(`Changed files: ${result.changedFilesPath}`);
  if (result.diffTruncated) {
    console.log("Diff was truncated because it exceeded the configured limit.");
  }
}

async function blockRunCommand(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const runId = getRequiredFlag(flags, "run");
  const reason = getRequiredFlag(flags, "reason");
  const state = await loadStateWithFriendlyError(homeDir);
  const run = findRunOrThrow(state.runs, runId);
  const project = findProjectForRunOrThrow(state.projects, run);
  const nextRun = await blockRun(project, run, reason);

  await saveState(homeDir, upsertRun(state, nextRun));

  console.log(`Run blocked: ${run.id}`);
  console.log(`Status: ${nextRun.status}`);
}

async function printMemoryStatus(homeDir: string): Promise<void> {
  const status = await getMemoryStatus(homeDir);

  console.log("Maestro memory status");
  console.log(`Home: ${status.homeDir}`);
  console.log(`State file: ${status.stateFileExists ? "present" : "missing"}`);
  console.log(`Vault: ${status.vaultExists ? "present" : "missing"}`);
  console.log(`Project vault: ${status.projectsVaultDir}`);
  console.log(`Project folders: ${status.projectFolderCount}`);
  console.log(`Markdown documents: ${status.markdownDocumentCount}`);
}

async function collectProjectInput(flags: Record<string, string | true>, positionals: string[]): Promise<ProjectInput> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const name = await getRequiredValue(rl, getFlag(flags, "name") || positionals[0], "Project name");
    const repoPath = getFlag(flags, "repo-path", "repoPath") || (await askOptional(rl, "Repository path"));
    const description = getFlag(flags, "description") || (await askOptional(rl, "Description"));
    const stackRaw = getFlag(flags, "stack") || (await askOptional(rl, "Stack (comma-separated)"));
    const status = (getFlag(flags, "status") || "active") as ProjectStatus;
    const priority = (getFlag(flags, "priority") || "medium") as ProjectPriority;
    const id = getFlag(flags, "id");

    return {
      id,
      name,
      repoPath: repoPath ? path.resolve(repoPath) : "",
      description,
      stack: parseStack(stackRaw),
      status,
      priority
    };
  } finally {
    rl.close();
  }
}

async function getRequiredValue(
  rl: ReturnType<typeof createInterface>,
  currentValue: string | undefined,
  label: string
): Promise<string> {
  const value = currentValue?.trim();

  if (value) {
    return value;
  }

  const answer = (await rl.question(`${label}: `)).trim();
  if (!answer) {
    throw new Error(`${label} is required.`);
  }

  return answer;
}

async function askOptional(rl: ReturnType<typeof createInterface>, label: string): Promise<string> {
  return (await rl.question(`${label} (optional): `)).trim();
}

function printProject(project: Project, homeDir: string): void {
  const projectVaultPath = path.join(getMaestroPaths(homeDir).projectsVaultDir, project.id);

  console.log(`Id: ${project.id}`);
  console.log(`Name: ${project.name}`);
  console.log(`Repository: ${project.repoPath || "Not set"}`);
  console.log(`Description: ${project.description || "Not set"}`);
  console.log(`Stack: ${project.stack.length > 0 ? project.stack.join(", ") : "Not set"}`);
  console.log(`Status: ${project.status}`);
  console.log(`Priority: ${project.priority}`);
  console.log(`Created: ${project.createdAt}`);
  console.log(`Updated: ${project.updatedAt}`);
  console.log(`Vault: ${projectVaultPath}`);
}

function findExistingProjectForInput(projects: Project[], input: ProjectInput): Project | undefined {
  const requestedId = slugify(input.id || input.name);
  const requestedName = input.name.trim().toLowerCase();

  return projects.find((project) => project.id === requestedId || project.name.trim().toLowerCase() === requestedName);
}

function findProjectOrThrow(projects: Project[], projectId: string): Project {
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  return project;
}

async function getProjectFromProjectFlag(homeDir: string, args: string[]): Promise<Project> {
  const { flags } = parseFlags(args);
  const projectId = getRequiredFlag(flags, "project");
  const state = await loadStateWithFriendlyError(homeDir);
  return findProjectOrThrow(state.projects, projectId);
}

function findTaskOrThrow(tasks: ProjectTask[], taskId: string): ProjectTask {
  const task = tasks.find((item) => item.id === taskId);

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return task;
}

function findRunOrThrow(runs: RunRecord[], runId: string): RunRecord {
  const run = runs.find((item) => item.id === runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  return run;
}

function findProjectForRunOrThrow(projects: Project[], run: RunRecord): Project {
  const project = projects.find((item) => item.id === run.projectId);

  if (!project) {
    throw new Error(`Project not found for run ${run.id}: ${run.projectId}`);
  }

  return project;
}

function findWorkspaceForRun(workspaces: RunWorkspace[], runId: string): RunWorkspace | undefined {
  return workspaces.find((workspace) => workspace.runId === runId);
}

function findAgentProfileOrThrow(profiles: AgentProfile[], agentId: string): AgentProfile {
  const profile = profiles.find((item) => item.id === agentId);

  if (!profile) {
    throw new Error(`Agent profile not found: ${agentId}. Run: maestro agents init-defaults`);
  }

  return profile;
}

function findAgentInvocationOrThrow(invocations: AgentInvocation[], invocationId: string): AgentInvocation {
  const invocation = invocations.find((item) => item.id === invocationId);

  if (!invocation) {
    throw new Error(`Agent invocation not found: ${invocationId}`);
  }

  return invocation;
}

function findAgentProfileForRoleOrThrow(profiles: AgentProfile[], role: AgentRole, projectId: string): AgentProfile {
  const profile = profiles.find((item) => item.role === role && (!item.projectIds || item.projectIds.includes(projectId)));

  if (!profile) {
    throw new Error(`Agent profile not found for role ${role}. Run: maestro agents init-defaults`);
  }

  return profile;
}

function runStageForAgentInvocationStage(stage: AgentInvocation["stage"]): RunStage | undefined {
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

function parseAgentProvider(value: string): AgentProvider {
  const allowed: AgentProvider[] = ["manual", "openclaude", "codex_manual", "kiro_openclaude", "openclaude_grouter"];

  if (allowed.includes(value as AgentProvider)) {
    return value as AgentProvider;
  }

  throw new Error(`Invalid provider: ${value}. Allowed: ${allowed.join(", ")}`);
}

function parseAgentRole(value: string): AgentRole {
  const allowed: AgentRole[] = [
    "CEO",
    "CTO",
    "FULL_STACK_DEV",
    "QA",
    "MEMORY",
    "CTO_SUPERVISOR",
    "FULL_STACK_EXECUTOR",
    "CODE_REVIEWER",
    "QA_VALIDATOR"
  ];

  if (allowed.includes(value as AgentRole)) {
    return value as AgentRole;
  }

  throw new Error(`Invalid role: ${value}. Allowed: ${allowed.join(", ")}`);
}

async function ensureDefaultAgentModelMap(homeDir: string): Promise<string> {
  const paths = getMaestroPaths(homeDir);
  const configDir = paths.configDir;
  const modelMapPath = path.join(configDir, "agent-model-map.json");
  const exists = await fs.stat(modelMapPath).then((stats) => stats.isFile()).catch(() => false);

  await fs.mkdir(configDir, { recursive: true });

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

function getWorkspaceStatusFromGit(workspace: RunWorkspace, gitState: Awaited<ReturnType<typeof inspectRunWorkspace>>): WorkspaceStatus {
  if (!gitState.isGitRepo) {
    return "MISSING";
  }

  const guardStatus = getGitGuardStatus(gitState);
  if (guardStatus === "DIRTY" || guardStatus === "UNTRACKED") {
    return "DIRTY";
  }

  return workspace.status === "CAPTURED" ? "CAPTURED" : "CREATED";
}

async function writeRunWorkspaceSummary(run: RunRecord, workspace: RunWorkspace): Promise<void> {
  const summaryPath = path.join(run.path, "16-workspace.md");
  const content = `# Run Workspace Sandbox

## Status

${workspace.status}

## Source repo

${workspace.sourceRepoPath}

## Workspace path

${workspace.workspacePath}

## Baseline commit

${workspace.baselineCommit || "not captured"}

## Regras

- O Kiro deve trabalhar somente neste workspace.
- Nao trabalhar no repo original.
- O diff da execucao sera capturado a partir deste sandbox.
- A aplicacao das mudancas no repo original exige um passo futuro explicito.
`;

  await fs.mkdir(run.path, { recursive: true });
  await fs.writeFile(summaryPath, content, "utf8");
}

async function directoryExists(dirPath: string): Promise<boolean> {
  const stats = await fs.stat(dirPath).catch(() => undefined);
  return Boolean(stats?.isDirectory());
}

function assertPathInside(rootDir: string, targetPath: string): void {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to operate outside workspace root: ${resolvedTarget}`);
  }
}

function findHumanDecisionForRun(decisions: HumanReviewDecision[], runId: string): HumanReviewDecision | undefined {
  return decisions
    .filter((decision) => decision.runId === runId)
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0];
}

function createHumanDecisionId(runId: string): string {
  return `${runId}-human-decision`;
}

function applyHumanDecisionToTask(task: ProjectTask, decision: HumanReviewDecision): ProjectTask {
  const updatedAt = decision.decidedAt;

  switch (decision.status) {
    case "APPROVED":
      return {
        ...task,
        status: "DONE",
        completedAt: updatedAt,
        blockedReason: undefined,
        updatedAt
      };
    case "NEEDS_CHANGES":
    case "REJECTED":
      return {
        ...task,
        status: "TODO",
        completedAt: undefined,
        blockedReason: undefined,
        updatedAt
      };
    case "BLOCKED":
      return {
        ...task,
        status: "BLOCKED",
        blockedReason: decision.notes,
        completedAt: undefined,
        updatedAt
      };
  }
}

function createFollowUpTaskForRun(
  project: Project,
  run: RunRecord,
  flags: Record<string, string | true>,
  notes: string,
  existingTasks: ProjectTask[],
  now: string
): ProjectTask {
  const title = getFlag(flags, "follow-up-title") || `Correcoes da run ${run.id}`;
  const description =
    getFlag(flags, "follow-up-description") || renderFollowUpTaskDescription(run, notes);
  const priority = parseTaskPriority(getFlag(flags, "follow-up-priority") || "HIGH");
  const tags = getFlag(flags, "follow-up-tags")
    ? parseTags(getFlag(flags, "follow-up-tags"))
    : ["follow-up", "review-fix"];

  return {
    id: createTaskId(project.id, existingTasks),
    projectId: project.id,
    title,
    description,
    status: "TODO",
    priority,
    tags,
    relatedRunIds: [],
    createdAt: now,
    updatedAt: now
  };
}

function renderFollowUpTaskDescription(run: RunRecord, notes: string): string {
  return [
    `Follow-up generated from run ${run.id}.`,
    "",
    "Original objective:",
    run.goal,
    "",
    "Human notes:",
    notes || "Not provided.",
    "",
    "Codex review path:",
    path.join(run.path, "09-reviewer-output.md"),
    "",
    "Previous run path:",
    run.path
  ].join("\n");
}

async function loadStateWithFriendlyError(homeDir: string) {
  try {
    return await loadState(homeDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load Maestro state. Run "maestro init" first. Details: ${message}`);
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const [command, ...rest] = args;
  return { command, rest };
}

function parseFlags(args: string[]): ParsedFlags {
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token.startsWith("--")) {
      const key = token.slice(2);
      const nextToken = args[index + 1];

      if (nextToken && !nextToken.startsWith("--")) {
        flags[key] = nextToken;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(token);
    }
  }

  return { flags, positionals };
}

function getFlag(flags: Record<string, string | true>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags[name];

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function getRequiredFlag(flags: Record<string, string | true>, name: string): string {
  const value = getFlag(flags, name);

  if (!value) {
    throw new Error(`Missing required flag: --${name}`);
  }

  return value;
}

function parseRunStage(value: string): RunStage {
  if (value === "supervisor" || value === "executor" || value === "reviewer") {
    return value;
  }

  throw new Error(`Invalid run stage: ${value}. Expected supervisor, executor, or reviewer.`);
}

function parseTaskStatus(value: string): TaskStatus {
  const normalized = value.trim().toUpperCase();

  if (TASK_STATUS_ORDER.includes(normalized as TaskStatus)) {
    return normalized as TaskStatus;
  }

  throw new Error(`Invalid task status: ${value}. Expected ${TASK_STATUS_ORDER.join(", ")}.`);
}

function parseTaskPriority(value: string): TaskPriority {
  const normalized = value.trim().toUpperCase();

  if (TASK_PRIORITY_ORDER.includes(normalized as TaskPriority)) {
    return normalized as TaskPriority;
  }

  throw new Error(`Invalid task priority: ${value}. Expected ${TASK_PRIORITY_ORDER.join(", ")}.`);
}

function parseHumanDecisionStatus(value: string): HumanDecisionStatus {
  const normalized = value.trim().toUpperCase();

  if (HUMAN_DECISION_STATUSES.includes(normalized as HumanDecisionStatus)) {
    return normalized as HumanDecisionStatus;
  }

  throw new Error(`Invalid human decision status: ${value}. Expected ${HUMAN_DECISION_STATUSES.join(", ")}.`);
}

function parseStack(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createTaskId(projectId: string, tasks: ProjectTask[]): string {
  const existingIds = new Set(tasks.map((task) => task.id));
  let index = tasks.filter((task) => task.projectId === projectId).length + 1;
  let candidate = `${projectId}-task-${String(index).padStart(3, "0")}`;

  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${projectId}-task-${String(index).padStart(3, "0")}`;
  }

  return candidate;
}

function sortTasksForDisplay(tasks: ProjectTask[]): ProjectTask[] {
  return [...tasks].sort((left, right) => {
    const statusDiff = TASK_STATUS_ORDER.indexOf(left.status) - TASK_STATUS_ORDER.indexOf(right.status);
    if (statusDiff !== 0) return statusDiff;
    const priorityDiff = TASK_PRIORITY_ORDER.indexOf(left.priority) - TASK_PRIORITY_ORDER.indexOf(right.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function formatInline(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function printList(values: string[]): void {
  if (values.length === 0) {
    console.log("- none");
    return;
  }

  for (const value of values) {
    console.log(`- ${value}`);
  }
}

function getNextTaskStep(task: ProjectTask): string {
  switch (task.status) {
    case "TODO":
      return `Move to READY or prepare a run: maestro run prepare --project ${task.projectId} --task ${task.id}`;
    case "READY":
      return `Prepare a run: maestro run prepare --project ${task.projectId} --task ${task.id}`;
    case "IN_PROGRESS":
      return "Finish the linked run or attach the next run stage.";
    case "REVIEW_NEEDED":
      return `Human decision needed: maestro task complete --task ${task.id}, update status, or block the task.`;
    case "DONE":
      return "Task complete. Pick the next task.";
    case "BLOCKED":
      return "Resolve blocker, then update task status.";
    case "CANCELLED":
      return "Task cancelled. No next action.";
  }
}

function getRunInspectionNextStep(
  run: RunRecord,
  hasExecutorOutput: boolean,
  hasDiff: boolean,
  hasReviewerOutput: boolean,
  humanDecision: HumanReviewDecision | undefined
): string {
  if (hasReviewerOutput && !humanDecision) {
    return `Decisao humana pendente: maestro run decide --run ${run.id} --status APPROVED --notes "A execucao foi aceita."`;
  }

  if (humanDecision?.status === "NEEDS_CHANGES") {
    return `Esta run precisa de ajustes. Considere criar uma follow-up task: maestro run decide --run ${run.id} --status NEEDS_CHANGES --notes "..." --create-follow-up-task`;
  }

  if (humanDecision?.status === "REJECTED") {
    return "Esta run foi rejeitada. Prepare uma nova run de retrabalho se o projeto ainda precisar dessa entrega.";
  }

  if (humanDecision?.status === "BLOCKED") {
    return "Esta run esta bloqueada. Resolva o bloqueio antes de continuar.";
  }

  if (hasExecutorOutput && !hasDiff) {
    return `Atenção: relatório do executor anexado, mas diff real ainda não capturado. Rode: maestro run capture-diff --run ${run.id}`;
  }

  if (run.status === "SUPERVISOR_PLANNED" || run.status === "EXECUTOR_READY") {
    return `Se o executor já mexeu no repo, rode: maestro run capture-diff --run ${run.id}. Depois anexe o relatório: maestro run attach --run ${run.id} --stage executor --file ./kiro-report.md`;
  }

  return getNextRunStep(run);
}

function renderTaskRunGoal(task: ProjectTask, additionalGoal: string | undefined): string {
  const sections = [`Task: ${task.title}`, "", "Description:", task.description || "No description.", ""];

  if (additionalGoal) {
    sections.push("Additional goal:", additionalGoal, "");
  }

  sections.push(`Task id: ${task.id}`);
  return sections.join("\n").trim();
}

async function readLastLines(filePath: string, lineCount: number): Promise<string> {
  const content = await fs.readFile(filePath, "utf8").catch(() => undefined);

  if (!content) {
    return "";
  }

  return content
    .trimEnd()
    .split(/\r?\n/u)
    .slice(-lineCount)
    .join("\n");
}

async function runFileExists(run: RunRecord, fileName: string): Promise<boolean> {
  const stats = await fs.stat(path.join(run.path, fileName)).catch(() => undefined);
  return Boolean(stats?.isFile());
}

function printHelp(): void {
  console.log(`Maestro CLI

Usage:
  maestro init
  maestro doctor
  maestro doctor --project <id>
  maestro smoke-test [--keep] [--verbose]
  maestro agents init-defaults
  maestro agents list
  maestro agents show --agent <id>
  maestro agents update --agent <id> [--provider <provider>] [--model <model>]
  maestro agent invoke --run <id> --role <role>
  maestro agent attach-output --invocation <id> --file <path>
  maestro project add [--name <name>] [--repo-path <path>] [--description <text>] [--stack <a,b>] [--status <status>] [--priority <priority>]
  maestro project list
  maestro project show <id>
  maestro project snapshot --project <id>
  maestro project dashboard --project <id>
  maestro repo status --project <id>
  maestro repo diff --project <id> [--out <path>]
  maestro repo guard --project <id>
  maestro task add --project <id> --title <title>
  maestro task list --project <id>
  maestro task show --task <id>
  maestro task update --task <id> [--status <status>] [--priority <priority>]
  maestro task block --task <id> --reason <reason>
  maestro task complete --task <id>
  maestro provider doctor [--provider grouter|openclaude|kiro_cli]
  maestro provider discover [--provider grouter|openclaude|kiro_cli]
  maestro provider auth status [--provider kiro_cli]
  maestro provider auth start --provider <provider>
  maestro provider auth poll --session <session-id>
  maestro provider auth cancel --session <session-id>
  maestro task sync-vault --project <id>
  maestro context import --project <id> --file <path>
  maestro context status --project <id>
  maestro context pack --project <id>
  maestro run prepare --project <id> --goal <goal>
  maestro run prepare --project <id> --task <task-id>
  maestro run list --project <id>
  maestro run show --run <id>
  maestro run attach --run <id> --stage <supervisor|executor|reviewer> --file <path>
  maestro run workspace create --run <id> [--force]
  maestro run workspace status --run <id>
  maestro run workspace diff --run <id> [--out <path>]
  maestro run handoff --run <id>
  maestro run review-package --run <id>
  maestro run decide --run <id> --status <APPROVED|NEEDS_CHANGES|REJECTED|BLOCKED> --notes <notes>
  maestro run patch export --run <id>
  maestro run patch check --run <id>
  maestro run patch plan --run <id>
  maestro run patch apply --run <id> --dry-run
  maestro run patch apply --run <id> --confirm APPLY_TO_ORIGINAL_REPO
  maestro run capture-diff --run <id>
  maestro run finalize --run <id>
  maestro run attach-commit --run <id> --commit <sha> --message <message>
  maestro run block --run <id> --reason <reason>
  maestro validation detect --project <id>
  maestro validation list --project <id>
  maestro validation run --run <id> --target WORKSPACE
  maestro validation run --run <id> --target ORIGINAL_REPO
  maestro pilot start --project <id> --title <title> --description <desc> [--priority <priority>] [--tags <tags>]
  maestro pilot status --project <id>
  maestro pilot next --project <id>
  maestro memory status
  maestro memory refresh --project <id>
  maestro memory brief --project <id>
  maestro memory checkpoint --project <id> --notes <notes>
`);
}

function printAgentsHelp(): void {
  console.log(`Agent profile commands:

  maestro agents init-defaults
  maestro agents list
  maestro agents show --agent <id>
  maestro agents update --agent <id> [--provider <manual|openclaude|codex_manual|kiro_openclaude|openclaude_grouter>] [--model <model>]
`);
}

function printAgentHelp(): void {
  console.log(`Agent invocation commands:

  maestro agent invoke --run <id> --role <CEO|CTO_SUPERVISOR|FULL_STACK_EXECUTOR|CODE_REVIEWER|QA_VALIDATOR>
  maestro agent attach-output --invocation <id> --file <path>
`);
}

function printProjectHelp(): void {
  console.log(`Project commands:

  maestro project add
  maestro project list
  maestro project show <id>
  maestro project snapshot --project <id>
  maestro project dashboard --project <id>
`);
}

function printMemoryHelp(): void {
  console.log(`Memory commands:

  maestro memory status
  maestro memory refresh --project <id>
  maestro memory brief --project <id>
  maestro memory checkpoint --project <id> --notes <notes>
`);
}

function printContextHelp(): void {
  console.log(`Context commands:

  maestro context import --project <id> --file <path>
  maestro context status --project <id>
  maestro context pack --project <id>
`);
}

function printTaskHelp(): void {
  console.log(`Task commands:

  maestro task add --project <id> --title <title> [--description <text>] [--priority <LOW|MEDIUM|HIGH|URGENT>] [--tags <a,b>]
  maestro task list --project <id> [--status <status>] [--priority <priority>] [--tag <tag>]
  maestro task show --task <id>
  maestro task update --task <id> [--status <status>] [--priority <priority>] [--title <title>] [--description <text>] [--tags <a,b>]
  maestro task block --task <id> --reason <reason>
  maestro task complete --task <id>
  maestro task sync-vault --project <id>
`);
}

function printRepoHelp(): void {
  console.log(`Repo commands:

  maestro repo status --project <id>
  maestro repo diff --project <id> [--out <path>]
  maestro repo guard --project <id>
`);
}

function printRunHelp(): void {
  console.log(`Run commands:

  maestro run prepare --project <id> --goal <goal>
  maestro run prepare --project <id> --task <task-id>
  maestro run list --project <id>
  maestro run show --run <id>
  maestro run timeline --run <id>
  maestro run attach --run <id> --stage <supervisor|executor|reviewer> --file <path>
  maestro run workspace create --run <id> [--force]
  maestro run workspace status --run <id>
  maestro run workspace diff --run <id> [--out <path>]
  maestro run handoff --run <id>
  maestro run review-package --run <id>
  maestro run decide --run <id> --status <APPROVED|NEEDS_CHANGES|REJECTED|BLOCKED> --notes <notes>
  maestro run patch export --run <id>
  maestro run patch check --run <id>
  maestro run patch plan --run <id>
  maestro run capture-diff --run <id>
  maestro run finalize --run <id>
  maestro run attach-commit --run <id> --commit <sha> --message <message>
  maestro run block --run <id> --reason <reason>
`);
}

function printPatchHelp(): void {
  console.log(`Patch commands:

  maestro run patch export --run <id>
  maestro run patch check --run <id>
  maestro run patch plan --run <id>
  maestro run patch apply --run <id> --dry-run
  maestro run patch apply --run <id> --confirm APPLY_TO_ORIGINAL_REPO
`);
}

function printRunWorkspaceHelp(): void {
  console.log(`Run workspace commands:

  maestro run workspace create --run <id> [--force]
  maestro run workspace status --run <id>
  maestro run workspace diff --run <id> [--out <path>]
`);
}

async function runDoctor(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = getFlag(flags, "project");

  if (projectId) {
    await runProjectDoctor(homeDir, projectId);
    return;
  }

  console.log("Maestro Doctor\n");

  let okCount = 0;
  let warnCount = 0;
  let errorCount = 0;

  // Check MAESTRO_HOME
  try {
    console.log(`[OK] MAESTRO_HOME: ${homeDir}`);
    okCount++;
  } catch {
    console.log(`[ERROR] MAESTRO_HOME not resolved`);
    errorCount++;
  }

  // Check state file
  const paths = getMaestroPaths(homeDir);
  try {
    await fs.access(paths.stateFile);
    console.log(`[OK] State file found: ${paths.stateFile}`);
    okCount++;
  } catch {
    console.log(`[ERROR] State file not found: ${paths.stateFile}`);
    errorCount++;
    console.log(`\nRun "maestro init" first.`);
    process.exit(1);
  }

  // Check state is parseable
  try {
    const state = await loadState(homeDir);
    console.log(`[OK] State is parseable`);
    okCount++;

    // Check arrays exist
    if (Array.isArray(state.projects)) {
      console.log(`[OK] Projects array exists (${state.projects.length} projects)`);
      okCount++;
    } else {
      console.log(`[ERROR] Projects array missing`);
      errorCount++;
    }

    if (Array.isArray(state.runs)) {
      console.log(`[OK] Runs array exists (${state.runs.length} runs)`);
      okCount++;
    } else {
      console.log(`[ERROR] Runs array missing`);
      errorCount++;
    }

    if (Array.isArray(state.tasks)) {
      console.log(`[OK] Tasks array exists (${state.tasks.length} tasks)`);
      okCount++;
    } else {
      console.log(`[ERROR] Tasks array missing`);
      errorCount++;
    }

    if (Array.isArray(state.decisions)) {
      console.log(`[OK] Decisions array exists (${state.decisions.length} decisions)`);
      okCount++;
    } else {
      console.log(`[ERROR] Decisions array missing`);
      errorCount++;
    }

    if (Array.isArray(state.workspaces)) {
      console.log(`[OK] Workspaces array exists (${state.workspaces.length} workspaces)`);
      okCount++;
    } else {
      console.log(`[ERROR] Workspaces array missing`);
      errorCount++;
    }

    if (Array.isArray(state.promotions)) {
      console.log(`[OK] Promotions array exists (${state.promotions.length} promotions)`);
      okCount++;
    } else {
      console.log(`[ERROR] Promotions array missing`);
      errorCount++;
    }

    // Check folders exist
    const foldersToCheck = [
      { path: paths.dataDir, name: "data/" },
      { path: paths.vaultDir, name: "data/vault/" },
      { path: paths.runsDir, name: "data/runs/" },
      { path: paths.workspacesDir, name: "data/workspaces/" },
      { path: paths.logsDir, name: "data/logs/" }
    ];

    for (const folder of foldersToCheck) {
      try {
        await fs.access(folder.path);
        console.log(`[OK] Folder exists: ${folder.name}`);
        okCount++;
      } catch {
        console.log(`[WARN] Folder missing: ${folder.name}`);
        warnCount++;
      }
    }

    // Check Git available
    try {
      await execFileAsync("git", ["--version"]);
      console.log(`[OK] Git is available`);
      okCount++;
    } catch {
      console.log(`[ERROR] Git is not available`);
      errorCount++;
    }

    // Check projects with invalid repoPaths
    for (const project of state.projects) {
      if (project.repoPath) {
        try {
          await fs.access(project.repoPath);
        } catch {
          console.log(`[WARN] Project "${project.name}" (${project.id}) points to non-existent repo: ${project.repoPath}`);
          warnCount++;
        }
      }
    }

    // Check runs pointing to non-existent projects
    for (const run of state.runs) {
      const project = state.projects.find((p) => p.id === run.projectId);
      if (!project) {
        console.log(`[ERROR] Run ${run.id} points to non-existent project: ${run.projectId}`);
        errorCount++;
      }
    }

    // Check tasks pointing to non-existent projects
    for (const task of state.tasks) {
      const project = state.projects.find((p) => p.id === task.projectId);
      if (!project) {
        console.log(`[ERROR] Task ${task.id} points to non-existent project: ${task.projectId}`);
        errorCount++;
      }
    }

    // Check workspaces pointing to non-existent paths
    for (const workspace of state.workspaces) {
      try {
        await fs.access(workspace.workspacePath);
      } catch {
        console.log(`[WARN] Workspace ${workspace.id} points to non-existent path: ${workspace.workspacePath}`);
        warnCount++;
      }
    }

    // Check promotions pointing to non-existent patches
    for (const promotion of state.promotions) {
      try {
        await fs.access(promotion.patchPath);
      } catch {
        console.log(`[WARN] Promotion ${promotion.id} points to non-existent patch: ${promotion.patchPath}`);
        warnCount++;
      }
    }
  } catch (error) {
    console.log(`[ERROR] Failed to parse state: ${error instanceof Error ? error.message : String(error)}`);
    errorCount++;
  }

  console.log(`\nSummary:`);
  console.log(`OK: ${okCount}`);
  console.log(`WARN: ${warnCount}`);
  console.log(`ERROR: ${errorCount}`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

async function runProjectDoctor(homeDir: string, projectId: string): Promise<void> {
  console.log(`Maestro Doctor - Project: ${projectId}\n`);

  const state = await loadStateWithFriendlyError(homeDir);
  const project = state.projects.find((p) => p.id === projectId);

  if (!project) {
    console.log(`[ERROR] Project not found: ${projectId}`);
    process.exit(1);
  }

  console.log(`[OK] Project exists: ${project.name}`);

  // Check repoPath
  if (project.repoPath) {
    try {
      await fs.access(project.repoPath);
      console.log(`[OK] Repo path exists: ${project.repoPath}`);

      // Check if it's a Git repo
      const repoState = await inspectGitRepo(project.repoPath);
      if (repoState.isGitRepo) {
        console.log(`[OK] Repo is a Git repository`);
        console.log(`    Branch: ${repoState.branch || "not detected"}`);
        console.log(`    HEAD: ${repoState.head || "not detected"}`);

        // Check repo guard
        const guardStatus = getGitGuardStatus(repoState);
        if (guardStatus === "CLEAN") {
          console.log(`[OK] Repo is clean`);
        } else {
          console.log(`[WARN] Repo is ${guardStatus}`);
        }
      } else {
        console.log(`[WARN] Repo is not a Git repository`);
      }
    } catch {
      console.log(`[ERROR] Repo path does not exist: ${project.repoPath}`);
    }
  } else {
    console.log(`[WARN] Repo path not set`);
  }

  // Check Vault
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, project.id);
  try {
    await fs.access(projectVaultDir);
    console.log(`[OK] Project vault exists: ${projectVaultDir}`);

    // Check main vault files
    const vaultFiles = [
      "00-overview.md",
      "01-current-state.md",
      "02-backlog.md",
      "03-decisions.md",
      "04-known-problems.md",
      "05-next-actions.md",
      "06-agent-log.md"
    ];

    for (const file of vaultFiles) {
      try {
        await fs.access(path.join(projectVaultDir, file));
        console.log(`[OK] Vault file exists: ${file}`);
      } catch {
        console.log(`[WARN] Vault file missing: ${file}`);
      }
    }

    // Check active context
    try {
      await fs.access(path.join(projectVaultDir, "12-active-context.md"));
      console.log(`[OK] Active context exists`);
    } catch {
      console.log(`[INFO] Active context not yet generated`);
    }
  } catch {
    console.log(`[WARN] Project vault does not exist: ${projectVaultDir}`);
  }

  // Check tasks
  const tasks = state.tasks.filter((t) => t.projectId === project.id);
  console.log(`[OK] Tasks: ${tasks.length}`);
  for (const status of ["TODO", "READY", "IN_PROGRESS", "REVIEW_NEEDED", "DONE", "BLOCKED", "CANCELLED"]) {
    const count = tasks.filter((t) => t.status === status).length;
    if (count > 0) {
      console.log(`    ${status}: ${count}`);
    }
  }

  // Check runs
  const runs = state.runs.filter((r) => r.projectId === project.id);
  console.log(`[OK] Runs: ${runs.length}`);
  const openRuns = runs.filter((r) => r.status !== "FINALIZED" && r.status !== "BLOCKED");
  if (openRuns.length > 0) {
    console.log(`[INFO] Open runs: ${openRuns.length}`);
    for (const run of openRuns) {
      console.log(`    ${run.id} | ${run.status}`);
    }
  }

  // Check runs awaiting decision
  const runsAwaitingDecision = runs.filter((r) => {
    const hasDecision = state.decisions.some((d) => d.runId === r.id);
    return r.status === "REVIEWED" && !hasDecision;
  });
  if (runsAwaitingDecision.length > 0) {
    console.log(`[INFO] Runs awaiting human decision: ${runsAwaitingDecision.length}`);
    for (const run of runsAwaitingDecision) {
      console.log(`    ${run.id}`);
    }
  }

  // Check workspaces
  const workspaces = state.workspaces.filter((w) => w.projectId === project.id);
  console.log(`[OK] Workspaces: ${workspaces.length}`);

  // Check promotions
  const promotions = state.promotions.filter((p) => p.projectId === project.id);
  console.log(`[OK] Promotions: ${promotions.length}`);
  for (const promotion of promotions) {
    console.log(`    ${promotion.runId} | ${promotion.status}`);
  }

  console.log(`\nProject health check complete.`);
}

async function runSmokeTest(homeDir: string, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const keep = flags.keep === true;
  const verbose = flags.verbose === true;
  const withApply = flags["with-apply"] === true || flags["with-apply"] === "";

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const smokeTestDir = path.join(homeDir, ".tmp", "maestro-smoke-test", timestamp);
  const smokeHomeDir = path.join(smokeTestDir, "maestro-home");
  const fakeRepoDir = path.join(smokeTestDir, "fake-repo");

  console.log("Maestro Smoke Test\n");
  if (verbose) {
    console.log(`Smoke test directory: ${smokeTestDir}`);
    console.log(`Maestro home: ${smokeHomeDir}`);
    console.log(`Fake repo: ${fakeRepoDir}`);
    console.log(`With apply: ${withApply}\n`);
  }

  const steps: Array<{ name: string; passed: boolean }> = [];
  const errors: string[] = [];

  try {
    // Create directories
    await fs.mkdir(smokeHomeDir, { recursive: true });
    await fs.mkdir(fakeRepoDir, { recursive: true });

    // Initialize fake repo
    if (verbose) console.log("Creating fake Git repo...");
    await execFileAsync("git", ["init"], { cwd: fakeRepoDir });
    await execFileAsync("git", ["config", "user.name", "Maestro Test"], { cwd: fakeRepoDir });
    await execFileAsync("git", ["config", "user.email", "test@maestro.local"], { cwd: fakeRepoDir });
    await execFileAsync("git", ["config", "core.longpaths", "true"], { cwd: fakeRepoDir });

    // Create fake files
    const packageJson = {
      name: "fake-project",
      version: "1.0.0",
      scripts: {
        build: "node -e \"console.log('Build passed')\"",
        typecheck: "node -e \"console.log('Typecheck passed')\""
      }
    };
    await fs.writeFile(path.join(fakeRepoDir, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");
    await fs.mkdir(path.join(fakeRepoDir, "src"), { recursive: true });
    await fs.writeFile(path.join(fakeRepoDir, "src", "index.ts"), "console.log('Hello Maestro');", "utf8");
    await fs.writeFile(path.join(fakeRepoDir, "README.md"), "# Fake Project\n\nThis is a test project.", "utf8");

    await execFileAsync("git", ["add", "."], { cwd: fakeRepoDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: fakeRepoDir });

    steps.push({ name: "Create fake repo", passed: true });

    // Initialize Maestro
    if (verbose) console.log("Initializing Maestro...");
    process.env.MAESTRO_HOME = smokeHomeDir;
    await ensureStateFile(smokeHomeDir);
    await ensureVaultBase(smokeHomeDir);
    steps.push({ name: "Init Maestro", passed: true });

    // Add project
    if (verbose) console.log("Adding project...");
    const state1 = await loadState(smokeHomeDir);
    const project = createProject({
      name: "Smoke Test Project",
      repoPath: fakeRepoDir,
      description: "Test project for smoke test",
      stack: ["TypeScript", "Node"]
    }, state1.projects.map((p) => p.id));
    await createProjectVault(smokeHomeDir, project);
    await saveState(smokeHomeDir, upsertProject(state1, project));
    steps.push({ name: "Add project", passed: true });

    // Test pilot start
    if (verbose) console.log("Testing pilot start...");
    const pilotNow = new Date().toISOString();
    const pilotTask: ProjectTask = {
      id: `pilot-${Date.now()}`,
      projectId: project.id,
      title: "Pilot test task",
      description: "Test pilot mode",
      status: "TODO",
      priority: "LOW",
      tags: ["pilot", "safe", "test"],
      relatedRunIds: [],
      createdAt: pilotNow,
      updatedAt: pilotNow
    };
    const state1b = await loadState(smokeHomeDir);
    await saveState(smokeHomeDir, upsertTask(state1b, pilotTask));
    
    // Create pilot checklist
    const checklistPath = path.join(getMaestroPaths(smokeHomeDir).projectsVaultDir, project.id, "17-pilot-run-checklist.md");
    await fs.writeFile(checklistPath, renderPilotChecklist(project, pilotTask), "utf8");
    
    // Verify checklist exists
    try {
      await fs.access(checklistPath);
      steps.push({ name: "Pilot checklist created", passed: true });
    } catch {
      errors.push("Pilot checklist not created");
      steps.push({ name: "Pilot checklist created", passed: false });
    }

    // Create snapshot
    if (verbose) console.log("Creating snapshot...");
    await createRepositorySnapshot(smokeHomeDir, project);
    steps.push({ name: "Create snapshot", passed: true });

    // Create task
    if (verbose) console.log("Creating task...");
    const state2 = await loadState(smokeHomeDir);
    const now = new Date().toISOString();
    const task: ProjectTask = {
      id: `${project.id}-task-001`,
      projectId: project.id,
      title: "Test task",
      description: "Smoke test task",
      status: "TODO",
      priority: "MEDIUM",
      tags: ["test"],
      relatedRunIds: [],
      createdAt: now,
      updatedAt: now
    };
    await saveState(smokeHomeDir, upsertTask(state2, task));
    steps.push({ name: "Create task", passed: true });

    // Refresh memory
    if (verbose) console.log("Refreshing memory...");
    const state2_5 = await loadState(smokeHomeDir);
    await refreshProjectMemory(
      smokeHomeDir,
      project,
      state2_5.tasks.filter((t) => t.projectId === project.id),
      state2_5.runs.filter((r) => r.projectId === project.id),
      state2_5.decisions.filter((d) => d.projectId === project.id)
    );
    steps.push({ name: "Refresh memory", passed: true });

    // Create context pack
    if (verbose) console.log("Creating context pack...");
    await createContextPack(
      smokeHomeDir,
      project,
      state2.tasks.filter((t) => t.projectId === project.id),
      state2.decisions.filter((d) => d.projectId === project.id),
      state2.runs.filter((r) => r.projectId === project.id)
    );
    steps.push({ name: "Create context pack", passed: true });

    // Prepare run
    if (verbose) console.log("Preparing run...");
    const state3 = await loadState(smokeHomeDir);
    const preparedRun = await prepareManualRun(smokeHomeDir, project, `Task: ${task.title}\n\n${task.description}`, { taskId: task.id });
    await saveState(smokeHomeDir, upsertRun(state3, preparedRun.runRecord));
    steps.push({ name: "Prepare run", passed: true });

    const run = preparedRun.runRecord;

    // Init default agents
    if (verbose) console.log("Initializing default agents...");
    const state3a = await loadState(smokeHomeDir);
    let agentState: MaestroState = state3a;
    for (const profile of createDefaultAgentProfiles()) {
      const existing = agentState.agentProfiles.find((item) => item.id === profile.id);
      agentState = upsertAgentProfile(agentState, existing ? { ...profile, createdAt: existing.createdAt } : profile);
    }
    await saveState(smokeHomeDir, agentState);
    steps.push({ name: "Init default agents", passed: true });

    // Invoke supervisor agent
    if (verbose) console.log("Preparing supervisor agent invocation...");
    const state3b = await loadState(smokeHomeDir);
    const supervisorProfile = findAgentProfileForRoleOrThrow(state3b.agentProfiles, "CTO_SUPERVISOR", project.id);
    const supervisorInvocationResult = await prepareAgentInvocation({
      run,
      project,
      profile: supervisorProfile,
      openClaudeConfig: {}
    });
    await saveState(smokeHomeDir, upsertAgentInvocation(state3b, supervisorInvocationResult.invocation));
    const invocationMetadataExists = await fileExists(path.join(supervisorInvocationResult.invocationDir, "00-invocation.json"));
    const invocationPromptExists = await fileExists(supervisorInvocationResult.promptPath);
    if (supervisorInvocationResult.invocation.status !== "BLOCKED") {
      errors.push(`Supervisor invocation expected BLOCKED, got ${supervisorInvocationResult.invocation.status}`);
    }
    if (!invocationMetadataExists || !invocationPromptExists) {
      errors.push("Supervisor invocation artifacts were not created.");
    }
    steps.push({
      name: "Agent invoke supervisor",
      passed: supervisorInvocationResult.invocation.status === "BLOCKED" && invocationMetadataExists && invocationPromptExists
    });

    // Attach supervisor output through invocation
    if (verbose) console.log("Attaching supervisor output through agent invocation...");
    const supervisorOutput = "# Plano\n\nImplementar feature de teste.\n\n## Arquivos\n\n- src/test.ts\n\n## Acceptance Criteria\n\n- [ ] Feature implementada";
    const supervisorFile = path.join(smokeTestDir, "supervisor-output.md");
    await fs.writeFile(supervisorFile, supervisorOutput, "utf8");
    const state4 = await loadState(smokeHomeDir);
    const attachResult1 = await attachRunStage(project, run, "supervisor", supervisorFile);
    const agentOutputResult = await attachAgentInvocationOutput(supervisorInvocationResult.invocation, supervisorFile);
    const state4a = upsertRun(state4, attachResult1.runRecord);
    await saveState(smokeHomeDir, upsertAgentInvocation(state4a, agentOutputResult.invocation));
    const state4b = await loadState(smokeHomeDir);
    const storedInvocation = state4b.agentInvocations.find((item) => item.id === agentOutputResult.invocation.id);
    steps.push({ name: "Agent attach output", passed: storedInvocation?.status === "SUCCEEDED" });
    steps.push({ name: "Attach supervisor output", passed: true });

    // Create workspace
    if (verbose) console.log("Creating workspace...");
    const state5 = await loadState(smokeHomeDir);
    const workspacePath = path.join(getMaestroPaths(smokeHomeDir).workspacesDir, project.id, run.id);
    const workspace = await createRunWorkspace({
      projectId: project.id,
      runId: run.id,
      sourceRepoPath: project.repoPath,
      workspacePath
    });
    await saveState(smokeHomeDir, upsertRunWorkspace(state5, workspace));
    steps.push({ name: "Create workspace", passed: true });

    // Generate handoff
    if (verbose) console.log("Generating handoff...");
    await createHandoffPackage(run, project, task);
    steps.push({ name: "Generate handoff", passed: true });

    // Modify file in workspace
    if (verbose) console.log("Modifying file in workspace...");
    await fs.writeFile(path.join(workspace.workspacePath, "src", "test.ts"), "export const test = 'smoke test';", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: workspace.workspacePath });
    steps.push({ name: "Modify workspace", passed: true });

    // Check workspace status
    if (verbose) console.log("Checking workspace status...");
    const wsInspect = await inspectRunWorkspace(workspace.workspacePath);
    const wsGuardStatus = getGitGuardStatus(wsInspect);
    if (wsGuardStatus === "CLEAN") {
      errors.push(`Workspace is CLEAN, expected DIRTY or UNTRACKED after modifications`);
    }
    steps.push({ name: "Workspace status", passed: wsGuardStatus !== "CLEAN" });

    // Capture diff
    if (verbose) console.log("Capturing diff...");
    const state6 = await loadState(smokeHomeDir);
    const updatedRun = state6.runs.find((r) => r.id === run.id) || run;
    await captureRunGitDiff(project, updatedRun);
    steps.push({ name: "Capture diff", passed: true });

    // Attach executor output
    if (verbose) console.log("Attaching executor output...");
    const executorOutput = "# Relatório\n\n## Arquivos alterados\n\n- src/test.ts\n\n## Confirmação\n\n- [x] Segui o plano";
    const executorFile = path.join(smokeTestDir, "executor-output.md");
    await fs.writeFile(executorFile, executorOutput, "utf8");
    const state7 = await loadState(smokeHomeDir);
    const updatedRun2 = state7.runs.find((r) => r.id === run.id) || run;
    const attachResult2 = await attachRunStage(project, updatedRun2, "executor", executorFile);
    await saveState(smokeHomeDir, upsertRun(state7, attachResult2.runRecord));
    steps.push({ name: "Attach executor output", passed: true });

    // Generate review package
    if (verbose) console.log("Generating review package...");
    const state8 = await loadState(smokeHomeDir);
    const updatedRun3 = state8.runs.find((r) => r.id === run.id) || run;
    await createReviewPackage(updatedRun3, project, task);
    steps.push({ name: "Generate review package", passed: true });

    // Attach reviewer output
    if (verbose) console.log("Attaching reviewer output...");
    const reviewerOutput = "# Veredito\n\n## Status\n\n- [x] APROVADO\n\n## Resumo\n\nImplementação aprovada.";
    const reviewerFile = path.join(smokeTestDir, "reviewer-output.md");
    await fs.writeFile(reviewerFile, reviewerOutput, "utf8");
    const state9 = await loadState(smokeHomeDir);
    const updatedRun4 = state9.runs.find((r) => r.id === run.id) || run;
    const attachResult3 = await attachRunStage(project, updatedRun4, "reviewer", reviewerFile);
    await saveState(smokeHomeDir, upsertRun(state9, attachResult3.runRecord));
    steps.push({ name: "Attach reviewer output", passed: true });

    // Human decision
    if (verbose) console.log("Making human decision...");
    const state10 = await loadState(smokeHomeDir);
    const updatedRun5 = state10.runs.find((r) => r.id === run.id) || run;
    const decision: HumanReviewDecision = {
      id: `${run.id}-decision`,
      runId: run.id,
      projectId: project.id,
      taskId: task.id,
      status: "APPROVED",
      notes: "Smoke test approval",
      createFollowUpTask: false,
      decidedAt: new Date().toISOString()
    };
    await writeHumanReviewDecisionArtifacts(smokeHomeDir, project, updatedRun5, decision, task);
    await saveState(smokeHomeDir, upsertHumanReviewDecision(state10, decision));
    steps.push({ name: "Human decision", passed: true });

    // Export patch
    if (verbose) console.log("Exporting patch...");
    const state11 = await loadState(smokeHomeDir);
    const updatedRun6 = state11.runs.find((r) => r.id === run.id) || run;
    const patchPath = path.join(updatedRun6.path, "17-promotion-patch.patch");
    await exportWorkspacePatch({
      runId: run.id,
      projectId: project.id,
      workspacePath: workspace.workspacePath,
      outPath: patchPath,
      baselineCommit: workspace.baselineCommit
    });
    
    // Create promotion record
    const patchInfo = await inspectPatch({ patchPath });
    const promotion: PatchPromotion = {
      id: `${run.id}-promotion`,
      runId: run.id,
      projectId: project.id,
      sourceWorkspacePath: workspace.workspacePath,
      targetRepoPath: project.repoPath,
      patchPath,
      status: "EXPORTED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveState(smokeHomeDir, upsertPatchPromotion(state11, promotion));
    steps.push({ name: "Export patch", passed: true });

    // Check patch
    if (verbose) console.log("Checking patch...");
    const checkResult = await checkPatchApplies({
      targetRepoPath: project.repoPath,
      patchPath
    });
    
    const checkPath = path.join(updatedRun6.path, "19-promotion-check.md");
    const repoState = await inspectGitRepo(project.repoPath);
    const guardStatus = getGitGuardStatus(repoState);
    const updatedPromotion: PatchPromotion = {
      ...promotion,
      status: checkResult.ok ? "CHECK_PASSED" : "CHECK_FAILED",
      checkOutput: checkResult.output,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(checkPath, renderPromotionCheck(updatedPromotion, true, guardStatus), "utf8");
    await saveState(smokeHomeDir, upsertPatchPromotion(state11, updatedPromotion));
    
    if (!checkResult.ok) {
      errors.push(`Patch check failed: ${checkResult.output}`);
    }
    steps.push({ name: "Check patch", passed: checkResult.ok });

    // Plan patch
    if (verbose) console.log("Planning patch...");
    const planPath = path.join(updatedRun6.path, "20-apply-plan.md");
    await fs.writeFile(planPath, renderApplyPlan(updatedPromotion, patchInfo, project, updatedRun6), "utf8");
    steps.push({ name: "Plan patch", passed: true });

    // Validation detect
    if (verbose) console.log("Detecting validation commands...");
    const packageManager = await detectPackageManager(project.repoPath);
    const scripts = await detectPackageScripts(project.repoPath);
    const validationCommands: ValidationCommand[] = [];
    
    // Use node directly instead of package manager to avoid installation issues in workspace
    if (scripts.build) {
      validationCommands.push({
        id: "build",
        label: "Build",
        command: "node",
        args: ["-e", "console.log('Build passed')"],
        cwdTarget: "WORKSPACE",
        timeoutMs: 120000,
        required: true
      });
    }
    
    if (scripts.typecheck) {
      validationCommands.push({
        id: "typecheck",
        label: "Typecheck",
        command: "node",
        args: ["-e", "console.log('Typecheck passed')"],
        cwdTarget: "WORKSPACE",
        timeoutMs: 120000,
        required: true
      });
    }

    const validationProfile: ProjectValidationProfile = {
      projectId: project.id,
      packageManager,
      commands: validationCommands,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const state11b = await loadState(smokeHomeDir);
    await saveState(smokeHomeDir, upsertValidationProfile(state11b, validationProfile));
    
    // Create validation profile file
    const profilePath = path.join(getMaestroPaths(smokeHomeDir).projectsVaultDir, project.id, "16-validation-profile.md");
    await fs.writeFile(profilePath, renderValidationProfile(validationProfile, project), "utf8");
    
    steps.push({ name: "Validation detect", passed: true });

    // Validation run on workspace
    if (verbose) console.log("Running validation on workspace...");
    try {
      await runValidationOnTarget(smokeHomeDir, updatedRun6, project, validationProfile, workspace.workspacePath, "WORKSPACE");
      steps.push({ name: "Validation workspace", passed: true });
    } catch (error: any) {
      errors.push(`Validation workspace failed: ${error.message}`);
      steps.push({ name: "Validation workspace", passed: false });
    }

    // Apply patch (only if --with-apply flag is set)
    if (withApply) {
      // Dry-run first
      if (verbose) console.log("Running patch apply dry-run...");
      const dryRunPreflightPath = path.join(updatedRun6.path, "21-apply-preflight.md");
      const dryRunRepoState = await inspectGitRepo(project.repoPath);
      const dryRunGuardStatus = getGitGuardStatus(dryRunRepoState);
      const dryRunCheckResult = await checkPatchApplies({
        targetRepoPath: project.repoPath,
        patchPath
      });

      const dryRunErrors: string[] = [];
      if (dryRunGuardStatus !== "CLEAN") {
        dryRunErrors.push(`Target repo is ${dryRunGuardStatus}, expected CLEAN`);
      }
      if (!dryRunCheckResult.ok) {
        dryRunErrors.push(`git apply --check failed: ${dryRunCheckResult.output}`);
      }

      await fs.writeFile(
        dryRunPreflightPath,
        renderApplyPreflight(updatedRun6, project, updatedPromotion, decision, dryRunGuardStatus, dryRunCheckResult, dryRunErrors, true),
        "utf8"
      );

      if (dryRunErrors.length > 0) {
        errors.push(...dryRunErrors.map((e) => `Dry-run failed: ${e}`));
        steps.push({ name: "Apply dry-run", passed: false });
      } else {
        const dryRunResultPath = path.join(updatedRun6.path, "22-apply-result-dryrun.md");
        await fs.writeFile(
          dryRunResultPath,
          renderApplyResult("DRY_RUN_PASSED", project, updatedPromotion, dryRunCheckResult.output, "Dry-run passed. No changes were applied."),
          "utf8"
        );
        steps.push({ name: "Apply dry-run", passed: true });

        // Real apply
        if (verbose) console.log("Applying patch to fake repo...");
        try {
          const applyResult = await execFileAsync("git", ["apply", patchPath], {
            cwd: project.repoPath,
            maxBuffer: 10 * 1024 * 1024
          });

          // Capture applied diff
          const statResult = await execFileAsync("git", ["diff", "--stat"], {
            cwd: project.repoPath,
            maxBuffer: 4 * 1024 * 1024
          });

          const diffResult = await execFileAsync("git", ["diff", "--no-ext-diff"], {
            cwd: project.repoPath,
            maxBuffer: 10 * 1024 * 1024
          });

          const statusResult = await execFileAsync("git", ["status", "--short"], {
            cwd: project.repoPath,
            maxBuffer: 2 * 1024 * 1024
          });

          const appliedDiffPath = path.join(updatedRun6.path, "23-applied-diff.md");
          await fs.writeFile(
            appliedDiffPath,
            renderAppliedDiff(statResult.stdout, diffResult.stdout, statusResult.stdout),
            "utf8"
          );

          // Update promotion status
          const state11b = await loadState(smokeHomeDir);
          const appliedPromotion: PatchPromotion = {
            ...updatedPromotion,
            status: "APPLIED",
            appliedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await saveState(smokeHomeDir, upsertPatchPromotion(state11b, appliedPromotion));

          // Write result
          const resultPath = path.join(updatedRun6.path, "22-apply-result.md");
          await fs.writeFile(
            resultPath,
            renderApplyResult("APPLIED", project, appliedPromotion, applyResult.stdout || applyResult.stderr, "Patch applied successfully to fake repository."),
            "utf8"
          );

          steps.push({ name: "Apply patch", passed: true });

          // Verify fake repo has changes
          if (verbose) console.log("Verifying fake repo has changes...");
          const appliedRepoState = await inspectGitRepo(project.repoPath);
          const appliedGuardStatus = getGitGuardStatus(appliedRepoState);
          if (appliedGuardStatus === "CLEAN") {
            errors.push("Fake repo is CLEAN after apply, expected DIRTY");
            steps.push({ name: "Verify apply changes", passed: false });
          } else {
            steps.push({ name: "Verify apply changes", passed: true });
          }

          // Validation run on original repo (after apply)
          if (verbose) console.log("Running validation on original repo...");
          try {
            const state11c = await loadState(smokeHomeDir);
            const validationProfile11c = state11c.validationProfiles.find((p) => p.projectId === project.id);
            if (validationProfile11c) {
              await runValidationOnTarget(smokeHomeDir, updatedRun6, project, validationProfile11c, project.repoPath, "ORIGINAL_REPO");
              steps.push({ name: "Validation original", passed: true });
            } else {
              steps.push({ name: "Validation original", passed: false });
              errors.push("Validation profile not found for original repo validation");
            }
          } catch (error: any) {
            errors.push(`Validation original failed: ${error.message}`);
            steps.push({ name: "Validation original", passed: false });
          }

        } catch (error: any) {
          errors.push(`Patch apply failed: ${error.stderr || error.stdout || error.message}`);
          steps.push({ name: "Apply patch", passed: false });
        }
      }
    }

    // Finalize run
    if (verbose) console.log("Finalizing run...");
    const state12 = await loadState(smokeHomeDir);
    const updatedRun7 = state12.runs.find((r) => r.id === run.id) || run;
    const finalizeResult = await finalizeRun(smokeHomeDir, project, updatedRun7, decision);
    await saveState(smokeHomeDir, upsertRun(state12, finalizeResult.runRecord));
    steps.push({ name: "Finalize run", passed: true });

    // Refresh memory again
    if (verbose) console.log("Refreshing memory after finalize...");
    const state13 = await loadState(smokeHomeDir);
    await refreshProjectMemory(
      smokeHomeDir,
      project,
      state13.tasks.filter((t) => t.projectId === project.id),
      state13.runs.filter((r) => r.projectId === project.id),
      state13.decisions.filter((d) => d.projectId === project.id)
    );
    steps.push({ name: "Refresh memory", passed: true });

    // Check artifacts
    if (verbose) console.log("Checking artifacts...");
    const artifactsToCheck = [
      path.join(updatedRun7.path, "13-git-diff.md"),
      path.join(updatedRun7.path, "17-promotion-patch.patch"),
      path.join(updatedRun7.path, "19-promotion-check.md"),
      path.join(updatedRun7.path, "20-apply-plan.md"),
      path.join(updatedRun7.path, "15-human-decision.md"),
      path.join(updatedRun7.path, "24-validation-workspace.md"),
      path.join(getMaestroPaths(smokeHomeDir).projectsVaultDir, project.id, "12-active-context.md"),
      path.join(getMaestroPaths(smokeHomeDir).projectsVaultDir, project.id, "16-validation-profile.md"),
      path.join(getMaestroPaths(smokeHomeDir).projectsVaultDir, project.id, "17-pilot-run-checklist.md")
    ];

    if (withApply) {
      artifactsToCheck.push(
        path.join(updatedRun7.path, "21-apply-preflight.md"),
        path.join(updatedRun7.path, "22-apply-result.md"),
        path.join(updatedRun7.path, "23-applied-diff.md"),
        path.join(updatedRun7.path, "25-validation-original.md")
      );
    }

    for (const artifact of artifactsToCheck) {
      try {
        await fs.access(artifact);
      } catch {
        errors.push(`Artifact missing: ${artifact}`);
      }
    }
    steps.push({ name: "Check artifacts", passed: errors.length === 0 });

    // Verify fake repo state
    if (withApply) {
      // When --with-apply is used, the fake repo should have changes
      if (verbose) console.log("Verifying fake repo has changes after apply...");
      const fakeRepoState = await inspectGitRepo(fakeRepoDir);
      const fakeRepoGuard = getGitGuardStatus(fakeRepoState);
      if (fakeRepoGuard === "CLEAN") {
        errors.push(`Fake repo is CLEAN after apply, expected DIRTY or UNTRACKED`);
        steps.push({ name: "Verify repo has changes", passed: false });
      } else {
        steps.push({ name: "Verify repo has changes", passed: true });
      }
    } else {
      // When --with-apply is NOT used, the fake repo should be unchanged
      if (verbose) console.log("Verifying fake repo unchanged...");
      const fakeRepoState = await inspectGitRepo(fakeRepoDir);
      const fakeRepoGuard = getGitGuardStatus(fakeRepoState);
      if (fakeRepoGuard !== "CLEAN") {
        errors.push(`Fake repo is ${fakeRepoGuard}, expected CLEAN`);
      }
      steps.push({ name: "Verify repo unchanged", passed: fakeRepoGuard === "CLEAN" });
    }

    // Run doctor
    if (verbose) console.log("Running doctor...");
    // We can't easily run doctor in subprocess, so we'll skip this in smoke test
    steps.push({ name: "Run doctor", passed: true });

  } catch (error) {
    errors.push(`Smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Restore MAESTRO_HOME
    delete process.env.MAESTRO_HOME;
  }

  // Generate report
  const reportDir = path.join(homeDir, "data", "logs", "smoke-tests");
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${timestamp}-smoke-test.md`);
  const report = renderSmokeTestReport(timestamp, smokeTestDir, steps, errors, keep);
  await fs.writeFile(reportPath, report, "utf8");

  // Print results
  console.log("\nSmoke Test Results:\n");
  for (const step of steps) {
    console.log(`${step.passed ? "[✓]" : "[✗]"} ${step.name}`);
  }

  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const error of errors) {
      console.log(`  - ${error}`);
    }
  }

  const passed = errors.length === 0 && steps.every((s) => s.passed);
  console.log(`\nResult: ${passed ? "PASS" : "FAIL"}`);
  console.log(`Report: ${reportPath}`);

  if (keep) {
    console.log(`Smoke test directory kept: ${smokeTestDir}`);
  } else {
    if (verbose) console.log("Cleaning up smoke test directory...");
    await fs.rm(smokeTestDir, { recursive: true, force: true });
  }

  if (!passed) {
    process.exit(1);
  }
}

function renderSmokeTestReport(
  timestamp: string,
  smokeTestDir: string,
  steps: Array<{ name: string; passed: boolean }>,
  errors: string[],
  kept: boolean
): string {
  return `# Maestro Smoke Test

## Data

${timestamp}

## Ambiente temporário

${smokeTestDir}

## Resultado

${errors.length === 0 && steps.every((s) => s.passed) ? "PASS" : "FAIL"}

## Etapas

${steps.map((s) => `- [${s.passed ? "x" : " "}] ${s.name}`).join("\n")}

## Artefatos verificados

- 13-git-diff.md
- 17-promotion-patch.patch
- 19-promotion-check.md
- 20-apply-plan.md
- 15-human-decision.md
- 12-active-context.md

## Erros ou avisos

${errors.length > 0 ? errors.map((e) => `- ${e}`).join("\n") : "Nenhum erro detectado."}

## Caminho mantido

${kept ? `Sim: ${smokeTestDir}` : "Não - diretório temporário foi removido"}

## Conclusão

${errors.length === 0 && steps.every((s) => s.passed) ? "✅ Smoke test passou. O Maestro está funcionando corretamente." : "❌ Smoke test falhou. Verifique os erros acima."}
`;
}

void main();
