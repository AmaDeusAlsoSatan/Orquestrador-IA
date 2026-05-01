import { promises as fs } from "node:fs";
import path from "node:path";
import { getMaestroPaths, type HumanReviewDecision, type Project, type RunRecord, type RunStatus } from "@maestro/core";
import { getGitDiff, inspectGitRepo, type GitRepoState } from "@maestro/runner";
import { renderHumanDecisionSummary } from "./human-review-gate";
import {
  readRunMetadata,
  renderCodexReviewerPrompt,
  renderKiroExecutorPrompt,
  writeRunMetadata,
  type RunMetadata
} from "./run-prepare";

export type RunStage = "supervisor" | "executor" | "reviewer";

export interface RunFileStatus {
  fileName: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
}

export interface AttachRunStageResult {
  runRecord: RunRecord;
  outputPath: string;
}

export interface FinalizeRunResult {
  runRecord: RunRecord;
  finalSummaryPath: string;
  agentLogPath: string;
  nextActionsPath: string;
  missingGitDiff: boolean;
  missingHumanDecision: boolean;
}

export interface CaptureRunGitDiffResult {
  afterPath: string;
  diffPath: string;
  changedFilesPath: string;
  diffTruncated: boolean;
  source: CaptureDiffSource;
}

export type CaptureDiffSource = "ORIGINAL_REPO" | "WORKSPACE_SANDBOX";

const MAX_CAPTURED_DIFF_BYTES = 500 * 1024;

const RUN_FILES = [
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
  "16-workspace.md"
];

const STAGE_OUTPUT_FILES: Record<RunStage, string> = {
  supervisor: "07-supervisor-output.md",
  executor: "08-executor-output.md",
  reviewer: "09-reviewer-output.md"
};

export async function getRunFileStatuses(run: RunRecord): Promise<RunFileStatus[]> {
  const statuses: RunFileStatus[] = [];

  for (const fileName of RUN_FILES) {
    const filePath = path.join(run.path, fileName);
    const stats = await fs.stat(filePath).catch(() => undefined);

    statuses.push({
      fileName,
      path: filePath,
      exists: Boolean(stats?.isFile()),
      sizeBytes: stats?.isFile() ? stats.size : 0
    });
  }

  return statuses;
}

export async function attachRunStage(
  project: Project,
  run: RunRecord,
  stage: RunStage,
  sourceFilePath: string
): Promise<AttachRunStageResult> {
  const resolvedSourceFilePath = path.resolve(sourceFilePath);
  const content = await fs.readFile(resolvedSourceFilePath, "utf8");
  const outputPath = path.join(run.path, STAGE_OUTPUT_FILES[stage]);
  const supervisorPlan =
    stage === "executor" || stage === "reviewer" ? await readRequiredRunFile(run, "07-supervisor-output.md") : "";
  if (stage === "reviewer") {
    await readRequiredRunFile(run, "08-executor-output.md");
  }

  await fs.mkdir(run.path, { recursive: true });
  await fs.writeFile(outputPath, ensureTrailingNewline(content), "utf8");

  let nextStatus: RunStatus;

  if (stage === "supervisor") {
    nextStatus = "SUPERVISOR_PLANNED";
    await fs.writeFile(path.join(run.path, "04-kiro-executor-prompt.md"), renderKiroExecutorPrompt(project, content), "utf8");
  } else if (stage === "executor") {
    nextStatus = "EXECUTOR_REPORTED";
    const gitEvidence = await readGitEvidence(run);
    await fs.writeFile(
      path.join(run.path, "05-codex-reviewer-prompt.md"),
      renderCodexReviewerPrompt(project, run.goal, supervisorPlan, content, gitEvidence),
      "utf8"
    );
  } else {
    nextStatus = "REVIEWED";
  }

  const nextRun = await updateRunRecordAndMetadata(project, run, nextStatus);
  await appendRunLog(run, `Attached ${stage} output`, [
    `Source: ${resolvedSourceFilePath}`,
    `Output: ${outputPath}`,
    `Status: ${nextStatus}`
  ]);

  return {
    runRecord: nextRun,
    outputPath
  };
}

