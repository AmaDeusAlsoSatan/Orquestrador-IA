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

export interface ProcessExecutorPatchInput {
  homeDir: string;
  invocation: AgentInvocation;
  outputPath: string;
  project: Project;
  run: RunRecord;
  workspace: RunWorkspace | undefined;
  state: MaestroState;
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
  const { homeDir, invocation, outputPath, project, run, workspace, state } = input;

  try {
    // Read agent output
    const outputContent = await fs.readFile(outputPath, "utf8");
    
    // Extract patch from output
    const patchResult = extractUnifiedDiffFromAgentOutput(outputContent);
    
    if (!patchResult.patch) {
      return {
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: `Patch extraction failed: ${patchResult.reason || "No unified diff found in output"}`
        },
        state
      };
    }
    
    // Validate patch safety
    const safetyCheck = validatePatchSafety(patchResult.patch);
    if (!safetyCheck.safe) {
      return {
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: `Patch safety validation failed: ${safetyCheck.reason}`
        },
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
      return {
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: `Patch apply check failed: ${checkResult.reason}\n${checkResult.stderr || ""}`
        },
        state: nextState,
        patchArtifactPath,
        workspacePath
      };
    }
    
    // Apply patch to workspace
    const applyResult = await applyPatchToWorkspace(workspacePath, patchResult.patch);
    if (!applyResult.success) {
      return {
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: `Patch apply failed: ${applyResult.reason}\n${applyResult.stderr || ""}`
        },
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
        invocation: {
          ...invocation,
          status: "FAILED",
          errorMessage: "Patch applied but no changes detected in workspace (git status is clean)"
        },
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
      invocation: {
        ...invocation,
        status: "FAILED",
        errorMessage: `Patch processing error: ${error instanceof Error ? error.message : String(error)}`
      },
      state
    };
  }
}
