/**
 * Patch Applier
 * 
 * Applies unified diff patches to workspace sandboxes with validation.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PatchApplyResult {
  success: boolean;
  reason?: string;
  stderr?: string;
}

/**
 * Check if patch can be applied cleanly
 * 
 * Runs: git apply --check <patch>
 * 
 * @param workspacePath - Path to workspace
 * @param patchContent - Patch content
 * @returns Check result
 */
export async function checkPatchApply(
  workspacePath: string,
  patchContent: string
): Promise<PatchApplyResult> {
  try {
    // Write patch to temporary file
    const patchFile = path.join(workspacePath, ".maestro", "temp-patch.diff");
    await fs.mkdir(path.dirname(patchFile), { recursive: true });
    await fs.writeFile(patchFile, patchContent, "utf8");
    
    // Run git apply --check
    try {
      await execFileAsync("git", ["apply", "--check", patchFile], {
        cwd: workspacePath,
        maxBuffer: 4 * 1024 * 1024
      });
      
      // Clean up temp file
      await fs.unlink(patchFile).catch(() => {});
      
      return { success: true };
    } catch (error: any) {
      // Clean up temp file
      await fs.unlink(patchFile).catch(() => {});
      
      return {
        success: false,
        reason: "Patch cannot be applied cleanly (conflicts or invalid format)",
        stderr: error.stderr || error.message
      };
    }
  } catch (error: any) {
    return {
      success: false,
      reason: "Failed to check patch",
      stderr: error.message
    };
  }
}

/**
 * Apply patch to workspace
 * 
 * Runs: git apply <patch>
 * 
 * @param workspacePath - Path to workspace
 * @param patchContent - Patch content
 * @returns Apply result
 */
export async function applyPatchToWorkspace(
  workspacePath: string,
  patchContent: string
): Promise<PatchApplyResult> {
  try {
    // Write patch to temporary file
    const patchFile = path.join(workspacePath, ".maestro", "temp-patch.diff");
    await fs.mkdir(path.dirname(patchFile), { recursive: true });
    await fs.writeFile(patchFile, patchContent, "utf8");
    
    // Run git apply
    try {
      await execFileAsync("git", ["apply", patchFile], {
        cwd: workspacePath,
        maxBuffer: 4 * 1024 * 1024
      });
      
      // Clean up temp file
      await fs.unlink(patchFile).catch(() => {});
      
      return { success: true };
    } catch (error: any) {
      // Clean up temp file
      await fs.unlink(patchFile).catch(() => {});
      
      return {
        success: false,
        reason: "Failed to apply patch",
        stderr: error.stderr || error.message
      };
    }
  } catch (error: any) {
    return {
      success: false,
      reason: "Failed to apply patch",
      stderr: error.message
    };
  }
}

/**
 * Save patch to artifact file
 * 
 * @param patchPath - Path to save patch
 * @param patchContent - Patch content
 */
export async function savePatchArtifact(
  patchPath: string,
  patchContent: string
): Promise<void> {
  await fs.mkdir(path.dirname(patchPath), { recursive: true });
  const content = patchContent.endsWith("\n") ? patchContent : `${patchContent}\n`;
  await fs.writeFile(patchPath, content, "utf8");
}
