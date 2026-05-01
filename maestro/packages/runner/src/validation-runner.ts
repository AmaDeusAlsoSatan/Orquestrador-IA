import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface RunValidationCommandOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdoutPath: string;
  stderrPath: string;
}

export interface RunValidationCommandResult {
  exitCode: number | null;
  durationMs: number;
}

export async function detectPackageManager(repoPath: string): Promise<"pnpm" | "npm" | "yarn" | "bun" | undefined> {
  const lockfiles = [
    { file: "pnpm-lock.yaml", manager: "pnpm" as const },
    { file: "package-lock.json", manager: "npm" as const },
    { file: "yarn.lock", manager: "yarn" as const },
    { file: "bun.lockb", manager: "bun" as const }
  ];

  for (const { file, manager } of lockfiles) {
    try {
      await fs.access(path.join(repoPath, file));
      return manager;
    } catch {
      // File doesn't exist, continue
    }
  }

  return undefined;
}

export async function detectPackageScripts(repoPath: string): Promise<Record<string, string>> {
  try {
    const packageJsonPath = path.join(repoPath, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(content);

    if (packageJson.scripts && typeof packageJson.scripts === "object") {
      return packageJson.scripts;
    }
  } catch {
    // package.json doesn't exist or is invalid
  }

  return {};
}

export async function runValidationCommand(options: RunValidationCommandOptions): Promise<RunValidationCommandResult> {
  const { command, args, cwd, timeoutMs, stdoutPath, stderrPath } = options;

  // Ensure output directories exist
  await fs.mkdir(path.dirname(stdoutPath), { recursive: true });
  await fs.mkdir(path.dirname(stderrPath), { recursive: true });

  const stdoutStream = await fs.open(stdoutPath, "w");
  const stderrStream = await fs.open(stderrPath, "w");

  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", stdoutStream.fd, stderrStream.fd],
      shell: false
    });

    let timeoutId: NodeJS.Timeout | undefined;
    let killed = false;

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5000);
      }, timeoutMs);
    }

    child.on("close", async (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      await stdoutStream.close();
      await stderrStream.close();

      const durationMs = Date.now() - startTime;
      const exitCode = killed ? null : code;

      resolve({ exitCode, durationMs });
    });

    child.on("error", async (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      await stdoutStream.close();
      await stderrStream.close();

      // Write error to stderr file
      try {
        await fs.appendFile(stderrPath, `\nSpawn error: ${error.message}\n`, "utf8");
      } catch {
        // Ignore write errors
      }

      const durationMs = Date.now() - startTime;
      resolve({ exitCode: null, durationMs });
    });
  });
}
