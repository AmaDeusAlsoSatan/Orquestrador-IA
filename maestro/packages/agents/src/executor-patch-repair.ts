/**
 * Executor Patch Repair
 * 
 * Attempts to repair invalid patches by invoking the executor again with
 * the error message and previous patch.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentInvocation, Project, RunRecord } from "@maestro/core";
import { getAdapterForProvider, type OpenClaudeAdapterConfig } from "./runtime.js";

export interface RepairPatchOptions {
  invocation: AgentInvocation;
  invocationDir: string;
  originalPrompt: string;
  contextPackMarkdown: string;
  previousOutput: string;
  previousPatch: string;
  applyCheckError: string;
  project: Project;
  run: RunRecord;
  openClaudeConfig?: OpenClaudeAdapterConfig;
  homeDir?: string;
  workspacePath: string;
  maxAttempts?: number;
}

export interface RepairPatchResult {
  success: boolean;
  repairedPatch?: string;
  attempts: number;
  finalError?: string;
}

/**
 * Attempt to repair an invalid patch
 * 
 * Invokes the executor again with:
 * - Original context pack
 * - Previous patch
 * - Git apply error
 * - Strict instructions to return only corrected patch
 */
export async function repairExecutorPatch(
  options: RepairPatchOptions
): Promise<RepairPatchResult> {
  const {
    invocation,
    invocationDir,
    originalPrompt,
    contextPackMarkdown,
    previousOutput,
    previousPatch,
    applyCheckError,
    project,
    run,
    openClaudeConfig,
    homeDir,
    workspacePath,
    maxAttempts = 1
  } = options;
  
  let attempts = 0;
  let currentPatch = previousPatch;
  let currentError = applyCheckError;
  
  while (attempts < maxAttempts) {
    attempts++;
    
    // Build repair prompt
    const repairPrompt = buildRepairPrompt({
      originalPrompt,
      contextPackMarkdown,
      previousOutput,
      previousPatch: currentPatch,
      applyCheckError: currentError,
      attemptNumber: attempts
    });
    
    // Save repair prompt
    const repairPromptPath = path.join(invocationDir, `0${4 + (attempts - 1) * 3}-repair-prompt.md`);
    await fs.writeFile(repairPromptPath, repairPrompt, "utf8");
    
    // Invoke adapter for repair
    const adapter = getAdapterForProvider(invocation.provider, openClaudeConfig);
    
    try {
      const result = await adapter.invoke({
        invocationId: `${invocation.id}-repair-${attempts}`,
        runId: run.id,
        projectId: project.id,
        role: invocation.role,
        stage: invocation.stage,
        prompt: repairPrompt,
        cwd: workspacePath,
        workspacePath,
        homeDir,
        metadata: {
          projectName: project.name,
          runGoal: run.goal,
          provider: invocation.provider,
          repairAttempt: attempts
        }
      });
      
      if (result.status === "FAILED" || !result.outputText) {
        currentError = result.errorMessage || "Repair invocation failed";
        continue;
      }
      
      // Extract patch from repair output
      const repairedPatch = extractPatchFromOutput(result.outputText);
      
      if (!repairedPatch) {
        currentError = "PATCH_REPAIR_OUTPUT_INVALID: repair response did not contain a valid unified diff";
        
        // Save repair output for debugging
        const repairOutputPath = path.join(invocationDir, `0${5 + (attempts - 1) * 3}-repair-output.md`);
        await fs.writeFile(repairOutputPath, result.outputText, "utf8");
        
        continue;
      }
      
      // Validate patch structure
      if (!repairedPatch.includes("diff --git")) {
        currentError = "PATCH_REPAIR_OUTPUT_INVALID: extracted patch does not contain 'diff --git' header";
        
        // Save repair output for debugging
        const repairOutputPath = path.join(invocationDir, `0${5 + (attempts - 1) * 3}-repair-output.md`);
        await fs.writeFile(repairOutputPath, result.outputText, "utf8");
        
        continue;
      }
      
      // Save repaired patch
      const repairedPatchPath = path.join(invocationDir, `0${6 + (attempts - 1) * 3}-repaired.patch`);
      await fs.writeFile(repairedPatchPath, repairedPatch, "utf8");
      
      // Return success - caller will validate if patch applies
      return {
        success: true,
        repairedPatch,
        attempts
      };
      
    } catch (error) {
      currentError = error instanceof Error ? error.message : String(error);
      continue;
    }
  }
  
  // All attempts failed
  return {
    success: false,
    attempts,
    finalError: currentError
  };
}

/**
 * Build repair prompt
 */
function buildRepairPrompt(options: {
  originalPrompt: string;
  contextPackMarkdown: string;
  previousOutput: string;
  previousPatch: string;
  applyCheckError: string;
  attemptNumber: number;
}): string {
  const {
    originalPrompt,
    contextPackMarkdown,
    previousOutput,
    previousPatch,
    applyCheckError,
    attemptNumber
  } = options;
  
  return `# Patch Repair Task (Attempt ${attemptNumber})

## Critical Instructions

The previous unified diff was **INVALID** and could not be applied to the workspace.

**You are patch-based. Do not read files. Do not explain. Do not discuss.**

You already have:
- The relevant file context (below)
- The previous patch that failed
- The git apply error message

**Return ONLY a complete corrected unified diff in a fenced \`\`\`diff block.**

Do not include prose outside the diff block.
Do not use absolute paths.
Do not omit hunk context lines.
Do not truncate the patch.
Do not put \`default:\` before other \`case:\` statements in switch blocks.

If the task is too large, implement a smaller valid subset.
A small complete patch is better than a large broken patch.

---

## Git Apply Error

\`\`\`
${applyCheckError}
\`\`\`

---

## Previous Patch (INVALID)

\`\`\`diff
${previousPatch}
\`\`\`

---

## Previous Output

${previousOutput}

---

${contextPackMarkdown}

---

## Your Task

Return a corrected unified diff that:
1. Fixes the structural errors from the previous patch
2. Applies cleanly with \`git apply --check\`
3. Implements the same goal as before (or a valid subset)

Return format:

\`\`\`diff
[corrected unified diff here]
\`\`\`

Do not include any other text.
`;
}

/**
 * Extract patch from repair output
 * 
 * Looks for fenced diff block
 */
function extractPatchFromOutput(output: string): string | null {
  // Look for fenced diff block
  const diffPattern = /```diff\s*\n([\s\S]*?)\n```/;
  const match = output.match(diffPattern);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  
  // Try without language specifier
  const genericPattern = /```\s*\n(diff --git[\s\S]*?)\n```/;
  const genericMatch = output.match(genericPattern);
  
  if (genericMatch && genericMatch[1]) {
    return genericMatch[1].trim();
  }
  
  return null;
}