export async function captureRunGitDiff(
  project: Project,
  run: RunRecord,
  options: { repoPath?: string; source?: CaptureDiffSource } = {}
): Promise<CaptureRunGitDiffResult> {
  const source = options.source || "ORIGINAL_REPO";
  const repoPath = options.repoPath || project.repoPath;
  const state = await inspectGitRepo(repoPath);
  const rawDiff = await getGitDiff(repoPath);
  const { content: diffContent, truncated } = truncateDiff(rawDiff);
  const afterPath = path.join(run.path, "12-git-after-executor.md");
  const diffPath = path.join(run.path, "13-git-diff.md");
  const changedFilesPath = path.join(run.path, "14-changed-files.md");

  await fs.mkdir(run.path, { recursive: true });
  await fs.writeFile(afterPath, renderGitState("Git After Executor", state, source), "utf8");
  await fs.writeFile(diffPath, renderGitDiff(diffContent, truncated, source), "utf8");
  await fs.writeFile(changedFilesPath, renderChangedFiles(state, source), "utf8");
  await appendRunLog(run, "Captured git diff", [
    `Source: ${source}`,
    `Repository path: ${repoPath}`,
    `After state: ${afterPath}`,
    `Diff: ${diffPath}`,
    `Changed files: ${changedFilesPath}`,
    `Diff truncated: ${truncated ? "yes" : "no"}`
  ]);

  const executorReport = await readOptionalRunFile(run, "08-executor-output.md");
  const supervisorPlan = await readOptionalRunFile(run, "07-supervisor-output.md");

  if (executorReport && supervisorPlan) {
    await fs.writeFile(
      path.join(run.path, "05-codex-reviewer-prompt.md"),
      renderCodexReviewerPrompt(project, run.goal, supervisorPlan, executorReport, {
        changedFiles: await fs.readFile(changedFilesPath, "utf8"),
        diff: await fs.readFile(diffPath, "utf8")
      }),
      "utf8"
    );
  }

  return {
    afterPath,
    diffPath,
    changedFilesPath,
    diffTruncated: truncated,
    source
  };
}

export async function blockRun(project: Project, run: RunRecord, reason: string): Promise<RunRecord> {
  const trimmedReason = reason.trim();

  if (!trimmedReason) {
    throw new Error("Block reason is required.");
  }

  const nextRun = await updateRunRecordAndMetadata(project, run, "BLOCKED");
  await appendRunLog(run, "Run blocked", [`Reason: ${trimmedReason}`, `Status: BLOCKED`]);
  return nextRun;
}

export async function finalizeRun(
  homeDir: string,
  project: Project,
  run: RunRecord,
  humanDecision?: HumanReviewDecision
): Promise<FinalizeRunResult> {
  const supervisorPlan = await readRequiredRunFile(run, "07-supervisor-output.md");
  const executorReport = await readRequiredRunFile(run, "08-executor-output.md");
  const reviewerOutput = await readRequiredRunFile(run, "09-reviewer-output.md");
  const finalSummaryPath = path.join(run.path, "10-final-summary.md");
  const finalizedAt = new Date().toISOString();
  const nextRun = await updateRunRecordAndMetadata(project, run, "FINALIZED", finalizedAt);
  const gitEvidence = {
    baselineCaptured: await runFileExists(run, "11-git-baseline.md"),
    diffCaptured: await runFileExists(run, "13-git-diff.md"),
    changedFilesCaptured: await runFileExists(run, "14-changed-files.md")
  };
  const hasHumanDecisionFile = await runFileExists(run, "15-human-decision.md");
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, project.id);
  const agentLogPath = path.join(projectVaultDir, "06-agent-log.md");
  const nextActionsPath = path.join(projectVaultDir, "05-next-actions.md");

  await fs.writeFile(
    finalSummaryPath,
    renderFinalSummary(nextRun, supervisorPlan, executorReport, reviewerOutput, gitEvidence, humanDecision, hasHumanDecisionFile),
    "utf8"
  );
  await appendRunLog(nextRun, "Run finalized", [`Final summary: ${finalSummaryPath}`, `Status: FINALIZED`]);

  await fs.mkdir(projectVaultDir, { recursive: true });
  await fs.appendFile(agentLogPath, renderAgentLogAppend(nextRun), "utf8");
  await fs.appendFile(nextActionsPath, renderNextActionsAppend(nextRun), "utf8");

  return {
    runRecord: nextRun,
    finalSummaryPath,
    agentLogPath,
    nextActionsPath,
    missingGitDiff: !gitEvidence.diffCaptured,
    missingHumanDecision: !humanDecision && !hasHumanDecisionFile
  };
}

