import { promises as fs } from "node:fs";
import path from "node:path";
import { getMaestroPaths, slugify, type Project, type RunRecord, type RunStatus } from "@maestro/core";
import { getGitGuardStatus, inspectGitRepo, type GitRepoState } from "@maestro/runner";
import { readContextPack } from "./context-pack";

export interface PreparedRun {
  runRecord: RunRecord;
  runDir: string;
  files: string[];
  contextPackPath: string;
  gitBaseline: {
    branch: string | null;
    head: string | null;
    isDirty: boolean;
    capturedAt: string;
  };
}

export interface RunMetadata {
  id: string;
  projectId: string;
  taskId?: string;
  goal: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  projectRepoPath: string;
  contextPackPath: string;
  gitBaseline?: {
    branch: string | null;
    head: string | null;
    isDirty: boolean;
    capturedAt: string;
  };
}

export async function prepareManualRun(
  homeDir: string,
  project: Project,
  goal: string,
  options: { taskId?: string } = {}
): Promise<PreparedRun> {
  const trimmedGoal = goal.trim();

  if (!trimmedGoal) {
    throw new Error("Run goal is required.");
  }

  const contextPack = await readContextPack(homeDir, project);
  const gitBaselineState = await inspectGitRepo(project.repoPath);
  const gitGuardStatus = getGitGuardStatus(gitBaselineState);
  const gitBaseline = {
    branch: gitBaselineState.branch,
    head: gitBaselineState.head,
    isDirty: gitGuardStatus === "DIRTY" || gitGuardStatus === "UNTRACKED",
    capturedAt: gitBaselineState.capturedAt
  };
  const paths = getMaestroPaths(homeDir);
  const { runDir, runId } = await createUniqueRunDir(paths.runsDir, project.id, trimmedGoal);
  const now = new Date().toISOString();
  const runRecord: RunRecord = {
    id: runId,
    projectId: project.id,
    taskId: options.taskId,
    goal: trimmedGoal,
    status: "PREPARED",
    path: runDir,
    createdAt: now,
    updatedAt: now
  };
  const metadata: RunMetadata = {
    ...runRecord,
    projectRepoPath: project.repoPath,
    contextPackPath: contextPack.path,
    gitBaseline
  };
  const files = [
    "00-run-metadata.json",
    "01-goal.md",
    "02-context-pack.md",
    "03-codex-supervisor-prompt.md",
    "04-kiro-executor-prompt.md",
    "05-codex-reviewer-prompt.md",
    "06-run-log.md",
    "11-git-baseline.md"
  ];

  await fs.mkdir(runDir, { recursive: true });
  await writeRunMetadata(runDir, metadata);
  await fs.writeFile(path.join(runDir, "01-goal.md"), renderGoal(project, trimmedGoal), "utf8");
  await fs.writeFile(path.join(runDir, "02-context-pack.md"), contextPack.content, "utf8");
  await fs.writeFile(
    path.join(runDir, "03-codex-supervisor-prompt.md"),
    renderCodexSupervisorPrompt(project, trimmedGoal),
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "04-kiro-executor-prompt.md"), renderKiroExecutorPrompt(project), "utf8");
  await fs.writeFile(path.join(runDir, "05-codex-reviewer-prompt.md"), renderCodexReviewerPrompt(project), "utf8");
  await fs.writeFile(path.join(runDir, "06-run-log.md"), renderRunLog(trimmedGoal), "utf8");
  await fs.writeFile(path.join(runDir, "11-git-baseline.md"), renderGitBaseline(gitBaselineState), "utf8");

  return {
    runRecord,
    runDir,
    files,
    contextPackPath: contextPack.path,
    gitBaseline
  };
}

