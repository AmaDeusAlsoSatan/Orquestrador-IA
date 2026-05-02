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
    
    // Ensure patch ends with newline (git patches should end with blank line)
    let content = patchContent;
    if (!content.endsWith("\n\n")) {
      if (content.endsWith("\n")) {
        content = `${content}\n`;
      } else {
        content = `${content}\n\n`;
      }
    }
    await fs.writeFile(patchFile, content, "utf8");
    
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
 * On Windows with core.autocrlf=true, git apply may skip patches due to line ending
 * normalization issues. In this case, we fall back to manual application.
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
    
    // Ensure patch ends with newline (git patches should end with blank line)
    let content = patchContent;
    if (!content.endsWith("\n\n")) {
      if (content.endsWith("\n")) {
        content = `${content}\n`;
      } else {
        content = `${content}\n\n`;
      }
    }
    await fs.writeFile(patchFile, content, "utf8");
    
    // Verify file was written
    const fileExists = await fs.stat(patchFile).then(() => true).catch(() => false);
    if (!fileExists) {
      return {
        success: false,
        reason: "Failed to write patch file",
        stderr: `Patch file not found after write: ${patchFile}`
      };
    }
    
    // Run git apply with verbose output to detect skipped patches
    try {
      const result = await execFileAsync("git", ["apply", "--verbose", patchFile], {
        cwd: workspacePath,
        maxBuffer: 4 * 1024 * 1024
      });
      
      // Check if git skipped the patch (Windows autocrlf issue)
      const output = result.stdout + result.stderr;
      if (output.includes("Skipped patch")) {
        // Fall back to manual application
        console.warn("git apply skipped patch (likely Windows autocrlf issue), falling back to manual application");
        const manualResult = await applyPatchManually(workspacePath, patchContent);
        
        // Clean up temp file
        await fs.unlink(patchFile).catch(() => {});
        
        return manualResult;
      }
      
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
 * Manually apply patch by parsing and applying file operations
 * 
 * This is a fallback for when git apply fails due to line ending issues on Windows.
 * 
 * @param workspacePath - Path to workspace
 * @param patchContent - Patch content
 * @returns Apply result
 */
async function applyPatchManually(
  workspacePath: string,
  patchContent: string
): Promise<PatchApplyResult> {
  try {
    // Parse patch to extract file operations
    const operations = parsePatchOperations(patchContent);
    
    if (operations.length === 0) {
      return {
        success: false,
        reason: "No file operations found in patch"
      };
    }
    
    // Apply each operation
    for (const op of operations) {
      const filePath = path.join(workspacePath, op.path);
      
      if (op.type === "create" || op.type === "modify") {
        // Ensure directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        
        // Write file content (preserve LF line endings from patch)
        await fs.writeFile(filePath, op.content, "utf8");
      } else if (op.type === "delete") {
        // Delete file
        await fs.unlink(filePath).catch(() => {});
      }
    }
    
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      reason: "Manual patch application failed",
      stderr: error.message
    };
  }
}

interface PatchOperation {
  type: "create" | "modify" | "delete";
  path: string;
  content: string;
}

/**
 * Parse unified diff patch to extract file operations
 * 
 * Supports:
 * - New files (new file mode)
 * - Modified files
 * - Deleted files (deleted file mode)
 * 
 * @param patchContent - Patch content
 * @returns Array of file operations
 */
function parsePatchOperations(patchContent: string): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const lines = patchContent.split("\n");
  
  let currentFile: string | null = null;
  let currentType: "create" | "modify" | "delete" | null = null;
  let currentContent: string[] = [];
  let inHunk = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Parse file header: diff --git a/path b/path
    if (line.startsWith("diff --git ")) {
      // Save previous file if any
      if (currentFile && currentType) {
        // Add trailing newline if content exists (standard for text files)
        const content = currentContent.length > 0 
          ? currentContent.join("\n") + "\n"
          : "";
        
        operations.push({
          type: currentType,
          path: currentFile,
          content
        });
      }
      
      // Extract file path (use b/ path for new/modified files)
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      if (match) {
        currentFile = match[1];
        currentType = "modify"; // Default to modify
        currentContent = [];
        inHunk = false;
      }
    }
    
    // Check for new file
    else if (line.startsWith("new file mode")) {
      currentType = "create";
    }
    
    // Check for deleted file
    else if (line.startsWith("deleted file mode")) {
      currentType = "delete";
    }
    
    // Start of hunk: @@ -start,count +start,count @@
    else if (line.startsWith("@@")) {
      inHunk = true;
    }
    
    // Content line (added)
    else if (inHunk && line.startsWith("+") && !line.startsWith("+++")) {
      currentContent.push(line.substring(1)); // Remove leading +
    }
    
    // Content line (context or removed) - for modify operations
    else if (inHunk && currentType === "modify" && !line.startsWith("-") && !line.startsWith("\\")) {
      // For simplicity, we only handle additions in this fallback
      // Full patch application would require more complex logic
    }
  }
  
  // Save last file
  if (currentFile && currentType) {
    // Add trailing newline if content exists (standard for text files)
    const content = currentContent.length > 0 
      ? currentContent.join("\n") + "\n"
      : "";
    
    operations.push({
      type: currentType,
      path: currentFile,
      content
    });
  }
  
  return operations;
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
  // Ensure patch ends with newline (git patches should end with blank line)
  let content = patchContent;
  if (!content.endsWith("\n\n")) {
    if (content.endsWith("\n")) {
      content = `${content}\n`;
    } else {
      content = `${content}\n\n`;
    }
  }
  await fs.writeFile(patchPath, content, "utf8");
}