export function getNextRunStep(run: RunRecord): string {
  switch (run.status) {
    case "PREPARED":
      return `Attach supervisor output: maestro run attach --run ${run.id} --stage supervisor --file <codex-plan.md>`;
    case "SUPERVISOR_PLANNED":
    case "EXECUTOR_READY":
      return `Use the updated Kiro prompt, then attach executor output: maestro run attach --run ${run.id} --stage executor --file <kiro-report.md>`;
    case "EXECUTOR_REPORTED":
    case "REVIEW_READY":
      return `Use the updated reviewer prompt, then attach reviewer output: maestro run attach --run ${run.id} --stage reviewer --file <codex-review.md>`;
    case "REVIEWED":
      return `Register human decision: maestro run decide --run ${run.id} --status APPROVED --notes "A execucao foi aceita."`;
    case "FINALIZED":
      return "Run finalized. Review the Vault updates and continue with the next task.";
    case "BLOCKED":
      return "Run blocked. Resolve the blocker or prepare a new run.";
  }
}

async function updateRunRecordAndMetadata(
  project: Project,
  run: RunRecord,
  status: RunStatus,
  finalizedAt?: string
): Promise<RunRecord> {
  const updatedAt = new Date().toISOString();
  const nextRun: RunRecord = {
    ...run,
    status,
    updatedAt,
    finalizedAt: finalizedAt || run.finalizedAt
  };
  const existingMetadata = await readRunMetadata(run.path).catch(() => undefined);
  const metadata: RunMetadata = {
    id: nextRun.id,
    projectId: nextRun.projectId,
    taskId: nextRun.taskId,
    goal: nextRun.goal,
    status: nextRun.status,
    createdAt: nextRun.createdAt,
    updatedAt: nextRun.updatedAt,
    finalizedAt: nextRun.finalizedAt,
    projectRepoPath: existingMetadata?.projectRepoPath || project.repoPath,
    contextPackPath: existingMetadata?.contextPackPath || "",
    gitBaseline: existingMetadata?.gitBaseline
  };

  await writeRunMetadata(run.path, metadata);
  return nextRun;
}

async function appendRunLog(run: RunRecord, title: string, lines: string[]): Promise<void> {
  const logPath = path.join(run.path, "06-run-log.md");
  const body = [
    "",
    `## ${title}`,
    "",
    `- At: ${new Date().toISOString()}`,
    `- Run: ${run.id}`,
    ...lines.map((line) => `- ${line}`),
    ""
  ].join("\n");

  await fs.appendFile(logPath, body, "utf8");
}

async function readRequiredRunFile(run: RunRecord, fileName: string): Promise<string> {
  const filePath = path.join(run.path, fileName);
  const content = await fs.readFile(filePath, "utf8").catch(() => undefined);

  if (content === undefined) {
    throw new Error(`Required run file is missing: ${filePath}`);
  }

  return content;
}

function renderFinalSummary(
  run: RunRecord,
  supervisorPlan: string,
  executorReport: string,
  reviewerOutput: string,
  gitEvidence: { baselineCaptured: boolean; diffCaptured: boolean; changedFilesCaptured: boolean },
  humanDecision: HumanReviewDecision | undefined,
  hasHumanDecisionFile: boolean
): string {
  const humanDecisionSection =
    humanDecision || hasHumanDecisionFile
      ? renderHumanDecisionSummary(humanDecision).trimEnd()
      : `## Decisao Humana

- Status: nao registrada
- Notas: nao registradas
- Follow-up task: none`;

  return `# Final Summary

## Objective

${run.goal}

## Final Status

${run.status}

## Supervisor Plan

${supervisorPlan.trim()}

## Executor Report

${executorReport.trim()}

## Reviewer Output

${reviewerOutput.trim()}

## Evidencia Git

- Baseline capturado: ${gitEvidence.baselineCaptured ? "sim" : "nao"}
- Diff capturado: ${gitEvidence.diffCaptured ? "sim" : "nao"}
- Arquivos alterados capturados: ${gitEvidence.changedFilesCaptured ? "sim" : "nao"}

${humanDecisionSection}

## Pendencias

Verificar pendencias e riscos relatados pelo executor e pelo reviewer acima.

## Proximos Passos

Atualizar manualmente backlog, problemas conhecidos ou decisoes adicionais se a revisao exigir.
`;
}

