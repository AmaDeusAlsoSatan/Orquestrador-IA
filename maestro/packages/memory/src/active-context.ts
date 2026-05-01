import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getMaestroPaths,
  type HumanReviewDecision,
  type Project,
  type ProjectTask,
  type RunRecord,
  type TaskStatus
} from "@maestro/core";

export const ACTIVE_CONTEXT_FILE_NAME = "12-active-context.md";
export const PROJECT_CHECKPOINT_FILE_NAME = "13-project-checkpoint.md";
export const OPEN_QUESTIONS_FILE_NAME = "14-open-questions.md";
export const RISK_REGISTER_FILE_NAME = "15-risk-register.md";

export const ACTIVE_CONTEXT_START = "<!-- MAESTRO:ACTIVE_CONTEXT:START -->";
export const ACTIVE_CONTEXT_END = "<!-- MAESTRO:ACTIVE_CONTEXT:END -->";
export const OPEN_QUESTIONS_START = "<!-- MAESTRO:OPEN_QUESTIONS:START -->";
export const OPEN_QUESTIONS_END = "<!-- MAESTRO:OPEN_QUESTIONS:END -->";
export const RISK_REGISTER_START = "<!-- MAESTRO:RISK_REGISTER:START -->";
export const RISK_REGISTER_END = "<!-- MAESTRO:RISK_REGISTER:END -->";

export interface MemoryRefreshResult {
  activeContextPath: string;
  openQuestionsPath: string;
  riskRegisterPath: string;
}

export interface MemoryCheckpointResult {
  checkpointPath: string;
}

export interface MemoryBrief {
  projectLine: string;
  currentGoal: string;
  highPriorityTasks: string[];
  blockers: string[];
  runsAwaitingDecision: string[];
  nextStep: string;
}

export interface MemoryConsolidationStatus {
  activeContextExists: boolean;
  checkpointExists: boolean;
  openQuestionsCount: number;
  activeRiskCount: number;
}

const TASK_STATUS_ORDER: TaskStatus[] = ["TODO", "READY", "IN_PROGRESS", "REVIEW_NEEDED", "BLOCKED", "DONE", "CANCELLED"];
const PRIORITY_WEIGHT = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
};

export async function refreshProjectMemory(
  homeDir: string,
  project: Project,
  tasks: ProjectTask[],
  runs: RunRecord[],
  decisions: HumanReviewDecision[]
): Promise<MemoryRefreshResult> {
  const paths = getProjectMemoryPaths(homeDir, project.id);
  const vault = await readVaultInputs(paths.projectVaultDir);
  const analysis = await buildMemoryAnalysis(project, tasks, runs, decisions, vault);

  await fs.mkdir(paths.projectVaultDir, { recursive: true });
  await writeManagedFile(
    paths.activeContextPath,
    "# Active Context",
    ACTIVE_CONTEXT_START,
    ACTIVE_CONTEXT_END,
    renderActiveContext(project, analysis)
  );
  await writeManagedFile(
    paths.openQuestionsPath,
    "# Open Questions",
    OPEN_QUESTIONS_START,
    OPEN_QUESTIONS_END,
    renderOpenQuestions(analysis)
  );
  await writeManagedFile(
    paths.riskRegisterPath,
    "# Risk Register",
    RISK_REGISTER_START,
    RISK_REGISTER_END,
    renderRiskRegister(analysis)
  );

  return {
    activeContextPath: paths.activeContextPath,
    openQuestionsPath: paths.openQuestionsPath,
    riskRegisterPath: paths.riskRegisterPath
  };
}

export async function checkpointProjectMemory(
  homeDir: string,
  project: Project,
  tasks: ProjectTask[],
  runs: RunRecord[],
  decisions: HumanReviewDecision[],
  notes: string
): Promise<MemoryCheckpointResult> {
  const paths = getProjectMemoryPaths(homeDir, project.id);
  const vault = await readVaultInputs(paths.projectVaultDir);
  const analysis = await buildMemoryAnalysis(project, tasks, runs, decisions, vault);
  const existingContent = await fs.readFile(paths.checkpointPath, "utf8").catch(() => "# Project Checkpoint\n");
  const nextContent = `${existingContent.trimEnd()}\n\n${renderCheckpoint(project, notes, analysis)}\n`;

  await fs.mkdir(paths.projectVaultDir, { recursive: true });
  await fs.writeFile(paths.checkpointPath, nextContent, "utf8");

  return {
    checkpointPath: paths.checkpointPath
  };
}

