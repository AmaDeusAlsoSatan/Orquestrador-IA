import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getMaestroPaths, type Project } from "@maestro/core";

const execFileAsync = promisify(execFile);

const IMPORTANT_FILES = ["package.json", "README.md", "tsconfig.json"];
const IMPORTANT_DIRECTORIES = ["src", "tests", "docs"];
const IGNORED_TREE_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor"
]);
const MAX_TREE_DEPTH = 4;
const MAX_TREE_ENTRIES = 250;
const MAX_TREE_FILE_SIZE_BYTES = 1024 * 1024;

export interface PackageJsonInfo {
  name: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface RepositorySnapshot {
  project: Project;
  repoPath: string;
  capturedAt: string;
  detectedFiles: string[];
  detectedDirectories: string[];
  packageJson?: PackageJsonInfo;
  branch: string;
  gitStatus: string;
  recentCommits: string;
  tree: string[];
  topLevelDirectories: string[];
  entryPoints: string[];
  centralFiles: string[];
  stack: string[];
  risksAndQuestions: string[];
  nextFilesToRead: string[];
}

export async function createRepositorySnapshot(homeDir: string, project: Project): Promise<RepositorySnapshot> {
  const repoPath = path.resolve(project.repoPath);
  const repoStats = await fs.stat(repoPath).catch(() => undefined);

  if (!repoStats?.isDirectory()) {
    throw new Error(`Repository path does not exist or is not a directory: ${repoPath}`);
  }

  const detectedFiles = await detectImportantFiles(repoPath);
  const detectedDirectories = await detectImportantDirectories(repoPath);
  const packageJson = detectedFiles.includes("package.json") ? await readPackageJson(path.join(repoPath, "package.json")) : undefined;
  const branch = await runGitReadOnly(repoPath, ["branch", "--show-current"]);
  const gitStatus = await runGitReadOnly(repoPath, ["status", "--short"]);
  const recentCommits = await runGitReadOnly(repoPath, ["log", "-5", "--oneline"]);
  const normalizedGitStatus = gitStatus || "limpo";
  const tree = await buildTree(repoPath);
  const topLevelDirectories = await readTopLevelDirectories(repoPath);
  const entryPoints = await detectEntryPoints(repoPath);
  const centralFiles = await detectCentralFiles(repoPath);
  const stack = detectStack(project, packageJson, detectedFiles);
  const risksAndQuestions = detectRisksAndQuestions({
    detectedFiles,
    detectedDirectories,
    packageJson,
    gitStatus: normalizedGitStatus,
    entryPoints
  });
  const nextFilesToRead = [...new Set([...centralFiles, ...entryPoints, "src"].filter(Boolean))];

  const snapshot: RepositorySnapshot = {
    project,
    repoPath,
    capturedAt: new Date().toISOString(),
    detectedFiles,
    detectedDirectories,
    packageJson,
    branch: branch || "nao detectado",
    gitStatus: normalizedGitStatus,
    recentCommits: recentCommits || "nao detectado",
    tree,
    topLevelDirectories,
    entryPoints,
    centralFiles,
    stack,
    risksAndQuestions,
    nextFilesToRead
  };

  await writeSnapshotDocuments(homeDir, snapshot);
  return snapshot;
}

async function writeSnapshotDocuments(homeDir: string, snapshot: RepositorySnapshot): Promise<void> {
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, snapshot.project.id);

  await fs.mkdir(projectVaultDir, { recursive: true });
  await fs.writeFile(path.join(projectVaultDir, "08-repo-snapshot.md"), renderRepoSnapshot(snapshot), "utf8");
  await fs.writeFile(path.join(projectVaultDir, "09-dev-scripts.md"), renderDevScripts(snapshot), "utf8");
  await fs.writeFile(path.join(projectVaultDir, "10-technical-map.md"), renderTechnicalMap(snapshot), "utf8");
}

