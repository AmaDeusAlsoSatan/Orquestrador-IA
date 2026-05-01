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
  resolvedCommand: string;
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
  const resolvedCommand = resolveValidationCommand(command);
  const spawnInvocation = getSpawnInvocation(resolvedCommand, args);

  // Ensure output directories exist
  await fs.mkdir(path.dirname(stdoutPath), { recursive: true });
  await fs.mkdir(path.dirname(stderrPath), { recursive: true });

  const stdoutStream = await fs.open(stdoutPath, "w");
  const stderrStream = await fs.open(stderrPath, "w");

  const startTime = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let child: ReturnType<typeof spawn>;

    const resolveOnce = (result: RunValidationCommandResult) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    const resolveSpawnFailure = async (error: Error) => {
      await stdoutStream.close().catch(() => undefined);
      await stderrStream.close().catch(() => undefined);

      try {
        await fs.appendFile(stderrPath, `\nCommand resolved: ${resolvedCommand}\nSpawn error: ${error.message}\n`, "utf8");
      } catch {
        // Ignore write errors
      }

      const durationMs = Date.now() - startTime;
      resolveOnce({ exitCode: null, durationMs, resolvedCommand });
    };

    try {
      child = spawn(spawnInvocation.command, spawnInvocation.args, {
        cwd,
        stdio: ["ignore", stdoutStream.fd, stderrStream.fd],
        shell: false
      });
    } catch (error) {
      void resolveSpawnFailure(error instanceof Error ? error : new Error(String(error)));
      return;
    }

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

      await stdoutStream.close().catch(() => undefined);
      await stderrStream.close().catch(() => undefined);

      const durationMs = Date.now() - startTime;
      const exitCode = killed ? null : code;

      resolveOnce({ exitCode, durationMs, resolvedCommand });
    });

    child.on("error", async (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      await resolveSpawnFailure(error);
    });
  });
}

export function resolveValidationCommand(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }

  const lowerCommand = command.toLowerCase();
  const windowsCommandMap: Record<string, string> = {
    npm: "npm.cmd",
    npx: "npx.cmd",
    pnpm: "pnpm.cmd",
    pnpx: "pnpx.cmd",
    yarn: "yarn.cmd",
    bun: "bun.exe"
  };

  return windowsCommandMap[lowerCommand] || command;
}

function getSpawnInvocation(resolvedCommand: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === "win32" && resolvedCommand.toLowerCase().endsWith(".cmd")) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", quoteWindowsCommand([resolvedCommand, ...args])]
    };
  }

  return {
    command: resolvedCommand,
    args
  };
}

function quoteWindowsCommand(parts: string[]): string {
  return parts.map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"&()^|<>]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}
