/**
 * Patch Extractor
 * 
 * Extracts unified diff patches from agent output for patch-based executor mode.
 */

export interface PatchExtractionResult {
  patch: string | null;
  reason?: string;
  metadata?: {
    diffBlockCount: number;
    filesInPatch: string[];
    extractionMethod: "fenced" | "unfenced" | "none";
  };
}

/**
 * Extract unified diff from agent output
 * 
 * Looks for:
 * 1. Fenced code blocks with diff/patch language
 * 2. Unfenced diff starting with "diff --git"
 * 3. Unified diff markers (---, +++, @@)
 * 
 * Extracts ALL diff blocks and concatenates them into a single patch.
 * 
 * @param output - Agent output text
 * @returns Extracted patch or null if not found, with metadata
 */
export function extractUnifiedDiffFromAgentOutput(output: string): PatchExtractionResult {
  if (!output || output.trim().length === 0) {
    return {
      patch: null,
      reason: "Empty output",
      metadata: {
        diffBlockCount: 0,
        filesInPatch: [],
        extractionMethod: "none"
      }
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
        reason: `Patch appears truncated or malformed: ${truncationCheck.reason}`,
        metadata: {
          diffBlockCount: 0,
          filesInPatch: [],
          extractionMethod: "fenced"
        }
      };
    }
    
    const filesInPatch = extractFilesFromPatch(fencedPatch);
    const diffBlockCount = (fencedPatch.match(/^diff --git/gm) || []).length;
    
    return {
      patch: fencedPatch,
      metadata: {
        diffBlockCount,
        filesInPatch,
        extractionMethod: "fenced"
      }
    };
  }
  
  // Try to extract unfenced diff
  const unfencedPatch = extractUnfencedDiff(output);
  if (unfencedPatch) {
    // Check for truncation
    const truncationCheck = detectPatchTruncation(unfencedPatch);
    if (!truncationCheck.valid) {
      return {
        patch: null,
        reason: `Patch appears truncated or malformed: ${truncationCheck.reason}`,
        metadata: {
          diffBlockCount: 0,
          filesInPatch: [],
          extractionMethod: "unfenced"
        }
      };
    }
    
    const filesInPatch = extractFilesFromPatch(unfencedPatch);
    const diffBlockCount = (unfencedPatch.match(/^diff --git/gm) || []).length;
    
    return {
      patch: unfencedPatch,
      metadata: {
        diffBlockCount,
        filesInPatch,
        extractionMethod: "unfenced"
      }
    };
  }
  
  return {
    patch: null,
    reason: "No unified diff found in output (expected fenced ```diff block or 'diff --git' marker)",
    metadata: {
      diffBlockCount: 0,
      filesInPatch: [],
      extractionMethod: "none"
    }
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
 * 
 * Extracts ALL matching blocks and concatenates them into a single patch.
 * If multiple patches target the same file, keeps only the LAST one.
 */
function extractFromFencedBlock(output: string): string | null {
  // Match fenced code blocks with optional language
  const fencePattern = /```(?:diff|patch)?\s*\n([\s\S]*?)\n```/g;
  const matches = Array.from(output.matchAll(fencePattern));
  
  const patchBlocksByFile = new Map<string, string>();
  
  for (const match of matches) {
    const content = match[1].trim();
    
    // Check if it looks like a unified diff
    if (isUnifiedDiff(content)) {
      // Extract files from this block
      const files = extractFilesFromPatch(content);
      
      // Store by file (last one wins if duplicates)
      for (const file of files) {
        // If this block contains multiple files, we can't deduplicate easily
        // Just store the whole block keyed by first file
        if (files.length === 1) {
          patchBlocksByFile.set(file, content);
        } else {
          // Multi-file block - use a unique key
          patchBlocksByFile.set(`${file}-${match.index}`, content);
        }
      }
    }
  }
  
  if (patchBlocksByFile.size === 0) {
    return null;
  }
  
  // Concatenate all unique patch blocks with double newline separator
  return Array.from(patchBlocksByFile.values()).join("\n\n");
}

/**
 * Extract unfenced diff from output
 * 
 * Looks for content starting with "diff --git" and ending at next section or EOF.
 * Extracts ALL diff blocks and concatenates them.
 */
function extractUnfencedDiff(output: string): string | null {
  const lines = output.split(/\r?\n/);
  const diffBlocks: string[] = [];
  let currentBlockStart = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this is the start of a new diff block
    if (line.startsWith("diff --git")) {
      // If we were already in a block, save it
      if (currentBlockStart !== -1) {
        const blockContent = lines.slice(currentBlockStart, i).join("\n").trim();
        if (isUnifiedDiff(blockContent)) {
          diffBlocks.push(blockContent);
        }
      }
      currentBlockStart = i;
    }
    // Check if we hit a markdown heading (end of diff section)
    else if ((line.startsWith("##") || line.startsWith("# ")) && currentBlockStart !== -1) {
      const blockContent = lines.slice(currentBlockStart, i).join("\n").trim();
      if (isUnifiedDiff(blockContent)) {
        diffBlocks.push(blockContent);
      }
      currentBlockStart = -1;
    }
  }
  
  // Don't forget the last block if we're still in one
  if (currentBlockStart !== -1) {
    const blockContent = lines.slice(currentBlockStart).join("\n").trim();
    if (isUnifiedDiff(blockContent)) {
      diffBlocks.push(blockContent);
    }
  }
  
  if (diffBlocks.length === 0) {
    return null;
  }
  
  // Concatenate all diff blocks with double newline separator
  return diffBlocks.join("\n\n");
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
 * Extract file paths from a unified diff patch
 * 
 * Looks for "diff --git a/path b/path" lines and extracts the path
 */
function extractFilesFromPatch(patch: string): string[] {
  const files: string[] = [];
  const diffGitPattern = /^diff --git a\/(.+?) b\/\1$/gm;
  
  let match;
  while ((match = diffGitPattern.exec(patch)) !== null) {
    files.push(match[1]);
  }
  
  return files;
}

/**
 * Extract files listed by executor in "## Arquivos Alterados" section
 * 
 * Looks for markdown list items after the section heading
 */
export function extractFilesListedByExecutor(output: string): string[] {
  const files: string[] = [];
  
  // Look for "## Arquivos Alterados" or "## Arquivos alterados" or similar
  const sectionPattern = /##\s+Arquivos\s+[Aa]lterados\s*\n([\s\S]*?)(?=\n##|\n```|$)/i;
  const match = output.match(sectionPattern);
  
  if (!match) {
    return files;
  }
  
  const sectionContent = match[1];
  
  // Extract file paths from markdown list items
  // Matches: - path/to/file.ts or * path/to/file.ts or - `path/to/file.ts`
  const filePattern = /^[\s-*]+`?([^\s`]+\.[a-z]+)`?/gm;
  
  let fileMatch;
  while ((fileMatch = filePattern.exec(sectionContent)) !== null) {
    files.push(fileMatch[1]);
  }
  
  return files;
}

/**
 * Validate that all files listed by executor are present in the extracted patch
 * 
 * @param output - Full executor output
 * @param patch - Extracted patch
 * @returns Validation result with missing files if any
 */
export function validatePatchCompleteness(output: string, patch: string): {
  complete: boolean;
  filesListed: string[];
  filesInPatch: string[];
  missingFiles: string[];
} {
  const filesListed = extractFilesListedByExecutor(output);
  const filesInPatch = extractFilesFromPatch(patch);
  
  // If executor didn't list files, we can't validate
  if (filesListed.length === 0) {
    return {
      complete: true,
      filesListed: [],
      filesInPatch,
      missingFiles: []
    };
  }
  
  // Check which files are missing
  const missingFiles = filesListed.filter(file => !filesInPatch.includes(file));
  
  return {
    complete: missingFiles.length === 0,
    filesListed,
    filesInPatch,
    missingFiles
  };
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