export async function readProjectMemoryBrief(
  homeDir: string,
  project: Project,
  tasks: ProjectTask[],
  runs: RunRecord[],
  decisions: HumanReviewDecision[]
): Promise<MemoryBrief> {
  const vault = await readVaultInputs(getProjectMemoryPaths(homeDir, project.id).projectVaultDir);
  const analysis = await buildMemoryAnalysis(project, tasks, runs, decisions, vault);

  return {
    projectLine: `${project.name} (${project.id})`,
    currentGoal: analysis.currentGoal,
    highPriorityTasks: analysis.highPriorityOpenTasks.map(formatTaskLine),
    blockers: analysis.blockers.map(formatTaskLine),
    runsAwaitingDecision: analysis.runsAwaitingDecision.map(formatRunLine),
    nextStep: analysis.nextStep
  };
}

export async function getProjectMemoryConsolidationStatus(
  homeDir: string,
  project: Project
): Promise<MemoryConsolidationStatus> {
  const paths = getProjectMemoryPaths(homeDir, project.id);
  const [activeContext, checkpoint, openQuestions, riskRegister] = await Promise.all([
    statFile(paths.activeContextPath),
    statFile(paths.checkpointPath),
    fs.readFile(paths.openQuestionsPath, "utf8").catch(() => ""),
    fs.readFile(paths.riskRegisterPath, "utf8").catch(() => "")
  ]);

  return {
    activeContextExists: Boolean(activeContext?.isFile()),
    checkpointExists: Boolean(checkpoint?.isFile()),
    openQuestionsCount: countManagedListItems(openQuestions, OPEN_QUESTIONS_START, OPEN_QUESTIONS_END),
    activeRiskCount: countSectionListItems(riskRegister, "## Riscos ativos")
  };
}

export async function activeContextExists(homeDir: string, project: Project): Promise<boolean> {
  const stats = await statFile(getProjectMemoryPaths(homeDir, project.id).activeContextPath);
  return Boolean(stats?.isFile());
}

export async function readActiveContextForContextPack(homeDir: string, project: Project): Promise<string> {
  const paths = getProjectMemoryPaths(homeDir, project.id);
  const content = await fs.readFile(paths.activeContextPath, "utf8").catch(() => undefined);

  if (content === undefined) {
    return `[Active Context ainda nao gerado. Rode maestro memory refresh --project ${project.id}.]`;
  }

  return content.trimEnd();
}

function getProjectMemoryPaths(homeDir: string, projectId: string) {
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, projectId);

  return {
    projectVaultDir,
    activeContextPath: path.join(projectVaultDir, ACTIVE_CONTEXT_FILE_NAME),
    checkpointPath: path.join(projectVaultDir, PROJECT_CHECKPOINT_FILE_NAME),
    openQuestionsPath: path.join(projectVaultDir, OPEN_QUESTIONS_FILE_NAME),
    riskRegisterPath: path.join(projectVaultDir, RISK_REGISTER_FILE_NAME)
  };
}

interface VaultInputs {
  decisionsText: string;
  knownProblemsText: string;
  nextActionsText: string;
  agentLogText: string;
  technicalMapText: string;
}

interface MemoryAnalysis {
  currentGoal: string;
  stateSentence: string;
  openPriorities: ProjectTask[];
  highPriorityOpenTasks: ProjectTask[];
  inProgressTasks: ProjectTask[];
  reviewNeededTasks: ProjectTask[];
  blockers: ProjectTask[];
  recentDecisions: HumanReviewDecision[];
  recentRuns: RunRecord[];
  runsAwaitingDecision: RunRecord[];
  nextStep: string;
  filesToRead: string[];
  technicalQuestions: string[];
  productQuestions: string[];
  architectureQuestions: string[];
  humanDecisionQuestions: string[];
  activeRisks: string[];
  mitigatedRisks: string[];
  risksToReview: string[];
  taskCounts: Record<TaskStatus, number>;
  vaultNextActions: string[];
}

