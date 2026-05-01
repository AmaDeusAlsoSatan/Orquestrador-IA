import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { includeUntrackedFilesInGitDiff } from "./git-inspector";

const execFileAsync = promisify(execFile);

export interface ExportPatchOptions {
  runId: string;
  projectId: string;
  workspacePath: string;
  outPath: string;
  baselineCommit?: string;
}

export interface CheckPatchOptions {
  targetRepoPath: string;
  patchPath: string;
}

export interface CheckPatchResult {
  ok: boolean;
  output: string;
}

export interface InspectPatchOptions {
  patchPath: string;
}

export interface InspectPatchResult {
  filesChanged: string[];
  additions: number;
  deletions: number;
  sizeBytes: number;
}

export async function exportWorkspacePatch(options: ExportPatchOptions): Promise<void> {
  const { workspacePath, outPath, baselineCommit } = options;

  await includeUntrackedFilesInGitDiff(workspacePath);

  const args = baselineCommit
    ? ["diff", "--binary", baselineCommit]
    : ["diff", "--binary", "HEAD"];

  const result = await execFileAsync("git", args, {
    cwd: workspacePath,
    maxBuffer: 10 * 1024 * 1024
  });

  const patch = result.stdout;

  if (!patch.trim()) {
    throw new Error("No changes detected in workspace. Patch is empty.");
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, patch, "utf8");
}

export async function checkPatchApplies(options: CheckPatchOptions): Promise<CheckPatchResult> {
  const { targetRepoPath, patchPath } = options;

  try {
    const result = await execFileAsync("git", ["apply", "--check", patchPath], {
      cwd: targetRepoPath,
      maxBuffer: 2 * 1024 * 1024
    });

    return {
      ok: true,
      output: result.stdout || result.stderr || "Patch applies cleanly."
    };
  } catch (error: any) {
    return {
      ok: false,
      output: error.stderr || error.stdout || error.message || "Patch does not apply."
    };
  }
}

export async function inspectPatch(options: InspectPatchOptions): Promise<InspectPatchResult> {
  const { patchPath } = options;

  const content = await fs.readFile(patchPath, "utf8");
  const stats = await fs.stat(patchPath);
  const lines = content.split(/\r?\n/);

  const filesChanged = new Set<string>();
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      if (match) {
        filesChanged.add(match[2]);
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }

  return {
    filesChanged: Array.from(filesChanged),
    additions,
    deletions,
    sizeBytes: stats.size
  };
}
