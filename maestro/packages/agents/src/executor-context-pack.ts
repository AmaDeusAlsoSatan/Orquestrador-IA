/**
 * Executor Context Pack
 * 
 * Builds context pack for Patch-Based Executor by collecting relevant files
 * from the workspace before invocation.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Project, RunRecord } from "@maestro/core";

export interface ExecutorContextPackOptions {
  project: Project;
  run: RunRecord;
  workspacePath: string;
  maxBytes?: number;
}

export interface ExecutorContextPack {
  markdown: string;
  filesIncluded: string[];
  totalBytes: number;
  truncated: boolean;
}

/**
 * Build Executor Context Pack
 * 
 * Collects relevant files from workspace and formats them as markdown
 * for inclusion in Executor prompt.
 * 
 * Strategy:
 * 1. Get file tree from workspace
 * 2. Select relevant files based on heuristics
 * 3. Read file contents
 * 4. Format as markdown with file tree + file contents
 * 5. Respect maxBytes limit
 */
export async function buildExecutorContextPack(
  options: ExecutorContextPackOptions
): Promise<ExecutorContextPack> {
  const { project, run, workspacePath, maxBytes = 80000 } = options;
  
  const filesIncluded: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  
  // Get relevant files based on project structure
  const relevantFiles = await selectRelevantFiles(workspacePath, project);
  
  // Build markdown sections
  const sections: string[] = [];
  
  // Add header
  sections.push("# Executor Context Pack\n");
  sections.push("This context pack contains the current state of relevant files in the workspace.\n");
  sections.push("**CRITICAL:** You are patch-based, not tool-based. You cannot read additional files.");
  sections.push("Use only the files provided below to generate your patch.\n");
  
  // Add file tree
  const tree = await getFileTree(workspacePath);
  sections.push("## Repository Structure\n");
  sections.push("```");
  sections.push(tree);
  sections.push("```\n");
  
  // Add file contents
  sections.push("## Relevant Files\n");
  
  for (const relPath of relevantFiles) {
    const fullPath = path.join(workspacePath, relPath);
    
    try {
      const content = await fs.readFile(fullPath, "utf8");
      const fileSection = formatFileSection(relPath, content);
      const sectionBytes = Buffer.byteLength(fileSection, "utf8");
      
      // Check if adding this file would exceed limit
      if (totalBytes + sectionBytes > maxBytes) {
        truncated = true;
        sections.push(`\n*Note: Additional files omitted due to size limit (${maxBytes} bytes)*\n`);
        break;
      }
      
      sections.push(fileSection);
      filesIncluded.push(relPath);
      totalBytes += sectionBytes;
    } catch (error) {
      // File doesn't exist or can't be read, skip it
      continue;
    }
  }
  
  const markdown = sections.join("\n");
  
  return {
    markdown,
    filesIncluded,
    totalBytes,
    truncated
  };
}

/**
 * Select relevant files based on project structure
 * 
 * Uses heuristics to identify files that are likely needed for implementation.
 * Priority order:
 * 1. Core type definitions
 * 2. State management (reducers, actions)
 * 3. Effect system
 * 4. UI components
 * 5. Configuration files
 */
async function selectRelevantFiles(
  workspacePath: string,
  project: Project
): Promise<string[]> {
  const files: string[] = [];
  
  // Detect project structure
  const hasOpcgEngine = await pathExists(path.join(workspacePath, "src/opcg/engine"));
  const hasGameEngine = await pathExists(path.join(workspacePath, "src/game"));
  
  if (hasOpcgEngine) {
    // One Piece TCG structure
    files.push(
      "src/opcg/engine/types.ts",
      "src/opcg/engine/actions.ts",
      "src/opcg/engine/gameReducer.ts",
      "src/opcg/engine/effects/effectCoverage.ts",
      "src/opcg/engine/effects/effectHelpers.ts",
      "src/opcg/engine/effects/effectRegistry.ts",
      "src/opcg/ui/BattleScreen.tsx",
      "src/opcg/ui/CardView.tsx",
      "package.json",
      "tsconfig.json"
    );
  } else if (hasGameEngine) {
    // Generic game structure
    files.push(
      "src/game/state/GameState.ts",
      "src/game/state/gameReducer.ts",
      "src/game/effects/effectRegistry.ts",
      "src/components/GameBoard.tsx",
      "package.json",
      "tsconfig.json"
    );
  } else {
    // Generic TypeScript/JavaScript project
    files.push(
      "src/index.ts",
      "src/index.tsx",
      "src/main.ts",
      "src/main.tsx",
      "src/App.tsx",
      "src/types.ts",
      "package.json",
      "tsconfig.json"
    );
  }
  
  // Filter to only files that actually exist
  const existingFiles: string[] = [];
  for (const file of files) {
    const fullPath = path.join(workspacePath, file);
    if (await pathExists(fullPath)) {
      existingFiles.push(file);
    }
  }
  
  return existingFiles;
}

/**
 * Get file tree from workspace
 * 
 * Returns a simple tree structure showing directory layout
 */
async function getFileTree(workspacePath: string): Promise<string> {
  try {
    // Try to use git ls-files for tracked files
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    
    const { stdout } = await execFileAsync("git", ["ls-files"], {
      cwd: workspacePath,
      maxBuffer: 1024 * 1024
    });
    
    const files = stdout.trim().split(/\r?\n/).filter(Boolean);
    
    // Filter to relevant directories
    const relevantFiles = files.filter((file) => {
      return (
        file.startsWith("src/") ||
        file === "package.json" ||
        file === "tsconfig.json" ||
        file === "README.md"
      );
    });
    
    return relevantFiles.slice(0, 100).join("\n");
  } catch (error) {
    return "(File tree unavailable)";
  }
}

/**
 * Format file section for markdown
 */
function formatFileSection(relPath: string, content: string): string {
  const ext = path.extname(relPath).slice(1);
  const language = getLanguageForExtension(ext);
  
  return `### ${relPath}\n\n\`\`\`${language}\n${content}\n\`\`\`\n`;
}

/**
 * Get language identifier for code fence
 */
function getLanguageForExtension(ext: string): string {
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    yml: "yaml",
    yaml: "yaml"
  };
  
  return languageMap[ext] || ext;
}

/**
 * Check if path exists
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