export async function writeRunMetadata(runDir: string, metadata: RunMetadata): Promise<void> {
  await fs.writeFile(path.join(runDir, "00-run-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export async function readRunMetadata(runDir: string): Promise<RunMetadata> {
  const raw = await fs.readFile(path.join(runDir, "00-run-metadata.json"), "utf8");
  return JSON.parse(raw) as RunMetadata;
}

async function createUniqueRunDir(
  runsDir: string,
  projectId: string,
  goal: string
): Promise<{ runDir: string; runId: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const goalSlug = slugify(goal).slice(0, 48) || "run";
  const projectRunsDir = path.join(runsDir, projectId);
  let runId = `${timestamp}-${goalSlug}`;
  let candidate = path.join(projectRunsDir, runId);
  let index = 2;

  while (await pathExists(candidate)) {
    runId = `${timestamp}-${goalSlug}-${index}`;
    candidate = path.join(projectRunsDir, runId);
    index += 1;
  }

  return {
    runDir: candidate,
    runId
  };
}

function renderGoal(project: Project, goal: string): string {
  return `# Goal

- Project: ${project.name} (${project.id})
- Created at: ${new Date().toISOString()}

## Original Task

${goal}
`;
}

function renderCodexSupervisorPrompt(project: Project, goal: string): string {
  return `# Codex Supervisor Prompt

You are the technical supervisor for ${project.name}.

Read the context pack and the task. Do not implement code. Produce a technical plan for the executor.

## Task

${goal}

## Instructions

- Understand the project context before planning.
- Do not modify files.
- Generate a technical plan.
- List files that likely need to be changed.
- List risks and open questions.
- Define acceptance criteria.
- Generate objective instructions for the Kiro executor.
- Keep the executor constrained to the approved plan.

## Expected Output

- Technical plan.
- Files to inspect or edit.
- Risks.
- Acceptance criteria.
- Kiro execution instructions.
`;
}

export function renderKiroExecutorPrompt(project: Project, supervisorPlan?: string): string {
  const plan = supervisorPlan?.trim() || "[COLE AQUI O PLANO APROVADO PELO CODEX SUPERVISOR]";

  return `# Kiro Executor Prompt

You are the executor for ${project.name}.

Follow the Codex supervisor plan strictly. Do not make large architectural decisions on your own. If the work requires changing architecture, data contracts, product scope, or project conventions, stop and ask for review.

Before changing many files, explain your execution plan.

## Approved Codex Supervisor Plan

${plan}

## Execution Rules

- Stay inside the approved plan.
- Keep changes scoped.
- Preserve existing project conventions.
- Do not add unrelated refactors.
- Do not automate accounts, provider rotation, or provider limit bypassing.

## Final Report

When finished, report:

- Files changed.
- Summary of changes.
- Tests or checks run.
- Pending work.
- Questions.
- Risks.
`;
}

export function renderCodexReviewerPrompt(
  project: Project,
  goal?: string,
  supervisorPlan?: string,
  executorReport?: string,
  gitEvidence?: { changedFiles?: string; diff?: string }
): string {
  const gitEvidenceSection =
    gitEvidence && (gitEvidence.changedFiles || gitEvidence.diff)
      ? `## Real Git Evidence

### Changed Files

${gitEvidence.changedFiles?.trim() || "_Not captured._"}

### Real Diff

${gitEvidence.diff?.trim() || "_Not captured._"}
`
      : `## Real Git Evidence

_Not captured yet. If the executor changed the repository, run \`maestro run capture-diff --run <run-id>\` before final review._
`;
  const reviewInputs =
    goal || supervisorPlan || executorReport
      ? `## Original Goal

${goal?.trim() || "_Pending._"}

## Supervisor Plan

${supervisorPlan?.trim() || "_Pending._"}

## Executor Report

${executorReport?.trim() || "_Pending._"}

${gitEvidenceSection}
`
      : `## Inputs To Review

- Original goal.
- Context pack.
- Codex supervisor plan.
- Kiro executor report.
- Diff or changed files.

${gitEvidenceSection}
`;

  return `# Codex Reviewer Prompt

You are the technical reviewer for ${project.name}.

Compare the executor result with the original plan.

## Review Instructions

- Verify whether the executor followed the approved plan.
- Check for bugs, regressions, and inconsistencies.
- Check for unnecessary complexity.
- Check whether tests or checks are sufficient.
- Approve or reject the implementation.
- If rejected, provide objective corrections.
- If approved, produce a short summary to update the Vault.

${reviewInputs}

## Required Review Focus

- Compare the executor result with the original plan.
- Verify whether the executor followed the instructions.
- Do not review only the executor report. Review the real diff and verify that it matches the approved plan.
- Point out bugs, regressions, and inconsistencies.
- Approve or reject the implementation.
`;
}

function renderGitBaseline(state: GitRepoState): string {
  return `# Git Baseline

## Snapshot

- Captured at: ${state.capturedAt}
- Repository path: ${state.repoPath}
- Is Git repo: ${state.isGitRepo ? "yes" : "no"}
- Branch: ${state.branch || "not detected"}
- HEAD: ${state.head || "not detected"}

## Status Short

${asCodeBlock(state.statusShort || "clean")}

## Diff Stat

${asCodeBlock(state.diffStat || "clean")}

## Last Commits

${asCodeBlock(state.lastCommits || "not detected")}
`;
}

function renderRunLog(goal: string): string {
  return `# Run Log

## Objetivo

${goal}

## Status

prepared

## Supervisor Output

_Pending._

## Executor Output

_Pending._

## Reviewer Output

_Pending._

## Decisoes

_Pending._

## Pendencias

_Pending._

## Conclusao

_Pending._
`;
}

function asCodeBlock(value: string): string {
  return `\`\`\`text
${value}
\`\`\``;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
