import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { RunWorkspace } from "@maestro/core";
import { getGitDiff, inspectGitRepo, type GitRepoState } from "./git-inspector";

const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".vite",
  ".turbo",
  "out",
  "target",
  "vendor",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development"
]);

export interface CreateWorkspaceOptions {
  projectId: string;
  runId: string;
  sourceRepoPath: string;
  workspacePath: string;
}

interface IgnoredFile {
  path: string;
  reason: string;
  sizeBytes?: number;
}

export async function createRunWorkspace(options: CreateWorkspaceOptions): Promise<RunWorkspace> {
  const sourceRepoPath = path.resolve(options.sourceRepoPath);
  const workspacePath = path.resolve(options.workspacePath);
  const sourceStats = await fs.stat(sourceRepoPath).catch(() => undefined);

  if (!sourceStats?.isDirectory()) {
    throw new Error(`Source repository path does not exist or is not a directory: ${sourceRepoPath}`);
  }

  await fs.mkdir(workspacePath, { recursive: true });
  const ignoredFiles: IgnoredFile[] = [];

  await copyDirectory(sourceRepoPath, workspacePath, sourceRepoPath, ignoredFiles);

  const maestroDir = path.join(workspacePath, ".maestro");
  await fs.mkdir(maestroDir, { recursive: true });
  await fs.writeFile(path.join(maestroDir, "ignored-files.md"), renderIgnoredFiles(ignoredFiles), "utf8");
  await fs.writeFile(path.join(maestroDir, "README-MAESTRO-WORKSPACE.md"), renderWorkspaceReadme(options), "utf8");

  const baselineCommit = await initializeWorkspaceGit(workspacePath);
  await excludeWorkspaceMetadataFromGit(workspacePath);
  const now = new Date().toISOString();
  const workspace: RunWorkspace = {
    id: `${options.projectId}-${options.runId}`,
    runId: options.runId,
    projectId: options.projectId,
    sourceRepoPath,
    workspacePath,
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

async function copyDirectory(
  sourceDir: string,
  targetDir: string,
  sourceRoot: string,
  ignoredFiles: IgnoredFile[]
): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const relativePath = normalizeRelativePath(path.relative(sourceRoot, sourcePath));

    if (shouldIgnoreName(entry.name)) {
      ignoredFiles.push({ path: relativePath, reason: "ignored pattern" });
      continue;
    }

    if (entry.isSymbolicLink()) {
      ignoredFiles.push({ path: relativePath, reason: "symbolic link ignored for sandbox safety" });
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, sourceRoot, ignoredFiles);
      continue;
    }

    if (!entry.isFile()) {
      ignoredFiles.push({ path: relativePath, reason: "non-regular file ignored" });
      continue;
    }

    if (entry.name.toLowerCase().endsWith(".log")) {
      ignoredFiles.push({ path: relativePath, reason: "log file ignored" });
      continue;
    }

    const stats = await fs.stat(sourcePath);
    if (stats.size > MAX_FILE_BYTES) {
      ignoredFiles.push({ path: relativePath, reason: "file exceeds 10 MB limit", sizeBytes: stats.size });
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

async function initializeWorkspaceGit(workspacePath: string): Promise<string | undefined> {
  try {
    await runGit(workspacePath, ["init"]);
    await runGit(workspacePath, ["config", "user.name", "Maestro Sandbox"]);
    await runGit(workspacePath, ["config", "user.email", "maestro-sandbox@example.local"]);
    await runGit(workspacePath, ["config", "core.longpaths", "true"]);
    await runGit(workspacePath, ["add", "."]);
    await runGit(workspacePath, ["commit", "-m", "maestro sandbox baseline"]);
    return (await runGit(workspacePath, ["rev-parse", "HEAD"])).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function excludeWorkspaceMetadataFromGit(workspacePath: string): Promise<void> {
  const line = ".maestro/workspace-metadata.json";
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

function shouldIgnoreName(name: string): boolean {
  return IGNORED_NAMES.has(name) || name.toLowerCase().endsWith(".log");
}

function renderIgnoredFiles(ignoredFiles: IgnoredFile[]): string {
  const lines = ["# Ignored Files", ""];

  if (ignoredFiles.length === 0) {
    lines.push("- none", "");
    return lines.join("\n");
  }

  for (const file of ignoredFiles) {
    const size = file.sizeBytes === undefined ? "" : ` | ${file.sizeBytes} bytes`;
    lines.push(`- ${file.path} | ${file.reason}${size}`);
  }

  lines.push("");
  return lines.join("\n");
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

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}
