import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunRecord, RunTimelineEvent, RunTimelineEventType } from "@maestro/core";

interface ArtifactMapping {
  fileName: string;
  eventType: RunTimelineEventType;
  title: string;
  description: string;
  status?: "OK" | "WARN" | "ERROR" | "INFO";
}

const ARTIFACT_MAPPINGS: ArtifactMapping[] = [
  {
    fileName: "00-run-metadata.json",
    eventType: "RUN_CREATED",
    title: "Run criada",
    description: "Run preparada e registrada no sistema",
    status: "INFO"
  },
  {
    fileName: "07-supervisor-output.md",
    eventType: "SUPERVISOR_ATTACHED",
    title: "Plano do Supervisor anexado",
    description: "Codex Supervisor gerou o plano técnico",
    status: "OK"
  },
  {
    fileName: "16-workspace.md",
    eventType: "WORKSPACE_CREATED",
    title: "Workspace criado",
    description: "Sandbox isolado criado para execução segura",
    status: "OK"
  },
  {
    fileName: "handoff/07-kiro-prompt.md",
    eventType: "HANDOFF_CREATED",
    title: "Handoff gerado",
    description: "Pacote de handoff criado para o Executor",
    status: "OK"
  },
  {
    fileName: "08-executor-output.md",
    eventType: "EXECUTOR_ATTACHED",
    title: "Relatório do Executor anexado",
    description: "Kiro Executor completou a execução e reportou resultados",
    status: "OK"
  },
  {
    fileName: "13-git-diff.md",
    eventType: "DIFF_CAPTURED",
    title: "Diff capturado",
    description: "Mudanças no código foram capturadas",
    status: "OK"
  },
  {
    fileName: "review/08-codex-reviewer-prompt.md",
    eventType: "REVIEW_PACKAGE_CREATED",
    title: "Review package gerado",
    description: "Pacote de revisão criado para o Codex Reviewer",
    status: "OK"
  },
  {
    fileName: "09-reviewer-output.md",
    eventType: "REVIEWER_ATTACHED",
    title: "Revisão do Codex anexada",
    description: "Codex Reviewer completou a análise",
    status: "OK"
  },
  {
    fileName: "15-human-decision.md",
    eventType: "HUMAN_DECISION",
    title: "Decisão humana registrada",
    description: "Human Review Gate: decisão tomada",
    status: "OK"
  },
  {
    fileName: "17-promotion-patch.patch",
    eventType: "PATCH_EXPORTED",
    title: "Patch exportado",
    description: "Mudanças exportadas como patch unificado",
    status: "OK"
  },
  {
    fileName: "19-promotion-check.md",
    eventType: "PATCH_CHECKED",
    title: "Patch verificado",
    description: "Patch testado contra o repositório original",
    status: "OK"
  },
  {
    fileName: "20-apply-plan.md",
    eventType: "PATCH_PLANNED",
    title: "Plano de aplicação gerado",
    description: "Plano de aplicação do patch criado",
    status: "OK"
  },
  {
    fileName: "24-validation-workspace.md",
    eventType: "VALIDATION_WORKSPACE",
    title: "Validação do workspace",
    description: "Comandos de validação executados no workspace",
    status: "OK"
  },
  {
    fileName: "25-validation-original.md",
    eventType: "VALIDATION_ORIGINAL",
    title: "Validação do repositório original",
    description: "Comandos de validação executados no repo original",
    status: "OK"
  },
  {
    fileName: "10-final-summary.md",
    eventType: "FINALIZED",
    title: "Run finalizada",
    description: "Run concluída e memória atualizada",
    status: "OK"
  },
  {
    fileName: "26-final-commit.md",
    eventType: "FINAL_COMMIT_RECORDED",
    title: "Commit final registrado",
    description: "Commit do repositório original registrado para auditoria",
    status: "OK"
  }
];

export async function generateRunTimeline(run: RunRecord): Promise<RunTimelineEvent[]> {
  const events: RunTimelineEvent[] = [];

  for (const mapping of ARTIFACT_MAPPINGS) {
    const artifactPath = path.join(run.path, mapping.fileName);
    const exists = await fileExists(artifactPath);

    if (!exists) {
      continue;
    }

    const timestamp = await getFileTimestamp(artifactPath, run);
    const event: RunTimelineEvent = {
      id: `${run.id}-${mapping.eventType}`,
      runId: run.id,
      type: mapping.eventType,
      title: mapping.title,
      description: mapping.description,
      status: mapping.status,
      timestamp,
      artifactPath: mapping.fileName
    };

    events.push(event);
  }

  // Check for dry-run and apply events in 22-apply-result.md
  const applyResultPath = path.join(run.path, "22-apply-result.md");
  if (await fileExists(applyResultPath)) {
    const content = await fs.readFile(applyResultPath, "utf8");
    const timestamp = await getFileTimestamp(applyResultPath, run);

    if (content.includes("DRY_RUN_PASSED")) {
      events.push({
        id: `${run.id}-PATCH_DRY_RUN`,
        runId: run.id,
        type: "PATCH_DRY_RUN",
        title: "Dry-run passou",
        description: "Patch aplicado com sucesso em modo dry-run",
        status: "OK",
        timestamp,
        artifactPath: "22-apply-result.md"
      });
    }

    if (content.includes("APPLIED") && !content.includes("DRY_RUN")) {
      events.push({
        id: `${run.id}-PATCH_APPLIED`,
        runId: run.id,
        type: "PATCH_APPLIED",
        title: "Patch aplicado",
        description: "Patch aplicado ao repositório original",
        status: "OK",
        timestamp,
        artifactPath: "22-apply-result.md"
      });
    }
  }

  // Sort events by timestamp
  events.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return a.timestamp.localeCompare(b.timestamp);
  });

  return events;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function getFileTimestamp(filePath: string, run: RunRecord): Promise<string | undefined> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime.toISOString();
  } catch {
    // Fallback to run timestamps
    return run.createdAt;
  }
}
