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

export const TASK_BOARD_START = "<!-- MAESTRO:TASKS:START -->";
export const TASK_BOARD_END = "<!-- MAESTRO:TASKS:END -->";

const TASK_STATUS_ORDER: TaskStatus[] = ["TODO", "READY", "IN_PROGRESS", "REVIEW_NEEDED", "BLOCKED", "DONE", "CANCELLED"];
const TASK_PRIORITY_WEIGHT = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
};

export async function appendTaskAddedToBacklog(
  homeDir: string,
  project: Project,
  task: ProjectTask
): Promise<string> {
  const backlogPath = getProjectVaultFilePath(homeDir, project.id, "02-backlog.md");
  await appendToFile(
    backlogPath,
    `
## Task added - ${new Date().toISOString()}

- Task: ${task.id}
- Title: ${task.title}
- Status: ${task.status}
- Priority: ${task.priority}
- Tags: ${formatTags(task.tags)}
`
  );
  return backlogPath;
}

export async function appendTaskBlockedToKnownProblems(
  homeDir: string,
  project: Project,
  task: ProjectTask
): Promise<string> {
  const knownProblemsPath = getProjectVaultFilePath(homeDir, project.id, "04-known-problems.md");
  await appendToFile(
    knownProblemsPath,
    `
## Task blocked - ${new Date().toISOString()}

- Task: ${task.id}
- Title: ${task.title}
- Reason: ${task.blockedReason || "Not provided"}
`
  );
  return knownProblemsPath;
}

export async function appendTaskCompletedToAgentLog(
  homeDir: string,
  project: Project,
  task: ProjectTask
): Promise<string> {
  const agentLogPath = getProjectVaultFilePath(homeDir, project.id, "06-agent-log.md");
  await appendToFile(
    agentLogPath,
    `
## Task completed - ${new Date().toISOString()}

- Task: ${task.id}
- Title: ${task.title}
- Status: ${task.status}
- Completed at: ${task.completedAt || "Not recorded"}
- Related runs: ${formatRuns(task.relatedRunIds)}
`
  );
  return agentLogPath;
}

export async function appendTaskReviewNeededToNextActions(
  homeDir: string,
  project: Project,
  task: ProjectTask,
  run: RunRecord
): Promise<string> {
  const nextActionsPath = getProjectVaultFilePath(homeDir, project.id, "05-next-actions.md");
  await appendToFile(
    nextActionsPath,
    `
## Task requires human decision - ${new Date().toISOString()}

- Task: ${task.id}
- Title: ${task.title}
- Run: ${run.id}
- Status: ${task.status}
- Suggested decision: complete task, create correction run, block task, or cancel task.
`
  );
  return nextActionsPath;
}

export async function syncTaskBoardToVault(
  homeDir: string,
  project: Project,
  tasks: ProjectTask[],
  decisions: HumanReviewDecision[] = []
): Promise<string> {
  const backlogPath = getProjectVaultFilePath(homeDir, project.id, "02-backlog.md");
  const existingContent = await fs.readFile(backlogPath, "utf8").catch(() => "# Backlog\n");
  const taskBoard = renderManagedTaskBoard(tasks, decisions);
  const nextContent = replaceManagedSection(existingContent, taskBoard);

  await fs.mkdir(path.dirname(backlogPath), { recursive: true });
  await fs.writeFile(backlogPath, ensureTrailingNewline(nextContent), "utf8");
  return backlogPath;
}

export function renderTaskBoardForContextPack(tasks: ProjectTask[], decisions: HumanReviewDecision[] = []): string {
  return `# Task Board Atual

${renderTaskGroups(tasks, 2, decisions)}
`;
}

export function sortTasksForBoard(tasks: ProjectTask[]): ProjectTask[] {
  return [...tasks].sort((left, right) => {
    const priorityDiff = TASK_PRIORITY_WEIGHT[left.priority] - TASK_PRIORITY_WEIGHT[right.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function renderManagedTaskBoard(tasks: ProjectTask[], decisions: HumanReviewDecision[]): string {
  return `${TASK_BOARD_START}
## Task Board

${renderTaskGroups(tasks, 3, decisions)}
${TASK_BOARD_END}`;
}

function renderTaskGroups(tasks: ProjectTask[], headingLevel: number, decisions: HumanReviewDecision[] = []): string {
  const heading = "#".repeat(headingLevel);
  const sections: string[] = [];

  for (const status of TASK_STATUS_ORDER) {
    const statusTasks = sortTasksForBoard(tasks.filter((task) => task.status === status));
    sections.push(`${heading} ${status}`, "");

    if (statusTasks.length === 0) {
      sections.push("- No tasks.", "");
      continue;
    }

    for (const task of statusTasks) {
      const lastDecision = getLastDecisionForTask(task, decisions);
      sections.push(
        `- ${task.id} | ${task.priority} | ${task.title} | tags: ${formatTags(task.tags)} | runs: ${formatRuns(
          task.relatedRunIds
        )} | last human decision: ${formatLastDecision(lastDecision)}`
      );
    }

    sections.push("");
  }

  return sections.join("\n").trimEnd();
}

function getLastDecisionForTask(
  task: ProjectTask,
  decisions: HumanReviewDecision[]
): HumanReviewDecision | undefined {
  return decisions
    .filter((decision) => decision.taskId === task.id || task.relatedRunIds.includes(decision.runId))
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0];
}

function formatLastDecision(decision: HumanReviewDecision | undefined): string {
  return decision ? `${decision.status} (${decision.decidedAt})` : "none";
}

function replaceManagedSection(existingContent: string, managedSection: string): string {
  const startIndex = existingContent.indexOf(TASK_BOARD_START);
  const endIndex = existingContent.indexOf(TASK_BOARD_END);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex).trimEnd();
    const after = existingContent.slice(endIndex + TASK_BOARD_END.length).trimStart();
    return [before, managedSection, after].filter(Boolean).join("\n\n");
  }

  return `${existingContent.trimEnd()}\n\n${managedSection}`;
}

function getProjectVaultFilePath(homeDir: string, projectId: string, fileName: string): string {
  const paths = getMaestroPaths(homeDir);
  return path.join(paths.projectsVaultDir, projectId, fileName);
}

async function appendToFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, ensureTrailingNewline(content), "utf8");
}

function formatTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(", ") : "none";
}

function formatRuns(runIds: string[]): string {
  return runIds.length > 0 ? runIds.join(", ") : "none";
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