function renderGitState(title: string, state: GitRepoState, source: CaptureDiffSource): string {
  return `# ${title}

## Snapshot

- Diff source: ${source}
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

function renderGitDiff(diff: string, truncated: boolean, source: CaptureDiffSource): string {
  return `# Git Diff

Diff source: ${source}

${truncated ? "[DIFF TRUNCADO: excedeu o limite configurado]\n\n" : ""}${asCodeBlock(diff || "clean")}
`;
}

function renderChangedFiles(state: GitRepoState, source: CaptureDiffSource): string {
  const changed = categorizeStatusShort(state.statusShort);

  return `# Changed Files

Diff source: ${source}

## Modified

${asList(changed.modified)}

## Added

${asList(changed.added)}

## Deleted

${asList(changed.deleted)}

## Untracked

${asList(state.untrackedFiles)}

## Diff Stat

${asCodeBlock(state.diffStat || "clean")}
`;
}

function categorizeStatusShort(statusShort: string): { modified: string[]; added: string[]; deleted: string[] } {
  const changed = {
    modified: [] as string[],
    added: [] as string[],
    deleted: [] as string[]
  };

  for (const line of statusShort.split(/\r?\n/u).filter((item) => item.trim().length > 0)) {
    if (line.startsWith("??")) {
      continue;
    }

    const code = line.slice(0, 2);
    const rawFileName = line.slice(3).trim();
    const parts = rawFileName.split(" -> ");
    const fileName = parts[parts.length - 1] || rawFileName;

    if (code.includes("D")) {
      changed.deleted.push(fileName);
    } else if (code.includes("A")) {
      changed.added.push(fileName);
    } else {
      changed.modified.push(fileName);
    }
  }

  return changed;
}

async function readGitEvidence(run: RunRecord): Promise<{ changedFiles?: string; diff?: string } | undefined> {
  const [changedFiles, diff] = await Promise.all([
    readOptionalRunFile(run, "14-changed-files.md"),
    readOptionalRunFile(run, "13-git-diff.md")
  ]);

  if (!changedFiles && !diff) {
    return undefined;
  }

  return {
    changedFiles,
    diff
  };
}

async function readOptionalRunFile(run: RunRecord, fileName: string): Promise<string | undefined> {
  return fs.readFile(path.join(run.path, fileName), "utf8").catch(() => undefined);
}

async function runFileExists(run: RunRecord, fileName: string): Promise<boolean> {
  const stats = await fs.stat(path.join(run.path, fileName)).catch(() => undefined);
  return Boolean(stats?.isFile());
}

function truncateDiff(diff: string): { content: string; truncated: boolean } {
  const bytes = Buffer.byteLength(diff, "utf8");

  if (bytes <= MAX_CAPTURED_DIFF_BYTES) {
    return { content: diff, truncated: false };
  }

  return {
    content: Buffer.from(diff, "utf8").subarray(0, MAX_CAPTURED_DIFF_BYTES).toString("utf8"),
    truncated: true
  };
}

function asList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function asCodeBlock(value: string): string {
  return `\`\`\`text
${value}
\`\`\``;
}

function renderAgentLogAppend(run: RunRecord): string {
  return `
## Run finalized - ${new Date().toISOString()}

- Run: ${run.id}
- Objetivo: ${run.goal}
- Status: ${run.status}
- Pasta da run: ${run.path}
`;
}

function renderNextActionsAppend(run: RunRecord): string {
  return `
## Última run finalizada

- Run: ${run.id}
- Objetivo: ${run.goal}
- Status: ${run.status}
- Próxima revisão sugerida: revisar \`10-final-summary.md\` e decidir a próxima tarefa.
`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
