/**
 * Executor Patch Flow
 * 
 * Shared logic for processing Executor patches in both CLI and Server.
 * Extracts unified diff from executor output, validates, applies to workspace sandbox.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentInvocation, MaestroState, Project, RunRecord, RunWorkspace } from "@maestro/core";
import { getMaestroPaths, upsertRunWorkspace } from "@maestro/core";
import { captureRunGitDiff } from "@maestro/memory";
import {
  applyPatchToWorkspace,
  checkPatchApply,
  createRunWorkspace,
  inspectRunWorkspace,
  savePatchArtifact
} from "@maestro/runner";
import { extractUnifiedDiffFromAgentOutput, validatePatchSafety } from "./patch-extractor.js";
import { repairExecutorPatch, type RepairPatchOptions } from "./executor-patch-repair.js";
import type { OpenClaudeAdapterConfig } from "./runtime.js";
import { classifyExecutorFailure, saveRecoveryMetadata, type RecoveryMetadata } from "./executor-recovery.js";

export interface ProcessExecutorPatchInput {
  homeDir: string;
  invocation: AgentInvocation;
  outputPath: string;
  project: Project;
  run: RunRecord;
  workspace: RunWorkspace | undefined;
  state: MaestroState;
  openClaudeConfig?: OpenClaudeAdapterConfig;
  contextPackMarkdown?: string;
  originalPrompt?: string;
  maxRepairAttempts?: number;
}

export interface ProcessExecutorPatchResult {
  invocation: AgentInvocation;
  state: MaestroState;
  patchArtifactPath?: string;
  workspacePath?: string;
  changedFilesCount?: number;
  diffPath?: string;
}

/**
 * Helper to create failed invocation with recovery metadata
 */
async function createFailedInvocationWithRecovery(
  invocation: AgentInvocation,
  errorMessage: string,
  outputPath: string,
  run: RunRecord
): Promise<AgentInvocation> {
  const failedInvocation: AgentInvocation = {
    ...invocation,
    status: "FAILED",
    errorMessage
  };
  
  // Classify failure and save recovery metadata
  const classification = classifyExecutorFailure(failedInvocation);
  
  if (classification.recoverable) {
    const invocationDir = path.dirname(outputPath);
    
    // Detect if patch repair was attempted
    const isPatchRepairFailure = 
      classification.kind === "PATCH_REPAIR_FAILED" ||
      errorMessage.includes("Patch repair failed");
    
    const metadata: RecoveryMetadata = {
      failureKind: classification.kind,
      recoverable: true,
      recommendedRecovery: classification.recommendedStrategy,
      previousInvocationId: invocation.id,
      reason: classification.reason,
      runRecovery: {
        attempt: 0,
        maxAttempts: 2 // Run recovery allows 2 attempts
      }
    };
    
    // If patch repair was attempted, record it
    if (isPatchRepairFailure) {
      const repairMatch = errorMessage.match(/after (\d+) attempt/);
      const repairAttempts = repairMatch ? parseInt(repairMatch[1], 10) : 1;
      
      metadata.patchRepair = {
        attempt: repairAttempts,
        maxAttempts: 1,
        result: "failed"
      };
    }
    
    await saveRecoveryMetadata(invocationDir, metadata);
  }
  
  return failedInvocation;
}

/**
 * Process Executor patch: extract, validate, and apply to workspace
 * 
 * This is the shared implementation used by both CLI and Server.
 * 
 * Steps:
 * 1. Read executor output
 * 2. Extract unified diff patch
 * 3. Validate patch safety
 * 4. Save patch artifact (03-proposed.patch)
 * 5. Ensure workspace exists (create if needed)
 * 6. Check if patch can be applied (git apply --check)
 * 7. Apply patch to workspace (with Windows autocrlf fallback)
 * 8. Verify changes were actually applied
 * 9. Capture workspace diff (not original repo)
 * 
 * Returns updated invocation (FAILED if patch processing fails)
 */