function renderRepoSnapshot(snapshot: RepositorySnapshot): string {
  return `# Repository Snapshot

## Snapshot

- Captured at: ${snapshot.capturedAt}
- Repository path: ${snapshot.repoPath}
- Branch: ${snapshot.branch}

## Recent Commits

${asCodeBlock(snapshot.recentCommits)}

## Git Status

${asCodeBlock(snapshot.gitStatus)}

## Detected Important Files

${asList(snapshot.detectedFiles)}

## Detected Important Directories

${asList(snapshot.detectedDirectories)}

## File Tree

${asCodeBlock(snapshot.tree.length > 0 ? snapshot.tree.join("\n") : "nao detectado")}
`;
}

function renderDevScripts(snapshot: RepositorySnapshot): string {
  const packageJson = snapshot.packageJson;
  const scripts = packageJson?.scripts ?? {};

  return `# Dev Scripts

## Package

- Name: ${packageJson?.name || "nao detectado"}

## Scripts

${asKeyValueList(scripts)}

## Dependencies

${asKeyValueList(packageJson?.dependencies ?? {})}

## Dev Dependencies

${asKeyValueList(packageJson?.devDependencies ?? {})}

## Likely Commands

- Dev: ${scripts.dev || "nao detectado"}
- Build: ${scripts.build || "nao detectado"}
- Test: ${scripts.test || "nao detectado"}

## Observations

${packageJson ? "- package.json detected and parsed." : "- package.json nao detectado."}
`;
}

function renderTechnicalMap(snapshot: RepositorySnapshot): string {
  return `# Technical Map

## Detected Stack

${asList(snapshot.stack)}

## Main Directories

${asList(snapshot.topLevelDirectories)}

## Possible Entry Points

${asList(snapshot.entryPoints)}

## Possible Central Files

${asList(snapshot.centralFiles)}

## Structural Risks Or Questions

${asList(snapshot.risksAndQuestions)}

## Next Files An Agent Should Read

${asList(snapshot.nextFilesToRead)}
`;
}

async function detectImportantFiles(repoPath: string): Promise<string[]> {
  const detected: string[] = [];

  for (const fileName of IMPORTANT_FILES) {
    if (await isFile(path.join(repoPath, fileName))) {
      detected.push(fileName);
    }
  }

  const viteConfig = await findFirstExistingFile(repoPath, [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mts",
    "vite.config.mjs",
    "vite.config.cts",
    "vite.config.cjs"
  ]);

  if (viteConfig) {
    detected.push(viteConfig);
  }

  return detected;
}

async function detectImportantDirectories(repoPath: string): Promise<string[]> {
  const detected: string[] = [];

  for (const dirName of IMPORTANT_DIRECTORIES) {
    if (await isDirectory(path.join(repoPath, dirName))) {
      detected.push(dirName);
    }
  }

  return detected;
}

async function readPackageJson(packageJsonPath: string): Promise<PackageJsonInfo | undefined> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return {
      name: parsed.name || "nao detectado",
      scripts: parsed.scripts || {},
      dependencies: parsed.dependencies || {},
      devDependencies: parsed.devDependencies || {}
    };
  } catch {
    return undefined;
  }
}

async function runGitReadOnly(repoPath: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: 1024 * 1024
    });

    return result.stdout.trim() || result.stderr.trim();
  } catch (error) {
    const maybeError = error as { stdout?: string; stderr?: string; message?: string };
    return (maybeError.stdout || maybeError.stderr || maybeError.message || "nao detectado").trim();
  }
}

async function buildTree(repoPath: string): Promise<string[]> {
  const lines: string[] = [];
  await walkTree(repoPath, "", 0, lines);
  return lines;
}

async function walkTree(rootDir: string, relativeDir: string, depth: number, lines: string[]): Promise<void> {
  if (depth > MAX_TREE_DEPTH || lines.length >= MAX_TREE_ENTRIES) {
    return;
  }

  const currentDir = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
  const sortedEntries = entries
    .filter((entry) => !IGNORED_TREE_NAMES.has(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) return -1;
      if (!left.isDirectory() && right.isDirectory()) return 1;
      return left.name.localeCompare(right.name);
    });

  for (const entry of sortedEntries) {
    if (lines.length >= MAX_TREE_ENTRIES) {
      lines.push("...tree truncated...");
      return;
    }

    const entryRelativePath = path.join(relativeDir, entry.name);
    const displayPath = entryRelativePath.replace(/\\/g, "/");
    const indent = "  ".repeat(depth);

    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      await walkTree(rootDir, entryRelativePath, depth + 1, lines);
      continue;
    }

    if (entry.isFile()) {
      const stats = await fs.stat(path.join(rootDir, entryRelativePath)).catch(() => undefined);

      if (stats && stats.size <= MAX_TREE_FILE_SIZE_BYTES) {
        lines.push(`${indent}${displayPath.includes("/") ? entry.name : displayPath}`);
      }
    }
  }
}

