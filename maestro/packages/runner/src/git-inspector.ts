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
  lastCommits: string;
  capturedAt: string;
  isGitRepo: boolean;
}

export type GitGuardStatus = "CLEAN" | "DIRTY" | "UNTRACKED" | "NOT_GIT_REPO";

export async function inspectGitRepo(repoPath: string): Promise<GitRepoState> {
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
      lastCommits: "",
      capturedAt: new Date().toISOString(),
      isGitRepo: false
    };
  }

  const [branch, head, statusShort, diffStat, lastCommits, untrackedFiles] = await Promise.all([
    runGitSafe(repoPath, ["branch", "--show-current"]),
    runGitSafe(repoPath, ["rev-parse", "HEAD"]),
    runGitSafe(repoPath, ["status", "--short"]),
    getGitDiffStat(repoPath),
    runGitSafe(repoPath, ["log", "-5", "--oneline"]),
    runGitSafe(repoPath, ["ls-files", "--others", "--exclude-standard"]).then(splitLines)
  ]);

  return {
    repoPath,
    branch: branch || null,
    head: head || null,
    statusShort,
    diffStat,
    changedFiles: getTrackedChangedFiles(statusShort),
    untrackedFiles,
    lastCommits,
    capturedAt: new Date().toISOString(),
    isGitRepo: true
  };
}

export async function getGitDiff(repoPath: string): Promise<string> {
  if (!(await checkIsGitRepo(repoPath))) {
    return "NOT_GIT_REPO";
  }

  return runGit(repoPath, ["diff", "--no-ext-diff"]);
}

export async function getGitDiffStat(repoPath: string): Promise<string> {
  if (!(await checkIsGitRepo(repoPath))) {
    return "NOT_GIT_REPO";
  }

  return runGit(repoPath, ["diff", "--stat"]);
}

export async function getChangedFiles(repoPath: string): Promise<string[]> {
  const state = await inspectGitRepo(repoPath);
  return state.changedFiles;
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
