/**
 * Patch Extractor
 * 
 * Extracts unified diff patches from agent output for patch-based executor mode.
 */

export interface PatchExtractionResult {
  patch: string | null;
  reason?: string;
}

/**
 * Extract unified diff from agent output
 * 
 * Looks for:
 * 1. Fenced code blocks with diff/patch language
 * 2. Unfenced diff starting with "diff --git"
 * 3. Unified diff markers (---, +++, @@)
 * 
 * @param output - Agent output text
 * @returns Extracted patch or null if not found
 */
export function extractUnifiedDiffFromAgentOutput(output: string): PatchExtractionResult {
  if (!output || output.trim().length === 0) {
    return {
      patch: null,
      reason: "Empty output"
    };
  }
  
  // Try to extract from fenced code block first
  const fencedPatch = extractFromFencedBlock(output);
  if (fencedPatch) {
    return { patch: fencedPatch };
  }
  
  // Try to extract unfenced diff
  const unfencedPatch = extractUnfencedDiff(output);
  if (unfencedPatch) {
    return { patch: unfencedPatch };
  }
  
  return {
    patch: null,
    reason: "No unified diff found in output (expected fenced ```diff block or 'diff --git' marker)"
  };
}

/**
 * Extract patch from fenced code block
 * 
 * Looks for:
 * - ```diff ... ```
 * - ```patch ... ```
 * - ``` ... ``` containing "diff --git"
 */
function extractFromFencedBlock(output: string): string | null {
  // Match fenced code blocks with optional language
  const fencePattern = /```(?:diff|patch)?\s*\n([\s\S]*?)\n```/g;
  const matches = Array.from(output.matchAll(fencePattern));
  
  for (const match of matches) {
    const content = match[1].trim();
    
    // Check if it looks like a unified diff
    if (isUnifiedDiff(content)) {
      return content;
    }
  }
  
  return null;
}

/**
 * Extract unfenced diff from output
 * 
 * Looks for content starting with "diff --git" and ending at next section or EOF
 */
function extractUnfencedDiff(output: string): string | null {
  const lines = output.split(/\r?\n/);
  let diffStart = -1;
  let diffEnd = -1;
  
  // Find start of diff
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("diff --git")) {
      diffStart = i;
      break;
    }
  }
  
  if (diffStart === -1) {
    return null;
  }
  
  // Find end of diff (next markdown heading or EOF)
  for (let i = diffStart + 1; i < lines.length; i++) {
    if (lines[i].startsWith("##") || lines[i].startsWith("# ")) {
      diffEnd = i;
      break;
    }
  }
  
  if (diffEnd === -1) {
    diffEnd = lines.length;
  }
  
  const diffContent = lines.slice(diffStart, diffEnd).join("\n").trim();
  
  if (isUnifiedDiff(diffContent)) {
    return diffContent;
  }
  
  return null;
}

/**
 * Check if content looks like a unified diff
 * 
 * Must contain:
 * - "diff --git" OR
 * - Both "---" and "+++" lines AND "@@" hunk markers
 */
function isUnifiedDiff(content: string): boolean {
  if (!content || content.trim().length === 0) {
    return false;
  }
  
  const hasDiffGit = content.includes("diff --git");
  const hasMinusMinus = content.includes("---");
  const hasPlusPlus = content.includes("+++");
  const hasHunkMarker = content.includes("@@");
  
  return hasDiffGit || (hasMinusMinus && hasPlusPlus && hasHunkMarker);
}

/**
 * Validate that patch is safe to apply
 * 
 * Checks:
 * - No absolute paths
 * - No suspicious commands
 * - Valid unified diff format
 */
export function validatePatchSafety(patch: string): { safe: boolean; reason?: string } {
  if (!patch || patch.trim().length === 0) {
    return { safe: false, reason: "Empty patch" };
  }
  
  // Check for absolute paths (security risk)
  const absolutePathPattern = /^[a-zA-Z]:[\\\/]|^\/[^\/]/m;
  if (absolutePathPattern.test(patch)) {
    return {
      safe: false,
      reason: "Patch contains absolute paths (security risk)"
    };
  }
  
  // Check for suspicious content
  const suspiciousPatterns = [
    /\$\(.*\)/,  // Command substitution
    /`.*`/,      // Backticks
    /eval\s*\(/,  // eval
    /exec\s*\(/,  // exec
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(patch)) {
      return {
        safe: false,
        reason: "Patch contains suspicious content (possible command injection)"
      };
    }
  }
  
  // Check that it looks like a valid unified diff
  if (!isUnifiedDiff(patch)) {
    return {
      safe: false,
      reason: "Patch does not appear to be a valid unified diff"
    };
  }
  
  return { safe: true };
}
