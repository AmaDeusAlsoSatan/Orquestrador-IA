import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitRepoState {
  repoPath: string;
  branch: string | null;
  head: string | null;
  statusShort: string;
  diffStat: string;
  changedFiles: string[];
  untrackedFiles: string[];
  untrackedFilesIncludedInDiff: boolean;
  lastCommits: string;
  capturedAt: string;
  isGitRepo: boolean;
}

export type GitGuardStatus = "CLEAN" | "DIRTY" | "UNTRACKED" | "NOT_GIT_REPO";

export interface GitDiffOptions {
  includeUntracked?: boolean;
}

export async function inspectGitRepo(repoPath: string, options: GitDiffOptions = {}): Promise<GitRepoState> {
  const isGitRepo = await checkIsGitRepo(repoPath);

  if (!isGitRepo) {
    return {
      repoPath,
      branch: null,
      head: null,
      statusShort: "NOT_GIT_REPO",
      diffStat: "",
      changedFiles: [],
      untrackedFiles: [],
      untrackedFilesIncludedInDiff: false,
      lastCommits: "",
      capturedAt: new Date().toISOString(),
      isGitRepo: false
    };
  }

  const untrackedFiles = await getUntrackedFiles(repoPath);
  if (options.includeUntracked) {
    await includeUntrackedFilesInGitDiff(repoPath, untrackedFiles);
  }

  const [branch, head, statusShort, diffStat, lastCommits, intentToAddFiles] = await Promise.all([
    runGitSafe(repoPath, ["branch", "--show-current"]),
    runGitSafe(repoPath, ["rev-parse", "HEAD"]),
    runGitSafe(repoPath, ["status", "--short"]),
    getGitDiffStat(repoPath),
    runGitSafe(repoPath, ["log", "-5", "--oneline"]),
    runGitSafe(repoPath, ["diff", "--name-only", "--diff-filter=A"]).then(splitLines)
  ]);

  return {
    repoPath,
    branch: branch || null,
    head: head || null,
    statusShort,
    diffStat,
    changedFiles: getTrackedChangedFiles(statusShort),
    untrackedFiles,
    untrackedFilesIncludedInDiff: Boolean(options.includeUntracked && (untrackedFiles.length > 0 || intentToAddFiles.length > 0)),
    lastCommits,
    capturedAt: new Date().toISOString(),
    isGitRepo: true
  };
}

export async function getGitDiff(repoPath: string, options: GitDiffOptions = {}): Promise<string> {
  if (!(await checkIsGitRepo(repoPath))) {
    return "NOT_GIT_REPO";
  }

  if (options.includeUntracked) {
    await includeUntrackedFilesInGitDiff(repoPath);
  }

  return runGit(repoPath, ["diff", "--no-ext-diff", "--binary"]);
}

export async function getGitDiffStat(repoPath: string, options: GitDiffOptions = {}): Promise<string> {
  if (!(await checkIsGitRepo(repoPath))) {
    return "NOT_GIT_REPO";
  }

  if (options.includeUntracked) {
    await includeUntrackedFilesInGitDiff(repoPath);
  }

  return runGit(repoPath, ["diff", "--stat"]);
}

export async function getChangedFiles(repoPath: string, options: GitDiffOptions = {}): Promise<string[]> {
  const state = await inspectGitRepo(repoPath, options);
  return state.changedFiles;
}

export async function includeUntrackedFilesInGitDiff(repoPath: string, untrackedFiles?: string[]): Promise<string[]> {
  if (!(await checkIsGitRepo(repoPath))) {
    return [];
  }

  const files = untrackedFiles ?? await getUntrackedFiles(repoPath);

  if (files.length === 0) {
    return [];
  }

  await runGit(repoPath, ["add", "-N", "--", ...files]);
  return files;
}

export function getGitGuardStatus(state: GitRepoState): GitGuardStatus {
  if (!state.isGitRepo) {
    return "NOT_GIT_REPO";
  }

  if (state.changedFiles.length > 0 || state.diffStat.trim()) {
    return "DIRTY";
  }

  if (state.untrackedFiles.length > 0) {
    return "UNTRACKED";
  }

  return "CLEAN";
}

function getTrackedChangedFiles(statusShort: string): string[] {
  return splitStatusLines(statusShort)
    .filter((line) => !line.startsWith("??"))
    .map((line) => line.slice(3).trim())
    .map((fileName) => {
      const renameParts = fileName.split(" -> ");
      return renameParts[renameParts.length - 1] || fileName;
    })
    .filter(Boolean);
}

async function checkIsGitRepo(repoPath: string): Promise<boolean> {
  try {
    const output = await runGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    return output.trim() === "true";
  } catch {
    return false;
  }
}

async function getUntrackedFiles(repoPath: string): Promise<string[]> {
  return runGitSafe(repoPath, ["ls-files", "--others", "--exclude-standard"]).then(splitLines);
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd: repoPath,
    maxBuffer: 2 * 1024 * 1024
  });

  return result.stdout.replace(/\r?\n$/u, "");
}

async function runGitSafe(repoPath: string, args: string[]): Promise<string> {
  try {
    return await runGit(repoPath, args);
  } catch {
    return "";
  }
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitStatusLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
}