async function buildMemoryAnalysis(
  project: Project,
  tasks: ProjectTask[],
  runs: RunRecord[],
  decisions: HumanReviewDecision[],
  vault: VaultInputs
): Promise<MemoryAnalysis> {
  const openPriorities = sortTasks(
    tasks.filter((task) => ["TODO", "READY", "IN_PROGRESS", "REVIEW_NEEDED"].includes(task.status))
  );
  const highPriorityOpenTasks = openPriorities.filter((task) => task.priority === "HIGH" || task.priority === "URGENT");
  const inProgressTasks = sortTasks(tasks.filter((task) => task.status === "IN_PROGRESS"));
  const reviewNeededTasks = sortTasks(tasks.filter((task) => task.status === "REVIEW_NEEDED"));
  const blockers = sortTasks(tasks.filter((task) => task.status === "BLOCKED"));
  const recentDecisions = [...decisions].sort((left, right) => right.decidedAt.localeCompare(left.decidedAt)).slice(0, 8);
  const recentRuns = [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8);
  const runsAwaitingDecision = [];

  for (const run of runs) {
    if (!decisions.some((decision) => decision.runId === run.id) && (await runHasFile(run, "09-reviewer-output.md"))) {
      runsAwaitingDecision.push(run);
    }
  }

  const taskCounts = countTasksByStatus(tasks);
  const vaultNextActions = getRecentActionLines(vault.nextActionsText, 8);
  const negativeDecisions = recentDecisions.filter((decision) =>
    decision.status === "NEEDS_CHANGES" || decision.status === "REJECTED" || decision.status === "BLOCKED"
  );

  return {
    currentGoal: getCurrentGoal(project, openPriorities, vaultNextActions),
    stateSentence: `${project.name} tem ${openPriorities.length} tasks abertas, ${inProgressTasks.length} em andamento, ${reviewNeededTasks.length} aguardando revisao e ${blockers.length} bloqueadas.`,
    openPriorities,
    highPriorityOpenTasks,
    inProgressTasks,
    reviewNeededTasks,
    blockers,
    recentDecisions,
    recentRuns,
    runsAwaitingDecision,
    nextStep: getRecommendedNextStep(blockers, runsAwaitingDecision, reviewNeededTasks, openPriorities, vaultNextActions, project.id),
    filesToRead: getFilesToRead(vault.technicalMapText),
    technicalQuestions: [
      ...negativeDecisions.map((decision) => `Revisar impacto tecnico da decisao ${decision.status} na run ${decision.runId}: ${truncate(decision.notes, 140)}`),
      ...blockers.map((task) => `Resolver bloqueio tecnico da task ${task.id}: ${task.blockedReason || task.title}`)
    ],
    productQuestions: [],
    architectureQuestions: negativeDecisions
      .filter((decision) => decision.notes.toLowerCase().includes("arquitet") || decision.notes.toLowerCase().includes("architecture"))
      .map((decision) => `Confirmar decisao arquitetural pendente da run ${decision.runId}: ${truncate(decision.notes, 140)}`),
    humanDecisionQuestions: [
      ...runsAwaitingDecision.map((run) => `Decidir aceite humano da run ${run.id}: ${truncate(run.goal, 140)}`),
      ...reviewNeededTasks.map((task) => `Decidir se a task ${task.id} pode ser concluida, corrigida, bloqueada ou cancelada.`)
    ],
    activeRisks: [
      ...blockers.map((task) => `Task bloqueada ${task.id}: ${task.blockedReason || task.title}`),
      ...negativeDecisions.map((decision) => `Decisao ${decision.status} na run ${decision.runId}: ${truncate(decision.notes, 160)}`),
      ...runsAwaitingDecision.map((run) => `Run ${run.id} tem revisao anexada mas ainda nao tem decisao humana.`)
    ],
    mitigatedRisks: recentDecisions
      .filter((decision) => decision.status === "APPROVED")
      .map((decision) => `Run ${decision.runId} aprovada em ${decision.decidedAt}.`),
    risksToReview: [
      ...reviewNeededTasks.map((task) => `Task ${task.id} aguarda revisao humana.`),
      ...getRecentActionLines(vault.knownProblemsText, 5).map((line) => `Known problem recente: ${line}`)
    ],
    taskCounts,
    vaultNextActions
  };
}

async function readVaultInputs(projectVaultDir: string): Promise<VaultInputs> {
  const [decisionsText, knownProblemsText, nextActionsText, agentLogText, technicalMapText] = await Promise.all([
    readText(path.join(projectVaultDir, "03-decisions.md")),
    readText(path.join(projectVaultDir, "04-known-problems.md")),
    readText(path.join(projectVaultDir, "05-next-actions.md")),
    readText(path.join(projectVaultDir, "06-agent-log.md")),
    readText(path.join(projectVaultDir, "10-technical-map.md"))
  ]);

  return {
    decisionsText,
    knownProblemsText,
    nextActionsText,
    agentLogText,
    technicalMapText
  };
}

