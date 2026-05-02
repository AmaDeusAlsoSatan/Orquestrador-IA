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
    // Check for truncation
    const truncationCheck = detectPatchTruncation(fencedPatch);
    if (!truncationCheck.valid) {
      return {
        patch: null,
        reason: `Patch appears truncated or malformed: ${truncationCheck.reason}`
      };
    }
    return { patch: fencedPatch };
  }
  
  // Try to extract unfenced diff
  const unfencedPatch = extractUnfencedDiff(output);
  if (unfencedPatch) {
    // Check for truncation
    const truncationCheck = detectPatchTruncation(unfencedPatch);
    if (!truncationCheck.valid) {
      return {
        patch: null,
        reason: `Patch appears truncated or malformed: ${truncationCheck.reason}`
      };
    }
    return { patch: unfencedPatch };
  }
  
  return {
    patch: null,
    reason: "No unified diff found in output (expected fenced ```diff block or 'diff --git' marker)"
  };
}

/**
 * Detect if patch appears truncated or malformed
 * 
 * Checks for:
 * - Incomplete hunks (@@  without closing context)
 * - Lines ending mid-statement (export, const, function without completion)
 * - Unclosed fenced blocks (``` at start but not at end)
 * - File headers without content
 */
function detectPatchTruncation(patch: string): { valid: boolean; reason?: string } {
  const lines = patch.split(/\r?\n/);
  
  // Check for unclosed fenced block
  if (patch.startsWith("```") && !patch.trim().endsWith("```")) {
    return {
      valid: false,
      reason: "Patch starts with ``` but doesn't end with ``` (unclosed fence)"
    };
  }
  
  // Check for incomplete hunks
  let inHunk = false;
  let hunkHasContent = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith("@@")) {
      if (inHunk && !hunkHasContent) {
        return {
          valid: false,
          reason: `Hunk at line ${i} has no content (possible truncation)`
        };
      }
      inHunk = true;
      hunkHasContent = false;
    } else if (inHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      hunkHasContent = true;
    }
  }
  
  // Check last line for incomplete statements
  const lastLine = lines[lines.length - 1].trim();
  const incompletePatterns = [
    /^[+-]\s*(export|import|const|let|var|function|class|interface|type)\s+\w+\s*$/,
    /^[+-]\s*\w+\s*:\s*$/,
    /^[+-]\s*\{$/,
    /^[+-]\s*\[$/,
    /^[+-]\s*\($/,
  ];
  
  for (const pattern of incompletePatterns) {
    if (pattern.test(lastLine)) {
      return {
        valid: false,
        reason: `Last line appears incomplete: "${lastLine}" (possible truncation)`
      };
    }
  }
  
  // Check for file headers without content
  let hasFileHeader = false;
  let hasHunkMarker = false;
  
  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("---") || line.startsWith("+++")) {
      hasFileHeader = true;
    }
    if (line.startsWith("@@")) {
      hasHunkMarker = true;
    }
  }
  
  if (hasFileHeader && !hasHunkMarker) {
    return {
      valid: false,
      reason: "Patch has file headers but no hunk markers (incomplete patch)"
    };
  }
  
  return { valid: true };
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
