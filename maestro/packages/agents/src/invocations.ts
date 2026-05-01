import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentInvocation, AgentProfile, Project, RunRecord, RunWorkspace } from "@maestro/core";
import { getAdapterForProvider, resolveStageForRole, type OpenClaudeAdapterConfig } from "./runtime";

export interface PrepareAgentInvocationOptions {
  run: RunRecord;
  project: Project;
  profile: AgentProfile;
  workspace?: RunWorkspace;
  openClaudeConfig?: OpenClaudeAdapterConfig;
}

export interface PrepareAgentInvocationResult {
  invocation: AgentInvocation;
  invocationDir: string;
  promptPath: string;
  outputPath: string;
}

export async function prepareAgentInvocation(options: PrepareAgentInvocationOptions): Promise<PrepareAgentInvocationResult> {
  const { run, project, profile, workspace, openClaudeConfig } = options;
  const stage = resolveStageForRole(profile.role);
  const prompt = await readPromptForStage(run, stage);
  const invocationId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${profile.id}`;
  const invocationDir = path.join(run.path, "agents", invocationId);
  const promptPath = path.join(invocationDir, "01-input-prompt.md");
  const outputPath = path.join(invocationDir, "02-output.md");
  const startedAt = new Date().toISOString();

  await fs.mkdir(invocationDir, { recursive: true });
  await fs.writeFile(promptPath, ensureTrailingNewline(renderInvocationPrompt(profile, prompt, workspace)), "utf8");

  const adapter = getAdapterForProvider(profile.provider, openClaudeConfig);
  const result = await adapter.invoke({
    invocationId,
    runId: run.id,
    projectId: project.id,
    role: profile.role,
    stage,
    prompt,
    cwd: workspace?.workspacePath || project.repoPath,
    workspacePath: workspace?.workspacePath,
    metadata: {
      projectName: project.name,
      runGoal: run.goal,
      provider: profile.provider,
      model: profile.model
    }
  });
  const completedAt = new Date().toISOString();
  const invocation: AgentInvocation = {
    id: invocationId,
    runId: run.id,
    projectId: project.id,
    agentProfileId: profile.id,
    role: profile.role,
    provider: profile.provider,
    stage,
    inputPath: promptPath,
    outputPath,
    status: result.status,
    startedAt,
    completedAt,
    errorMessage: result.errorMessage
  };

  await fs.writeFile(outputPath, ensureTrailingNewline(result.outputText || result.errorMessage || "No output produced."), "utf8");
  await fs.writeFile(path.join(invocationDir, "00-invocation.json"), `${JSON.stringify(invocation, null, 2)}\n`, "utf8");

  return {
    invocation,
    invocationDir,
    promptPath,
    outputPath
  };
}

export function promptFileForStage(stage: AgentInvocation["stage"]): string {
  switch (stage) {
    case "CEO_INTAKE":
      return "01-goal.md";
    case "SUPERVISOR_PLAN":
      return "03-codex-supervisor-prompt.md";
    case "EXECUTOR_IMPLEMENT":
      return path.join("handoff", "07-kiro-prompt.md");
    case "REVIEWER_REVIEW":
      return path.join("review", "08-codex-reviewer-prompt.md");
    case "QA_VALIDATE":
      return "24-validation-workspace.md";
  }
}

async function readPromptForStage(run: RunRecord, stage: AgentInvocation["stage"]): Promise<string> {
  const preferred = promptFileForStage(stage);
  const preferredPath = path.join(run.path, preferred);
  const preferredContent = await fs.readFile(preferredPath, "utf8").catch(() => undefined);

  if (preferredContent) {
    return preferredContent;
  }

  const goalPath = path.join(run.path, "01-goal.md");
  const goal = await fs.readFile(goalPath, "utf8").catch(() => undefined);

  if (goal) {
    return [
      `# Fallback Prompt for ${stage}`,
      "",
      `Preferred prompt was not found: ${preferred}`,
      "",
      goal
    ].join("\n");
  }

  throw new Error(`No prompt available for stage ${stage}. Missing: ${preferredPath}`);
}

function renderInvocationPrompt(profile: AgentProfile, prompt: string, workspace?: RunWorkspace): string {
  return `# Agent Invocation Prompt

## Agent

- Name: ${profile.name}
- Role: ${profile.role}
- Provider: ${profile.provider}
- Model: ${profile.model || "not configured"}

## Isolation

${workspace
    ? `Use only the workspace sandbox below:\n\n\`${workspace.workspacePath}\`\n\nDo not modify the original repository:\n\n\`${workspace.sourceRepoPath}\``
    : "No workspace sandbox is attached to this invocation. Do not modify any external repository automatically."}

## Responsibilities

${profile.responsibilities.map((item) => `- ${item}`).join("\n")}

## Prompt

${prompt.trim()}
`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