function renderActiveContext(project: Project, analysis: MemoryAnalysis): string {
  return `${ACTIVE_CONTEXT_START}
## Projeto

- Nome: ${project.name}
- Id: ${project.id}
- Repo: ${project.repoPath || "Not set"}
- Status: ${project.status}
- Prioridade: ${project.priority}
- Stack: ${project.stack.length > 0 ? project.stack.join(", ") : "Not set"}

## Estado atual em uma frase

${analysis.stateSentence}

## Objetivo atual

${analysis.currentGoal}

## Prioridades abertas

${formatTaskList(analysis.openPriorities)}

## Tasks em andamento

${formatTaskList(analysis.inProgressTasks)}

## Tasks aguardando revisao

${formatTaskList(analysis.reviewNeededTasks)}

## Bloqueios

${formatTaskList(analysis.blockers)}

## Decisoes recentes

${formatDecisionList(analysis.recentDecisions)}

## Ultimas runs importantes

${formatRunList(analysis.recentRuns)}

## Proximo passo recomendado

${analysis.nextStep}

## Arquivos/contextos que um agente deveria ler primeiro

${formatStringList(analysis.filesToRead)}
${ACTIVE_CONTEXT_END}`;
}

function renderOpenQuestions(analysis: MemoryAnalysis): string {
  return `${OPEN_QUESTIONS_START}
## Perguntas tecnicas

${formatStringList(analysis.technicalQuestions)}

## Perguntas de produto

${formatStringList(analysis.productQuestions)}

## Perguntas de arquitetura

${formatStringList(analysis.architectureQuestions)}

## Perguntas para decisao humana

${formatStringList(analysis.humanDecisionQuestions)}
${OPEN_QUESTIONS_END}`;
}

function renderRiskRegister(analysis: MemoryAnalysis): string {
  return `${RISK_REGISTER_START}
## Riscos ativos

${formatStringList(analysis.activeRisks)}

## Riscos mitigados

${formatStringList(analysis.mitigatedRisks)}

## Riscos a revisar

${formatStringList(analysis.risksToReview)}
${RISK_REGISTER_END}`;
}

function renderCheckpoint(project: Project, notes: string, analysis: MemoryAnalysis): string {
  return `## Checkpoint - ${new Date().toISOString()}

### Notas humanas

${notes || "Not provided."}

### Estado geral

- Projeto: ${project.name} (${project.id})
- ${analysis.stateSentence}
- Proximo passo recomendado: ${analysis.nextStep}

### Tasks por status

${TASK_STATUS_ORDER.map((status) => `- ${status}: ${analysis.taskCounts[status]}`).join("\n")}

### Runs recentes

${formatRunList(analysis.recentRuns)}

### Decisoes recentes

${formatDecisionList(analysis.recentDecisions)}

### Riscos ativos

${formatStringList(analysis.activeRisks)}

### Proximos passos

${formatStringList([analysis.nextStep, ...analysis.vaultNextActions].filter(Boolean).slice(0, 8))}
`;
}

async function writeManagedFile(
  filePath: string,
  defaultTitle: string,
  startMarker: string,
  endMarker: string,
  managedContent: string
): Promise<void> {
  const existingContent = await fs.readFile(filePath, "utf8").catch(() => `${defaultTitle}\n`);
  const nextContent = replaceManagedSection(existingContent, managedContent, startMarker, endMarker);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, ensureTrailingNewline(nextContent), "utf8");
}

function replaceManagedSection(existingContent: string, managedContent: string, startMarker: string, endMarker: string): string {
  const startIndex = existingContent.indexOf(startMarker);
  const endIndex = existingContent.indexOf(endMarker);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex).trimEnd();
    const after = existingContent.slice(endIndex + endMarker.length).trimStart();
    return [before, managedContent, after].filter(Boolean).join("\n\n");
  }

  return `${existingContent.trimEnd()}\n\n${managedContent}`;
}

function getCurrentGoal(project: Project, openPriorities: ProjectTask[], vaultNextActions: string[]): string {
  const task = openPriorities.find((item) => item.status === "IN_PROGRESS") || openPriorities[0];

  if (task) {
    return `${task.title} (${task.id})`;
  }

  return vaultNextActions[0] || project.description || "Nenhum objetivo operacional detectado.";
}

