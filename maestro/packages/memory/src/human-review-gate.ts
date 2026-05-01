import { promises as fs } from "node:fs";
import path from "node:path";
import { getMaestroPaths, type HumanReviewDecision, type Project, type ProjectTask, type RunRecord } from "@maestro/core";

export interface HumanReviewDecisionArtifacts {
  decisionPath: string;
  decisionsPath: string;
  agentLogPath: string;
  nextActionsPath: string;
  knownProblemsPath?: string;
}

export async function writeHumanReviewDecisionArtifacts(
  homeDir: string,
  project: Project,
  run: RunRecord,
  decision: HumanReviewDecision,
  task?: ProjectTask,
  followUpTask?: ProjectTask
): Promise<HumanReviewDecisionArtifacts> {
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, project.id);
  const decisionPath = path.join(run.path, "15-human-decision.md");
  const decisionsPath = path.join(projectVaultDir, "03-decisions.md");
  const agentLogPath = path.join(projectVaultDir, "06-agent-log.md");
  const nextActionsPath = path.join(projectVaultDir, "05-next-actions.md");
  const knownProblemsPath = decision.status === "APPROVED" ? undefined : path.join(projectVaultDir, "04-known-problems.md");

  await fs.mkdir(run.path, { recursive: true });
  await fs.mkdir(projectVaultDir, { recursive: true });
  await fs.writeFile(decisionPath, renderHumanDecisionFile(project, run, decision, task, followUpTask), "utf8");
  await fs.appendFile(decisionsPath, renderDecisionLogAppend(project, run, decision, task, followUpTask), "utf8");
  await fs.appendFile(agentLogPath, renderAgentLogAppend(run, decision, task, followUpTask), "utf8");
  await fs.appendFile(nextActionsPath, renderNextActionsAppend(run, decision, task, followUpTask), "utf8");

  if (knownProblemsPath) {
    await fs.appendFile(knownProblemsPath, renderKnownProblemsAppend(run, decision, task, followUpTask), "utf8");
  }

  return {
    decisionPath,
    decisionsPath,
    agentLogPath,
    nextActionsPath,
    knownProblemsPath
  };
}

export function renderHumanDecisionSummary(decision: HumanReviewDecision | undefined): string {
  if (!decision) {
    return `## Decisao Humana

- Status: nao registrada
- Notas: nao registradas
- Follow-up task: none
`;
  }

  return `## Decisao Humana

- Status: ${decision.status}
- Notas: ${decision.notes || "Not provided"}
- Follow-up task: ${decision.followUpTaskId || "none"}
- Decidido em: ${decision.decidedAt}
`;
}

function renderHumanDecisionFile(
  project: Project,
  run: RunRecord,
  decision: HumanReviewDecision,
  task: ProjectTask | undefined,
  followUpTask: ProjectTask | undefined
): string {
  return `# Decisao Humana da Run

## Status

${decision.status}

## Notas

${decision.notes || "Not provided"}

## Projeto

- Project: ${project.name} (${project.id})
- Repo: ${project.repoPath || "Not set"}

## Task vinculada

${task ? `- Task: ${task.id}\n- Titulo: ${task.title}\n- Status atual: ${task.status}` : "- none"}

## Follow-up task criada

${followUpTask ? `- Task: ${followUpTask.id}\n- Titulo: ${followUpTask.title}\n- Status: ${followUpTask.status}` : "- none"}

## Data da decisao

${decision.decidedAt}

## Proximos passos

${renderDecisionNextSteps(run, decision, followUpTask)}
`;
}

function renderDecisionLogAppend(
  project: Project,
  run: RunRecord,
  decision: HumanReviewDecision,
  task: ProjectTask | undefined,
  followUpTask: ProjectTask | undefined
): string {
  return `
## Human decision - ${decision.decidedAt}

- Project: ${project.name} (${project.id})
- Run: ${run.id}
- Task: ${task?.id || "none"}
- Status: ${decision.status}
- Notes: ${decision.notes || "Not provided"}
- Follow-up task: ${followUpTask?.id || decision.followUpTaskId || "none"}
`;
}

function renderAgentLogAppend(
  run: RunRecord,
  decision: HumanReviewDecision,
  task: ProjectTask | undefined,
  followUpTask: ProjectTask | undefined
): string {
  return `
## Human review gate - ${decision.decidedAt}

- Run: ${run.id}
- Objective: ${run.goal}
- Decision: ${decision.status}
- Task: ${task?.id || "none"}
- Follow-up task: ${followUpTask?.id || decision.followUpTaskId || "none"}
- Notes: ${decision.notes || "Not provided"}
`;
}

function renderNextActionsAppend(
  run: RunRecord,
  decision: HumanReviewDecision,
  task: ProjectTask | undefined,
  followUpTask: ProjectTask | undefined
): string {
  return `
## Human decision next actions - ${decision.decidedAt}

- Run: ${run.id}
- Task: ${task?.id || "none"}
- Decision: ${decision.status}
- Follow-up task: ${followUpTask?.id || decision.followUpTaskId || "none"}
- Next: ${renderCompactNextAction(decision, followUpTask)}
`;
}

function renderKnownProblemsAppend(
  run: RunRecord,
  decision: HumanReviewDecision,
  task: ProjectTask | undefined,
  followUpTask: ProjectTask | undefined
): string {
  return `
## Human decision requires attention - ${decision.decidedAt}

- Run: ${run.id}
- Task: ${task?.id || "none"}
- Decision: ${decision.status}
- Notes: ${decision.notes || "Not provided"}
- Follow-up task: ${followUpTask?.id || decision.followUpTaskId || "none"}
`;
}

function renderDecisionNextSteps(
  run: RunRecord,
  decision: HumanReviewDecision,
  followUpTask: ProjectTask | undefined
): string {
  switch (decision.status) {
    case "APPROVED":
      return "- A execucao foi aceita.\n- Se houver task vinculada, ela pode permanecer como DONE.\n- Nao exige nova run.";
    case "NEEDS_CHANGES":
      return followUpTask
        ? `- Preparar uma nova run para a follow-up task ${followUpTask.id}.\n- Usar a run ${run.id} como referencia de contexto.`
        : `- Criar ou selecionar uma task de correcao.\n- Preparar nova run se necessario.`;
    case "REJECTED":
      return followUpTask
        ? `- Refazer a execucao usando a follow-up task ${followUpTask.id}.\n- Nao considerar esta run como conclusao da task.`
        : "- Refazer o trabalho a partir de uma nova run.\n- Nao considerar esta run como conclusao da task.";
    case "BLOCKED":
      return "- Resolver o bloqueio registrado nas notas.\n- Retomar a task apenas depois da decisao externa ou tecnica necessaria.";
  }

  throw new Error(`Unsupported human decision status: ${decision.status}`);
}

function renderCompactNextAction(decision: HumanReviewDecision, followUpTask: ProjectTask | undefined): string {
  switch (decision.status) {
    case "APPROVED":
      return "Task accepted; no correction run required.";
    case "NEEDS_CHANGES":
      return followUpTask ? `Prepare correction run for ${followUpTask.id}.` : "Create or prepare correction work.";
    case "REJECTED":
      return followUpTask ? `Redo work through ${followUpTask.id}.` : "Redo the work; this run was not accepted.";
    case "BLOCKED":
      return "Resolve the blocker before continuing.";
  }

  throw new Error(`Unsupported human decision status: ${decision.status}`);
}
