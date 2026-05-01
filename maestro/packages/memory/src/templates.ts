import path from "node:path";
import type { MemoryDocument, Project } from "@maestro/core";

export interface VaultDocumentTemplate {
  fileName: string;
  title: string;
  kind: MemoryDocument["kind"];
  render: (project: Project) => string;
}

export const PROJECT_VAULT_DOCUMENTS: VaultDocumentTemplate[] = [
  {
    fileName: "00-overview.md",
    title: "Overview",
    kind: "overview",
    render: (project) => `# ${project.name}

## Description

${project.description || "_No description yet._"}

## Metadata

- Id: ${project.id}
- Repository: ${project.repoPath || "_Not set_"}
- Status: ${project.status}
- Priority: ${project.priority}
- Stack: ${formatStack(project.stack)}

## Purpose

_Add the strategic purpose of this project here._
`
  },
  {
    fileName: "01-current-state.md",
    title: "Current State",
    kind: "current-state",
    render: (project) => `# Current State

## Snapshot

- Status: ${project.status}
- Priority: ${project.priority}
- Updated: ${project.updatedAt}

## What is true now

_Describe the current product, codebase, deployment state, and active constraints._
`
  },
  {
    fileName: "02-backlog.md",
    title: "Backlog",
    kind: "backlog",
    render: () => `# Backlog

## Now

- [ ] Add the first concrete next task.

## Next

- [ ] Capture upcoming improvements.

## Later

- [ ] Capture ideas that should not distract the current work.
`
  },
  {
    fileName: "03-decisions.md",
    title: "Decisions",
    kind: "decisions",
    render: () => `# Decisions

## Decision Log

Add decisions in this format:

\`\`\`text
Date:
Decision:
Context:
Consequences:
\`\`\`
`
  },
  {
    fileName: "04-known-problems.md",
    title: "Known Problems",
    kind: "known-problems",
    render: () => `# Known Problems

## Open Problems

- [ ] Describe known bugs, risks, missing context, or fragile areas.
`
  },
  {
    fileName: "05-next-actions.md",
    title: "Next Actions",
    kind: "next-actions",
    render: () => `# Next Actions

## Immediate

- [ ] Define the next action for this project.

## Waiting

- [ ] Capture blockers or decisions needed before work can continue.
`
  },
  {
    fileName: "06-agent-log.md",
    title: "Agent Log",
    kind: "agent-log",
    render: () => `# Agent Log

Use this file to record future agent activity, handoffs, summaries, and notable outputs.

MVP 1 does not run agents yet.
`
  }
];

export function toMemoryDocument(project: Project, projectVaultDir: string, template: VaultDocumentTemplate): MemoryDocument {
  const now = new Date().toISOString();

  return {
    projectId: project.id,
    path: path.join(projectVaultDir, template.fileName),
    title: template.title,
    kind: template.kind,
    createdAt: now,
    updatedAt: now
  };
}

function formatStack(stack: string[]): string {
  return stack.length > 0 ? stack.join(", ") : "_Not set_";
}
