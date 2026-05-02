import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { RunWorkspace } from "@maestro/core";
import { getGitDiff, inspectGitRepo, type GitRepoState } from "./git-inspector";

const execFileAsync = promisify(execFile);

export interface CreateWorkspaceOptions {
  projectId: string;
  runId: string;
  sourceRepoPath: string;
  workspacePath: string;
}

export async function createRunWorkspace(options: CreateWorkspaceOptions): Promise<RunWorkspace> {
  const sourceRepoPath = path.resolve(options.sourceRepoPath);
  const workspacePath = path.resolve(options.workspacePath);
  
  // Verify source is a directory
  const sourceStats = await fs.stat(sourceRepoPath).catch(() => undefined);
  if (!sourceStats?.isDirectory()) {
    throw new Error(`Source repository path does not exist or is not a directory: ${sourceRepoPath}`);
  }

  // Find Git repository root
  let gitRoot: string;
  try {
    gitRoot = (await runGit(sourceRepoPath, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    throw new Error(`Source repository is not inside a Git repository: ${sourceRepoPath}`);
  }

  // Check if workspace already exists
  const workspaceExists = await fs.stat(workspacePath).catch(() => undefined);
  if (workspaceExists) {
    throw new Error(`Workspace path already exists: ${workspacePath}`);
  }

  // Create workspace parent directory
  await fs.mkdir(path.dirname(workspacePath), { recursive: true });

  // Clone repository using git clone --local --no-hardlinks from Git root
  // This is fast and only copies versioned files (no node_modules, dist, data/, etc.)
  await runGit(path.dirname(workspacePath), [
    "clone",
    "--local",
    "--no-hardlinks",
    "--single-branch",
    gitRoot,
    path.basename(workspacePath)
  ]);

  // If source is a subdirectory of the Git root, we need to note that
  // The workspace will contain the full repository, but we'll work in the subdirectory
  const relativeSourcePath = path.relative(gitRoot, sourceRepoPath);
  const effectiveWorkspacePath = relativeSourcePath
    ? path.join(workspacePath, relativeSourcePath)
    : workspacePath;

  // Configure workspace Git
  await runGit(workspacePath, ["config", "user.name", "Maestro Sandbox"]);
  await runGit(workspacePath, ["config", "user.email", "maestro-sandbox@example.local"]);
  await runGit(workspacePath, ["config", "core.longpaths", "true"]);

  // Get baseline commit
  const baselineCommit = (await runGit(workspacePath, ["rev-parse", "HEAD"])).trim() || undefined;

  // Create Maestro metadata directory in the effective workspace path
  const maestroDir = path.join(effectiveWorkspacePath, ".maestro");
  await fs.mkdir(maestroDir, { recursive: true });
  await fs.writeFile(path.join(maestroDir, "README-MAESTRO-WORKSPACE.md"), renderWorkspaceReadme(options), "utf8");

  // Exclude metadata from Git
  await excludeWorkspaceMetadataFromGit(workspacePath);

  const now = new Date().toISOString();
  const workspace: RunWorkspace = {
    id: `${options.projectId}-${options.runId}`,
    runId: options.runId,
    projectId: options.projectId,
    sourceRepoPath,
    workspacePath: effectiveWorkspacePath, // Use effective path for subdirectory projects
    status: "CREATED",
    createdAt: now,
    updatedAt: now,
    baselineCommit
  };

  await fs.writeFile(path.join(maestroDir, "workspace-metadata.json"), `${JSON.stringify(workspace, null, 2)}\n`, "utf8");

  return workspace;
}

export async function inspectRunWorkspace(workspacePath: string): Promise<GitRepoState> {
  return inspectGitRepo(workspacePath, { includeUntracked: true });
}

export async function getRunWorkspaceDiff(workspacePath: string): Promise<string> {
  return getGitDiff(workspacePath, { includeUntracked: true });
}

export async function createRunWorkspacePatch(workspacePath: string, outPath: string): Promise<void> {
  const diff = await getRunWorkspaceDiff(workspacePath);
  await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await fs.writeFile(path.resolve(outPath), diff.endsWith("\n") ? diff : `${diff}\n`, "utf8");
}

async function excludeWorkspaceMetadataFromGit(workspacePath: string): Promise<void> {
  const line = ".maestro/";
  const excludePath = path.join(workspacePath, ".git", "info", "exclude");

  try {
    const current = await fs.readFile(excludePath, "utf8").catch(() => "");
    const entries = current.split(/\r?\n/u);

    if (entries.includes(line)) {
      return;
    }

    const prefix = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    await fs.appendFile(excludePath, `${prefix}${line}\n`, "utf8");
  } catch {
    // If Git initialization failed, the metadata file can remain untracked.
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 4 * 1024 * 1024
  });
  return result.stdout.replace(/\r?\n$/u, "");
}

function renderWorkspaceReadme(options: CreateWorkspaceOptions): string {
  return `# Maestro Run Workspace

This directory is a disposable sandbox copy created by Maestro.

- Project: ${options.projectId}
- Run: ${options.runId}
- Source repository: ${path.resolve(options.sourceRepoPath)}

## Rules

- Work only inside this workspace.
- Do not modify the original repository.
- Maestro captures the execution diff from this sandbox.
- Applying changes back to the original repository is a future explicit approval step.
`;
}