async function readTopLevelDirectories(repoPath: string): Promise<string[]> {
  const entries = await fs.readdir(repoPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !IGNORED_TREE_NAMES.has(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function detectEntryPoints(repoPath: string): Promise<string[]> {
  const candidates = [
    "index.html",
    "src/main.tsx",
    "src/main.ts",
    "src/index.tsx",
    "src/index.ts",
    "src/App.tsx",
    "src/App.ts"
  ];

  return findExistingFiles(repoPath, candidates);
}

async function detectCentralFiles(repoPath: string): Promise<string[]> {
  const candidates = [
    "package.json",
    "README.md",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "src/main.tsx",
    "src/main.ts",
    "src/App.tsx",
    "src/App.ts"
  ];

  return findExistingFiles(repoPath, candidates);
}

function detectStack(project: Project, packageJson: PackageJsonInfo | undefined, detectedFiles: string[]): string[] {
  const stack = new Set(project.stack);
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };

  if (deps.typescript || detectedFiles.includes("tsconfig.json")) stack.add("TypeScript");
  if (deps.react) stack.add("React");
  if (deps.vite || detectedFiles.some((file) => file.startsWith("vite.config"))) stack.add("Vite");
  if (deps.tailwindcss) stack.add("Tailwind CSS");
  if (deps["lucide-react"]) stack.add("Lucide React");

  return [...stack].sort((left, right) => left.localeCompare(right));
}

function detectRisksAndQuestions(input: {
  detectedFiles: string[];
  detectedDirectories: string[];
  packageJson: PackageJsonInfo | undefined;
  gitStatus: string;
  entryPoints: string[];
}): string[] {
  const risks: string[] = [];

  if (!input.detectedFiles.includes("README.md")) risks.push("README.md nao detectado; contexto de produto pode estar fora do repo.");
  if (!input.detectedDirectories.includes("tests")) risks.push("Diretorio tests/ nao detectado; estrategia de teste precisa ser confirmada.");
  if (!input.packageJson) risks.push("package.json nao detectado ou nao parseavel; scripts e dependencias estao incompletos.");
  if (input.packageJson && !input.packageJson.scripts.test) risks.push("Script de teste nao detectado em package.json.");
  if (input.gitStatus !== "limpo") risks.push("Git status nao esta limpo; revisar mudancas existentes antes de qualquer execucao futura.");
  if (input.entryPoints.length === 0) risks.push("Pontos de entrada comuns nao detectados; agente deve mapear manualmente antes de implementar.");

  return risks.length > 0 ? risks : ["Nenhum risco estrutural obvio detectado por heuristica."];
}

async function findFirstExistingFile(repoPath: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await isFile(path.join(repoPath, candidate))) {
      return candidate;
    }
  }

  return undefined;
}

async function findExistingFiles(repoPath: string, candidates: string[]): Promise<string[]> {
  const existing: string[] = [];

  for (const candidate of candidates) {
    if (await isFile(path.join(repoPath, candidate))) {
      existing.push(candidate);
    }
  }

  return existing;
}

async function isFile(filePath: string): Promise<boolean> {
  const stats = await fs.stat(filePath).catch(() => undefined);
  return Boolean(stats?.isFile());
}

async function isDirectory(filePath: string): Promise<boolean> {
  const stats = await fs.stat(filePath).catch(() => undefined);
  return Boolean(stats?.isDirectory());
}

function asList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- nao detectado";
}

function asKeyValueList(values: Record<string, string>): string {
  const entries = Object.entries(values);
  return entries.length > 0 ? entries.map(([key, value]) => `- ${key}: ${value}`).join("\n") : "- nao detectado";
}

function asCodeBlock(value: string): string {
  return `\`\`\`text
${value || "nao detectado"}
\`\`\``;
}