export async function processExecutorPatchFlow(
  input: ProcessExecutorPatchInput
): Promise<ProcessExecutorPatchResult> {
  const { 
    homeDir, 
    invocation, 
    outputPath, 
    project, 
    run, 
    workspace, 
    state,
    openClaudeConfig,
    contextPackMarkdown,
    originalPrompt,
    maxRepairAttempts = 1
  } = input;

  try {
    // Read agent output
    const outputContent = await fs.readFile(outputPath, "utf8");
    
    // Extract patch from output
    const patchResult = extractUnifiedDiffFromAgentOutput(outputContent);
    
    if (!patchResult.patch) {
      return {
        invocation: await createFailedInvocationWithRecovery(
          invocation,
          `Patch extraction failed: ${patchResult.reason || "No unified diff found in output"}`,
          outputPath,
          run
        ),
        state
      };
    }
    
    // Validate patch safety
    const safetyCheck = validatePatchSafety(patchResult.patch);
    if (!safetyCheck.safe) {
      return {
        invocation: await createFailedInvocationWithRecovery(
          invocation,
          `Patch safety validation failed: ${safetyCheck.reason}`,
          outputPath,
          run
        ),
        state
      };
    }
    
    // Save patch artifact
    const patchArtifactPath = path.join(path.dirname(outputPath), "03-proposed.patch");
    await savePatchArtifact(patchArtifactPath, patchResult.patch);
    
    // Ensure workspace exists
    let workspacePath: string;
    let nextState = state;
    
    if (!workspace) {
      // Create workspace if it doesn't exist
      const workspaceBasePath = path.join(getMaestroPaths(homeDir).workspacesDir, project.id, run.id);
      const newWorkspace = await createRunWorkspace({
        projectId: project.id,
        runId: run.id,
        sourceRepoPath: project.repoPath,
        workspacePath: workspaceBasePath
      });
      nextState = upsertRunWorkspace(nextState, newWorkspace);
      workspacePath = newWorkspace.workspacePath; // Use effective workspace path (handles monorepos)
    } else {
      workspacePath = workspace.workspacePath;
    }
    
    // Check if patch can be applied
    const checkResult = await checkPatchApply(workspacePath, patchResult.patch);
    if (!checkResult.success) {
      // Save apply check error
      const invocationDir = path.dirname(outputPath);
      const applyCheckErrorPath = path.join(invocationDir, "04-apply-check-error.txt");
      const errorContent = `${checkResult.reason}\n\n${checkResult.stderr || ""}`;
      await fs.writeFile(applyCheckErrorPath, errorContent, "utf8");
      
      // Attempt patch repair if we have the necessary context
      if (contextPackMarkdown && originalPrompt && maxRepairAttempts > 0) {
        console.log(`[Executor Patch Flow] Patch check failed, attempting repair (max ${maxRepairAttempts} attempts)...`);
        
        const repairResult = await repairExecutorPatch({
          invocation,
          invocationDir,
          originalPrompt,
          contextPackMarkdown,
          previousOutput: outputContent,
          previousPatch: patchResult.patch,
          applyCheckError: errorContent,
          project,
          run,
          openClaudeConfig,
          homeDir,
          workspacePath,
          maxAttempts: maxRepairAttempts
        });
        
        if (repairResult.success && repairResult.repairedPatch) {
          console.log(`[Executor Patch Flow] Patch repair succeeded after ${repairResult.attempts} attempt(s)`);
          
          // Validate repaired patch
          const repairedCheckResult = await checkPatchApply(workspacePath, repairResult.repairedPatch);
          
          if (repairedCheckResult.success) {
            // Save repair check result
            const repairCheckPath = path.join(invocationDir, "07-repair-apply-check.md");
            await fs.writeFile(repairCheckPath, "✅ Repaired patch applies cleanly", "utf8");
            
            // Use repaired patch for the rest of the flow
            console.log("[Executor Patch Flow] Repaired patch validated, continuing with apply...");
            
            // Apply repaired patch
            const applyResult = await applyPatchToWorkspace(workspacePath, repairResult.repairedPatch);
            if (!applyResult.success) {
              return {
                invocation: await createFailedInvocationWithRecovery(
                  invocation,
                  `Repaired patch apply failed: ${applyResult.reason}\n${applyResult.stderr || ""}`,
                  outputPath,
                  run
                ),
                state: nextState,
                patchArtifactPath,
                workspacePath
              };
            }
            
            // Continue with verification and diff capture
            const workspaceStatus = await inspectRunWorkspace(workspacePath);
            const hasChanges = workspaceStatus.changedFiles.length > 0 || workspaceStatus.untrackedFiles.length > 0;
            if (!hasChanges) {
              return {
                invocation: await createFailedInvocationWithRecovery(
                  invocation,
                  "Repaired patch applied but no changes detected in workspace (git status is clean)",
                  outputPath,
                  run
                ),
                state: nextState,
                patchArtifactPath,
                workspacePath
              };
            }
            
            // Capture workspace diff
            await captureRunGitDiff(project, run, {
              repoPath: workspacePath,
              source: "WORKSPACE_SANDBOX"
            });
            
            const changedFilesCount = workspaceStatus.changedFiles.length + workspaceStatus.untrackedFiles.length;
            const diffPath = path.join(run.path, "13-git-diff.md");
            
            return {
              invocation,
              state: nextState,
              patchArtifactPath,
              workspacePath,
              changedFilesCount,
              diffPath
            };
          } else {
            // Repaired patch still doesn't apply
            const repairCheckPath = path.join(invocationDir, "07-repair-apply-check.md");
            await fs.writeFile(
              repairCheckPath, 
              `❌ Repaired patch still fails:\n\n${repairedCheckResult.reason}\n\n${repairedCheckResult.stderr || ""}`,
              "utf8"
            );
          }
        }
        
        // Repair failed or repaired patch still doesn't apply
        return {
          invocation: await createFailedInvocationWithRecovery(
            invocation,
            `Patch repair failed after ${repairResult.attempts} attempt(s): ${repairResult.finalError || "Repaired patch still does not apply"}`,
            outputPath,
            run
          ),
          state: nextState,
          patchArtifactPath,
          workspacePath
        };
      }
      
      // No repair attempted (missing context or maxRepairAttempts = 0)
      return {
        invocation: await createFailedInvocationWithRecovery(
          invocation,
          `Patch apply check failed: ${checkResult.reason}\n${checkResult.stderr || ""}`,
          outputPath,
          run
        ),
        state: nextState,
        patchArtifactPath,
        workspacePath
      };
    }
    
    // Apply patch to workspace
    const applyResult = await applyPatchToWorkspace(workspacePath, patchResult.patch);
    if (!applyResult.success) {
      return {
        invocation: await createFailedInvocationWithRecovery(
          invocation,
          `Patch apply failed: ${applyResult.reason}\n${applyResult.stderr || ""}`,
          outputPath,
          run
        ),
        state: nextState,
        patchArtifactPath,
        workspacePath
      };
    }
    
    // Verify patch was actually applied by checking workspace status
    const workspaceStatus = await inspectRunWorkspace(workspacePath);
    const hasChanges = workspaceStatus.changedFiles.length > 0 || workspaceStatus.untrackedFiles.length > 0;
    if (!hasChanges) {
      return {
        invocation: await createFailedInvocationWithRecovery(
          invocation,
          "Patch applied but no changes detected in workspace (git status is clean)",
          outputPath,
          run
        ),
        state: nextState,
        patchArtifactPath,
        workspacePath
      };
    }
    
    // Capture workspace diff (not original repo)
    await captureRunGitDiff(project, run, {
      repoPath: workspacePath,
      source: "WORKSPACE_SANDBOX"
    });
    
    const changedFilesCount = workspaceStatus.changedFiles.length + workspaceStatus.untrackedFiles.length;
    const diffPath = path.join(run.path, "13-git-diff.md");
    
    return {
      invocation,
      state: nextState,
      patchArtifactPath,
      workspacePath,
      changedFilesCount,
      diffPath
    };
  } catch (error) {
    return {
      invocation: await createFailedInvocationWithRecovery(
        invocation,
        `Patch processing error: ${error instanceof Error ? error.message : String(error)}`,
        outputPath,
        run
      ),
      state
    };
  }
}
