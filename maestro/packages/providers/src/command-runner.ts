import { spawn } from "node:child_process";

export interface CapturedCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  errorMessage?: string;
}

export interface RunCapturedCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdinContent?: string;
  shell?: boolean;
  windowsHide?: boolean;
  allowStackBufferOverrunWithStdout?: boolean;
}

/**
 * Run a command and capture its output.
 * 
 * This function spawns a child process and captures stdout/stderr.
 * It supports:
 * - Writing to stdin (for prompts)
 * - Timeout with graceful/forceful kill
 * - Special handling for Windows .cmd files
 * - Exit code 3221226505 (STATUS_STACK_BUFFER_OVERRUN) treatment
 * 
 * @param command - Command to execute
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Promise resolving to captured output and exit code
 */
export function runCapturedCommand(
  command: string,
  args: string[],
  options: RunCapturedCommandOptions
): Promise<CapturedCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    // On Windows, .cmd files with shell: true can break args with spaces
    // Use shell: false and wrap with cmd.exe /c for proper arg handling
    const isWindows = process.platform === "win32";
    const isCmdFile = isWindows && /\.(cmd|bat)$/i.test(command);
    
    let spawnCommand = command;
    let spawnArgs = args;
    let useShell = options.shell !== undefined ? options.shell : true;
    
    if (isCmdFile && useShell) {
      // Use cmd.exe /c with shell: false for proper quoting
      spawnCommand = process.env.COMSPEC || "cmd.exe";
      spawnArgs = ["/c", command, ...args];
      useShell = false;
    }

    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: options.windowsHide !== undefined ? options.windowsHide : true,
      shell: useShell
    });

    // Write stdin content if provided and close immediately
    if (options.stdinContent !== undefined) {
      child.stdin?.write(options.stdinContent, "utf8");
    }
    child.stdin?.end();

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1500).unref();
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: null,
        timedOut,
        errorMessage: error.message
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      // Special handling for exit code 3221226505 (0xC0000409 - STATUS_STACK_BUFFER_OVERRUN)
      // This is a known crash in OpenClaude when exiting in -p mode.
      // Only treat as success if:
      // 1. allowStackBufferOverrunWithStdout is explicitly enabled
      // 2. stdout is not empty (output was produced before crash)
      let effectiveExitCode = code;
      if (
        code === 3221226505 &&
        options.allowStackBufferOverrunWithStdout === true &&
        stdout.trim().length > 0
      ) {
        effectiveExitCode = 0;
      }

      resolve({
        stdout,
        stderr,
        exitCode: effectiveExitCode,
        timedOut,
        errorMessage: timedOut ? `Command timed out after ${options.timeoutMs}ms` : undefined
      });
    });
  });
}
