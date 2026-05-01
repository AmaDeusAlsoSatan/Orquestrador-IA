import type { OrchestrationWorkflow } from "@maestro/core";

export const CODEX_SUPERVISES_KIRO_WORKFLOW_ID = "codex-supervises-kiro";

export function createCodexSupervisesKiroWorkflow(now = new Date().toISOString()): OrchestrationWorkflow {
  return {
    id: CODEX_SUPERVISES_KIRO_WORKFLOW_ID,
    name: "Codex supervises Kiro",
    description:
      "Conceptual workflow where Maestro collects project memory, Codex plans and reviews, Kiro implements, and memory is updated after review.",
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: "collect-context",
        name: "Collect context",
        assignedRole: "MEMORY_MANAGER",
        adapterType: "MANUAL",
        inputDocuments: [
          "00-overview.md",
          "01-current-state.md",
          "02-backlog.md",
          "03-decisions.md",
          "04-known-problems.md",
          "05-next-actions.md",
          "07-imported-context.md"
        ],
        outputDocuments: ["context-brief.md"],
        requiresApproval: false
      },
      {
        id: "codex-plan",
        name: "Codex technical plan",
        assignedRole: "SUPERVISOR",
        adapterType: "CODEX_SUPERVISOR",
        inputDocuments: ["context-brief.md"],
        outputDocuments: ["codex-plan.md"],
        requiresApproval: true
      },
      {
        id: "kiro-implement",
        name: "Kiro implementation",
        assignedRole: "EXECUTOR",
        adapterType: "KIRO_EXECUTOR",
        inputDocuments: ["codex-plan.md"],
        outputDocuments: ["implementation-diff.patch"],
        requiresApproval: false
      },
      {
        id: "kiro-report",
        name: "Kiro implementation report",
        assignedRole: "EXECUTOR",
        adapterType: "KIRO_EXECUTOR",
        inputDocuments: ["codex-plan.md", "implementation-diff.patch"],
        outputDocuments: ["kiro-report.md"],
        requiresApproval: false
      },
      {
        id: "codex-review",
        name: "Codex review",
        assignedRole: "REVIEWER",
        adapterType: "CODEX_SUPERVISOR",
        inputDocuments: ["codex-plan.md", "implementation-diff.patch", "kiro-report.md"],
        outputDocuments: ["codex-review.md"],
        requiresApproval: true
      },
      {
        id: "memory-update",
        name: "Update memory",
        assignedRole: "MEMORY_MANAGER",
        adapterType: "MANUAL",
        inputDocuments: ["codex-review.md", "kiro-report.md"],
        outputDocuments: [
          "01-current-state.md",
          "03-decisions.md",
          "04-known-problems.md",
          "05-next-actions.md",
          "06-agent-log.md"
        ],
        requiresApproval: true
      }
    ]
  };
}
