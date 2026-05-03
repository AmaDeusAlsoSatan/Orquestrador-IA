/**
 * Full File Replacement
 * 
 * When unified diff generation fails, ask the model to return complete file contents
 * and generate the diff locally. This is more robust than asking the model to fix
 * corrupt patch hunks.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { runCapturedCommand } from "@maestro/providers";

export interface FileReplacement {
  path: string;
  content: string;
}

export interface ExtractFileReplacementsResult {
  success: boolean;
  files: FileReplacement[];
  reason?: string;
}

/**
 * Extract FILE blocks from model output
 * 
 * Expected format:
 * ## FILE: src/path/to/file.ts
 * ```typescript
 * <complete file content>
 * ```
 * 
 * ## FILE: another/file.ts
 * ```typescript
 * <complete file content>
 * ```
 */
export function extractFileReplacements(output: string): ExtractFileReplacementsResult {
  const files: FileReplacement[] = [];
  
  // Match FILE blocks with optional language specifier
  const fileBlockPattern = /##\s*FILE:\s*([^\n]+)\s*\n```(?:\w+)?\s*\n([\s\S]*?)\n```/g;
  
  let match: RegExpExecArray | null;
  while ((match = fileBlockPattern.exec(output)) !== null) {
    const filePath = match[1].trim();
    const content = match[2];
    
    // Validate path
    if (path.isAbsolute(filePath)) {
      return {
        success: false,
        files: [],
        reason: `Absolute path not allowed: ${filePath}`
      };
    }
    
    if (filePath.includes("..")) {
      return {
        success: false,
        files: [],
        reason: `Path traversal not allowed: ${filePath}`
      };
    }
    
    if (!content || content.trim().length === 0) {
      return {
        success: false,
        files: [],
        reason: `Empty content for file: ${filePath}`
      };
    }
    
    files.push({
      path: filePath,
      content
    });
  }
  
  if (files.length === 0) {
    return {
      success: false,
      files: [],
      reason: "No FILE blocks found in output"
    };
  }
  
  // Limit number of files
  if (files.length > 6) {
    return {
      success: false,
      files: [],
      reason: `Too many files (${files.length}). Maximum is 6. Consider reducing scope.`
    };
  }
  
  // Limit total size (1MB)
  const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, "utf8"), 0);
  if (totalBytes > 1024 * 1024) {
    return {
      success: false,
      files: [],
      reason: `Total content too large (${Math.round(totalBytes / 1024)}KB). Maximum is 1MB.`
    };
  }
  
  return {
    success: true,
    files
  };
}

/**
 * Apply file replacements to workspace and generate diff
 */
export async function applyFileReplacementsAndGenerateDiff(
  workspacePath: string,
  files: FileReplacement[]
): Promise<{
  success: boolean;
  diff?: string;
  reason?: string;
}> {
  try {
    // Write files to workspace
    for (const file of files) {
      const fullPath = path.join(workspacePath, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, "utf8");
    }
    
    // Generate diff using git
    const diffResult = await runCapturedCommand("git", ["diff", "--binary"], {
      cwd: workspacePath,
      timeoutMs: 30000
    });
    
    if (diffResult.exitCode !== 0) {
      return {
        success: false,
        reason: `git diff failed: ${diffResult.stderr}`
      };
    }
    
    const diff = diffResult.stdout.trim();
    
    if (!diff) {
      return {
        success: false,
        reason: "No changes detected after writing files (git diff is empty)"
      };
    }
    
    return {
      success: true,
      diff
    };
  } catch (error) {
    return {
      success: false,
      reason: `Failed to apply files: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Build full-file replacement prompt
 */
export function buildFullFileReplacementPrompt(options: {
  originalPrompt: string;
  contextPackMarkdown: string;
  previousOutput: string;
  previousPatch: string;
  applyCheckError: string;
  repairOutput?: string;
  repairError?: string;
}): string {
  const {
    originalPrompt,
    contextPackMarkdown,
    previousOutput,
    previousPatch,
    applyCheckError,
    repairOutput,
    repairError
  } = options;
  
  return `# Full File Replacement Recovery Task

## Critical Instructions

The previous unified diff was **STRUCTURALLY INVALID** and could not be repaired.

**Do not return a unified diff. Do not return a patch.**

Instead, return **complete replacement contents** for each changed file using this exact format:

## FILE: path/to/file.ts
\`\`\`typescript
<complete file content>
\`\`\`

## FILE: another/path.ts
\`\`\`typescript
<complete file content>
\`\`\`

---

## Rules

1. Use only relative paths (no absolute paths, no \`C:\\\`, no \`/home/\`)
2. Only include files that must change
3. Include the **full complete file content** (not just changed sections)
4. Do not include explanations outside FILE blocks
5. Prefer changing at most 3 files
6. If more than 3 files are required, return BLOCKED with missing plan

---

## Previous Failure Context

### Git Apply Error (Original Patch)

\`\`\`
${applyCheckError}
\`\`\`

### Previous Patch (INVALID)

\`\`\`diff
${previousPatch}
\`\`\`

${repairOutput ? `
### Repair Attempt Output

${repairOutput}

### Repair Error

\`\`\`
${repairError}
\`\`\`
` : ""}

---

## Previous Output

${previousOutput}

---

${contextPackMarkdown}

---

## Your Task

Return complete file contents in FILE blocks as shown above.

The orchestrator will:
1. Write your files to the workspace
2. Generate the unified diff locally using \`git diff\`
3. Validate the changes

Do not return a diff. Return complete files.
`;
}
