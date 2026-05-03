import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentInvocation, AgentProfile, Project, RunRecord, RunWorkspace } from "@maestro/core";
import { getAdapterForProvider, resolveStageForRole, type OpenClaudeAdapterConfig } from "./runtime";
import { buildExecutorContextPack } from "./executor-context-pack.js";

export interface PrepareAgentInvocationOptions {
  run: RunRecord;
  project: Project;
  profile: AgentProfile;
  workspace?: RunWorkspace;
  openClaudeConfig?: OpenClaudeAdapterConfig;
  homeDir?: string;
}

export interface PrepareAgentInvocationResult {
  invocation: AgentInvocation;
  invocationDir: string;
  promptPath: string;
  outputPath: string;
}

export interface AttachAgentInvocationOutputResult {
  invocation: AgentInvocation;
  outputPath: string;
}

export async function prepareAgentInvocation(options: PrepareAgentInvocationOptions): Promise<PrepareAgentInvocationResult> {
  const { run, project, profile, workspace, openClaudeConfig, homeDir } = options;
  if (run.status === "FINALIZED" || run.status === "BLOCKED") {
    throw new Error(`Cannot invoke agent for run ${run.id} because it is ${run.status}. Create a new run or use a future audit mode.`);
  }

  const stage = resolveStageForRole(profile.role);
  
  // Generate invocationId once at the beginning
  const invocationId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${profile.id}`;
  const invocationDir = path.join(run.path, "agents", invocationId);
  const promptPath = path.join(invocationDir, "01-input-prompt.md");
  const outputPath = path.join(invocationDir, "02-output.md");
  
  let prompt = await readPromptForStage(run, stage);
  
  // Add Executor Context Pack for patch-based executor
  if (stage === "EXECUTOR_IMPLEMENT" && workspace) {
    try {
      const contextPack = await buildExecutorContextPack({
        project,
        run,
        workspacePath: workspace.workspacePath,
        maxBytes: 80000
      });
      
      // Append context pack to prompt
      prompt = `${prompt}\n\n---\n\n${contextPack.markdown}`;
      
      // Save context pack metadata in the same invocation directory
      await fs.mkdir(invocationDir, { recursive: true });
      await fs.writeFile(
        path.join(invocationDir, "01-context-pack-metadata.json"),
        JSON.stringify({
          filesIncluded: contextPack.filesIncluded,
          totalBytes: contextPack.totalBytes,
          truncated: contextPack.truncated
        }, null, 2),
        "utf8"
      );
    } catch (error) {
      // If context pack fails, log but continue with original prompt
      console.warn(`Failed to build executor context pack: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  const startedAt = new Date().toISOString();

  await fs.mkdir(invocationDir, { recursive: true });
  await fs.writeFile(promptPath, ensureTrailingNewline(renderInvocationPrompt(profile, prompt, workspace)), "utf8");

  // Validate prompt is not empty before invoking
  if (!prompt || prompt.trim().length === 0) {
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
      status: "FAILED",
      startedAt,
      completedAt: new Date().toISOString(),
      errorMessage: "EMPTY_AGENT_PROMPT: Prompt is empty or undefined. Cannot invoke agent without prompt."
    };
    
    await fs.writeFile(outputPath, "Error: Empty prompt provided to agent.\n", "utf8");
    await fs.writeFile(path.join(invocationDir, "00-invocation.json"), `${JSON.stringify(invocation, null, 2)}\n`, "utf8");
    
    return {
      invocation,
      invocationDir,
      promptPath,
      outputPath
    };
  }

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
    homeDir,
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
    blockedReason: result.blockedReason,
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

export async function attachAgentInvocationOutput(
  invocation: AgentInvocation,
  sourceFilePath: string
): Promise<AttachAgentInvocationOutputResult> {
  const resolvedSourceFilePath = path.resolve(sourceFilePath);
  const content = await fs.readFile(resolvedSourceFilePath, "utf8");
  const outputPath = invocation.outputPath || path.join(path.dirname(invocation.inputPath), "02-output.md");
  const updatedInvocation: AgentInvocation = {
    ...invocation,
    outputPath,
    status: "SUCCEEDED",
    completedAt: new Date().toISOString(),
    blockedReason: undefined,
    errorMessage: undefined
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, ensureTrailingNewline(content), "utf8");
  await fs.writeFile(path.join(path.dirname(outputPath), "00-invocation.json"), `${JSON.stringify(updatedInvocation, null, 2)}\n`, "utf8");

  return {
    invocation: updatedInvocation,
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
      return "04-kiro-executor-prompt.md";
    case "REVIEWER_REVIEW":
      return "05-codex-reviewer-prompt.md";
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