function getRecommendedNextStep(
  blockers: ProjectTask[],
  runsAwaitingDecision: RunRecord[],
  reviewNeededTasks: ProjectTask[],
  openPriorities: ProjectTask[],
  vaultNextActions: string[],
  projectId: string
): string {
  if (runsAwaitingDecision.length > 0) {
    return `Registrar decisao humana para a run ${runsAwaitingDecision[0].id}.`;
  }

  if (reviewNeededTasks.length > 0) {
    return `Decidir o destino da task ${reviewNeededTasks[0].id}.`;
  }

  if (blockers.length > 0) {
    return `Resolver bloqueio da task ${blockers[0].id}.`;
  }

  const nextTask = openPriorities.find((task) => task.status === "READY" || task.status === "TODO");
  if (nextTask) {
    return `Preparar uma run para ${nextTask.id}: maestro run prepare --project ${projectId} --task ${nextTask.id}`;
  }

  return vaultNextActions[0] || "Criar ou priorizar a proxima task do projeto.";
}

function getFilesToRead(technicalMapText: string): string[] {
  const detected = technicalMapText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/u.test(line) && /\.[a-z0-9]+/iu.test(line))
    .map((line) => line.replace(/^[-*]\s+/u, ""))
    .slice(0, 8);

  return [
    "12-active-context.md",
    "11-context-pack.md",
    "10-technical-map.md",
    "08-repo-snapshot.md",
    "05-next-actions.md",
    "04-known-problems.md",
    ...detected
  ].filter((value, index, array) => array.indexOf(value) === index);
}

function countTasksByStatus(tasks: ProjectTask[]): Record<TaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUS_ORDER.map((status) => [status, 0])) as Record<TaskStatus, number>;

  for (const task of tasks) {
    counts[task.status] += 1;
  }

  return counts;
}

function sortTasks(tasks: ProjectTask[]): ProjectTask[] {
  return [...tasks].sort((left, right) => {
    const priorityDiff = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
    if (priorityDiff !== 0) return priorityDiff;
    const statusDiff = TASK_STATUS_ORDER.indexOf(left.status) - TASK_STATUS_ORDER.indexOf(right.status);
    if (statusDiff !== 0) return statusDiff;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function getRecentActionLines(content: string, maxItems: number): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !line.includes("[ ]"))
    .slice(-maxItems)
    .map((line) => line.replace(/^-\s*/u, ""));
}

function formatTaskList(tasks: ProjectTask[]): string {
  return tasks.length > 0 ? tasks.map((task) => `- ${formatTaskLine(task)}`).join("\n") : "- none";
}

function formatTaskLine(task: ProjectTask): string {
  return `${task.id} | ${task.status} | ${task.priority} | ${task.title}`;
}

function formatRunList(runs: RunRecord[]): string {
  return runs.length > 0 ? runs.map((run) => `- ${formatRunLine(run)}`).join("\n") : "- none";
}

function formatRunLine(run: RunRecord): string {
  return `${run.id} | ${run.status} | task: ${run.taskId || "none"} | ${truncate(run.goal, 120)}`;
}

function formatDecisionList(decisions: HumanReviewDecision[]): string {
  return decisions.length > 0
    ? decisions
        .map(
          (decision) =>
            `- ${decision.decidedAt} | ${decision.status} | run: ${decision.runId} | task: ${
              decision.taskId || "none"
            } | ${truncate(decision.notes || "Not provided", 140)}`
        )
        .join("\n")
    : "- none";
}

function formatStringList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function countManagedListItems(content: string, startMarker: string, endMarker: string): number {
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  const body = startIndex >= 0 && endIndex > startIndex ? content.slice(startIndex, endIndex) : content;
  return body.split(/\r?\n/u).filter((line) => line.trim().startsWith("- ") && line.trim() !== "- none").length;
}

function countSectionListItems(content: string, sectionTitle: string): number {
  const lines = content.split(/\r?\n/u);
  const startIndex = lines.findIndex((line) => line.trim() === sectionTitle);

  if (startIndex === -1) {
    return 0;
  }

  let count = 0;
  for (const line of lines.slice(startIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    if (line.trim().startsWith("- ") && line.trim() !== "- none") {
      count += 1;
    }
  }

  return count;
}

async function runHasFile(run: RunRecord, fileName: string): Promise<boolean> {
  const stats = await statFile(path.join(run.path, fileName));
  return Boolean(stats?.isFile());
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8").catch(() => "");
}

async function statFile(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
