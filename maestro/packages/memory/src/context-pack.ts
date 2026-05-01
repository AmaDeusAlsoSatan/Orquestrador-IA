import { promises as fs } from "node:fs";
import path from "node:path";
import { getMaestroPaths, type HumanReviewDecision, type Project, type ProjectTask } from "@maestro/core";
import { readActiveContextForContextPack } from "./active-context";
import { renderTaskBoardForContextPack } from "./task-board";

export const CONTEXT_PACK_FILE_NAME = "11-context-pack.md";

const CONTEXT_PACK_INPUT_FILES = [
  "00-overview.md",
  "01-current-state.md",
  "02-backlog.md",
  "03-decisions.md",
  "04-known-problems.md",
  "05-next-actions.md",
  "07-imported-context.md",
  "08-repo-snapshot.md",
  "09-dev-scripts.md",
  "10-technical-map.md"
];

export async function createContextPack(
  homeDir: string,
  project: Project,
  tasks: ProjectTask[] = [],
  decisions: HumanReviewDecision[] = []
): Promise<{ contextPackPath: string; includedFiles: string[] }> {
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, project.id);
  const contextPackPath = path.join(projectVaultDir, CONTEXT_PACK_FILE_NAME);
  const sections: string[] = [
    `# Context Pack`,
    ``,
    `- Project: ${project.name} (${project.id})`,
    `- Generated at: ${new Date().toISOString()}`,
    `- Purpose: input material for future Codex Supervisor planning.`,
    ``
  ];
  const includedFiles: string[] = [];

  await fs.mkdir(projectVaultDir, { recursive: true });

  sections.push(`# Active Context Atual`, "", await readActiveContextForContextPack(homeDir, project), "");
  sections.push(renderTaskBoardForContextPack(tasks, decisions).trimEnd(), "");
  sections.push(renderHumanDecisionsForContextPack(decisions).trimEnd(), "");

  for (const fileName of CONTEXT_PACK_INPUT_FILES) {
    const filePath = path.join(projectVaultDir, fileName);
    const content = await fs.readFile(filePath, "utf8").catch(() => undefined);

    sections.push(`## ${fileName}`, ``);

    if (content === undefined) {
      sections.push(`Arquivo nao encontrado.`, ``);
    } else {
      sections.push(content.trimEnd(), ``);
      includedFiles.push(fileName);
    }
  }

  await fs.writeFile(contextPackPath, `${sections.join("\n").trimEnd()}\n`, "utf8");

  return {
    contextPackPath,
    includedFiles
  };
}

function renderHumanDecisionsForContextPack(decisions: HumanReviewDecision[]): string {
  const recentDecisions = [...decisions]
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))
    .slice(0, 10);

  const sections = ["# Decisoes Humanas Recentes", ""];

  if (recentDecisions.length === 0) {
    sections.push("- No human decisions recorded.", "");
    return sections.join("\n");
  }

  for (const decision of recentDecisions) {
    sections.push(
      `- ${decision.decidedAt} | run: ${decision.runId} | task: ${decision.taskId || "none"} | status: ${
        decision.status
      } | notes: ${truncate(decision.notes || "Not provided", 180)} | follow-up: ${decision.followUpTaskId || "none"}`
    );
  }

  sections.push("");
  return sections.join("\n");
}

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

export async function readContextPack(homeDir: string, project: Project): Promise<{ path: string; content: string }> {
  const paths = getMaestroPaths(homeDir);
  const contextPackPath = path.join(paths.projectsVaultDir, project.id, CONTEXT_PACK_FILE_NAME);
  const content = await fs.readFile(contextPackPath, "utf8").catch(() => undefined);

  if (content === undefined) {
    throw new Error(
      `Context pack not found. Run "corepack pnpm run maestro context pack --project ${project.id}" first.`
    );
  }

  return {
    path: contextPackPath,
    content
  };
}
