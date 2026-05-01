import { promises as fs } from "node:fs";
import path from "node:path";
import { getMaestroPaths, type MemoryDocument, type Project } from "@maestro/core";
import { PROJECT_VAULT_DOCUMENTS, toMemoryDocument } from "./templates";

export const IMPORTED_CONTEXT_FILE_NAME = "07-imported-context.md";
const OPTIONAL_PROJECT_MEMORY_FILES = [
  IMPORTED_CONTEXT_FILE_NAME,
  "08-repo-snapshot.md",
  "09-dev-scripts.md",
  "10-technical-map.md",
  "11-context-pack.md",
  "12-active-context.md",
  "13-project-checkpoint.md",
  "14-open-questions.md",
  "15-risk-register.md"
];

export interface MemoryStatus {
  homeDir: string;
  stateFileExists: boolean;
  vaultExists: boolean;
  projectsVaultDir: string;
  projectFolderCount: number;
  markdownDocumentCount: number;
}

export interface ProjectMemoryFileStatus {
  fileName: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
}

export interface ProjectContextStatus {
  projectId: string;
  projectVaultDir: string;
  importedContextExists: boolean;
  files: ProjectMemoryFileStatus[];
}

export async function ensureVaultBase(homeDir: string): Promise<void> {
  const paths = getMaestroPaths(homeDir);

  await fs.mkdir(paths.vaultDir, { recursive: true });
  await fs.mkdir(paths.globalVaultDir, { recursive: true });
  await fs.mkdir(paths.projectsVaultDir, { recursive: true });
  await fs.mkdir(paths.logsDir, { recursive: true });

  const readmePath = path.join(paths.globalVaultDir, "README.md");
  if (!(await pathExists(readmePath))) {
    await fs.writeFile(readmePath, "# Global Maestro Memory\n\nShared notes can live here later.\n", "utf8");
  }
}

export async function createProjectVault(homeDir: string, project: Project): Promise<MemoryDocument[]> {
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, project.id);

  await ensureVaultBase(homeDir);
  await fs.mkdir(projectVaultDir, { recursive: true });

  const documents: MemoryDocument[] = [];

  for (const template of PROJECT_VAULT_DOCUMENTS) {
    const filePath = path.join(projectVaultDir, template.fileName);

    if (!(await pathExists(filePath))) {
      await fs.writeFile(filePath, template.render(project), "utf8");
    }

    documents.push(toMemoryDocument(project, projectVaultDir, template));
  }

  return documents;
}

export async function importProjectContext(
  homeDir: string,
  project: Project,
  sourceFilePath: string
): Promise<{ importedContextPath: string; sourceFilePath: string }> {
  const resolvedSourceFilePath = path.resolve(sourceFilePath);
  const extension = path.extname(resolvedSourceFilePath).toLowerCase();

  if (extension !== ".md" && extension !== ".txt") {
    throw new Error("Context import only accepts .md or .txt files.");
  }

  const sourceText = await fs.readFile(resolvedSourceFilePath, "utf8");
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, project.id);
  const importedContextPath = path.join(projectVaultDir, IMPORTED_CONTEXT_FILE_NAME);

  await createProjectVault(homeDir, project);

  const existingContent = (await pathExists(importedContextPath))
    ? await fs.readFile(importedContextPath, "utf8")
    : "";
  const content = renderImportedContext(resolvedSourceFilePath, sourceText, existingContent);

  await fs.writeFile(importedContextPath, content, "utf8");

  return {
    importedContextPath,
    sourceFilePath: resolvedSourceFilePath
  };
}

export async function getProjectContextStatus(homeDir: string, projectId: string): Promise<ProjectContextStatus> {
  const paths = getMaestroPaths(homeDir);
  const projectVaultDir = path.join(paths.projectsVaultDir, projectId);
  const fileNames = [...PROJECT_VAULT_DOCUMENTS.map((template) => template.fileName), ...OPTIONAL_PROJECT_MEMORY_FILES];
  const files: ProjectMemoryFileStatus[] = [];

  for (const fileName of fileNames) {
    const filePath = path.join(projectVaultDir, fileName);
    const stats = await statFile(filePath);

    files.push({
      fileName,
      path: filePath,
      exists: Boolean(stats?.isFile()),
      sizeBytes: stats?.isFile() ? stats.size : 0
    });
  }

  return {
    projectId,
    projectVaultDir,
    importedContextExists: files.some((file) => file.fileName === IMPORTED_CONTEXT_FILE_NAME && file.exists),
    files
  };
}

export async function getMemoryStatus(homeDir: string): Promise<MemoryStatus> {
  const paths = getMaestroPaths(homeDir);
  const stateFileExists = await pathExists(paths.stateFile);
  const vaultExists = await pathExists(paths.vaultDir);
  const projectFolders = await readDirectories(paths.projectsVaultDir);
  const markdownDocumentCount = await countMarkdownDocuments(paths.projectsVaultDir);

  return {
    homeDir,
    stateFileExists,
    vaultExists,
    projectsVaultDir: paths.projectsVaultDir,
    projectFolderCount: projectFolders.length,
    markdownDocumentCount
  };
}

async function countMarkdownDocuments(rootDir: string): Promise<number> {
  if (!(await pathExists(rootDir))) {
    return 0;
  }

  let count = 0;
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      count += await countMarkdownDocuments(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      count += 1;
    }
  }

  return count;
}

async function readDirectories(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function renderImportedContext(sourceFilePath: string, sourceText: string, existingContent: string): string {
  const existingBody = existingContent.replace(/^# Imported Context\s*/u, "").trimStart();
  const sourceBlock = sourceText.endsWith("\n") ? sourceText : `${sourceText}\n`;

  let nextContent = `# Imported Context

## Imported at ${new Date().toISOString()}

Source file: ${sourceFilePath}

${sourceBlock}`;

  if (existingBody) {
    nextContent += `
---

${existingBody}`;
  }

  return nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`;
}

async function statFile(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
