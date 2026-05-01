import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type {
  OpenClaudeProviderConfig,
  ProviderDoctorResult,
  ProviderCheck,
  ProviderDiscoveryResult
} from "@maestro/core";

const execFileAsync = promisify(execFile);

export async function loadOpenClaudeConfig(homeDir: string): Promise<OpenClaudeProviderConfig | undefined> {
  const configPath = path.join(homeDir, "data", "config", "openclaude.json");
  
  try {
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content) as OpenClaudeProviderConfig;
  } catch {
    return undefined;
  }
}

export async function doctorOpenClaudeProvider(homeDir: string): Promise<ProviderDoctorResult> {
  const checks: ProviderCheck[] = [];
  let overallStatus: "READY" | "BLOCKED" | "ERROR" = "READY";

  // Check 1: Config file exists
  const config = await loadOpenClaudeConfig(homeDir);
  if (!config) {
    checks.push({
      id: "config-exists",
      label: "Configuration file",
      status: "ERROR",
      message: "OpenClaude provider config missing",
      details: `Expected: ${path.join(homeDir, "data/config/openclaude.json")}\nCopy from: config/openclaude.example.json`
    });
    overallStatus = "BLOCKED";
  } else {
    checks.push({
      id: "config-exists",
      label: "Configuration file",
      status: "OK",
      message: "Config file found"
    });

    // Check 2: Executable path configured
    if (!config.executablePath || config.executablePath.trim() === "") {
      checks.push({
        id: "executable-configured",
        label: "Executable path configured",
        status: "ERROR",
        message: "executablePath not configured in config file"
      });
      overallStatus = "BLOCKED";
    } else {
      checks.push({
        id: "executable-configured",
        label: "Executable path configured",
        status: "OK",
        message: `Configured: ${config.executablePath}`
      });

      // Check 3: Executable exists
      try {
        await fs.access(config.executablePath);
        checks.push({
          id: "executable-exists",
          label: "Executable exists",
          status: "OK",
          message: "Executable file found"
        });
      } catch {
        checks.push({
          id: "executable-exists",
          label: "Executable exists",
          status: "ERROR",
          message: "Executable file not found",
          details: `Path: ${config.executablePath}`
        });
        overallStatus = "BLOCKED";
      }
    }

    // Check 4: Working directory configured
    if (!config.workingDirectory || config.workingDirectory.trim() === "") {
      checks.push({
        id: "workdir-configured",
        label: "Working directory configured",
        status: "WARN",
        message: "workingDirectory not configured (will use current directory)"
      });
    } else {
      checks.push({
        id: "workdir-configured",
        label: "Working directory configured",
        status: "OK",
        message: `Configured: ${config.workingDirectory}`
      });

      // Check 5: Working directory exists
      try {
        const stats = await fs.stat(config.workingDirectory);
        if (stats.isDirectory()) {
          checks.push({
            id: "workdir-exists",
            label: "Working directory exists",
            status: "OK",
            message: "Directory found"
          });
        } else {
          checks.push({
            id: "workdir-exists",
            label: "Working directory exists",
            status: "ERROR",
            message: "Path exists but is not a directory"
          });
          overallStatus = "BLOCKED";
        }
      } catch {
        checks.push({
          id: "workdir-exists",
          label: "Working directory exists",
          status: "ERROR",
          message: "Directory not found",
          details: `Path: ${config.workingDirectory}`
        });
        overallStatus = "BLOCKED";
      }
    }

    // Check 6: Isolated home directory
    const openclaudeHome = config.env?.OPENCLAUDE_HOME;
    if (!openclaudeHome) {
      checks.push({
        id: "isolated-home",
        label: "Isolated OPENCLAUDE_HOME",
        status: "WARN",
        message: "OPENCLAUDE_HOME not configured (will use default)"
      });
    } else {
      checks.push({
        id: "isolated-home",
        label: "Isolated OPENCLAUDE_HOME",
        status: "OK",
        message: `Configured: ${openclaudeHome}`
      });

      // Check 7: Isolated home directory exists or can be created
      const isolatedHomePath = path.isAbsolute(openclaudeHome)
        ? openclaudeHome
        : path.join(homeDir, openclaudeHome);

      try {
        await fs.access(isolatedHomePath);
        checks.push({
          id: "isolated-home-exists",
          label: "Isolated home directory",
          status: "OK",
          message: "Directory exists"
        });
      } catch {
        try {
          await fs.mkdir(isolatedHomePath, { recursive: true });
          checks.push({
            id: "isolated-home-exists",
            label: "Isolated home directory",
            status: "OK",
            message: "Directory created"
          });
        } catch (error) {
          checks.push({
            id: "isolated-home-exists",
            label: "Isolated home directory",
            status: "ERROR",
            message: "Cannot create directory",
            details: error instanceof Error ? error.message : String(error)
          });
          overallStatus = "BLOCKED";
        }
      }
    }

    // Check 8: Basic command response (only if executable exists)
    const executableCheck = checks.find((c) => c.id === "executable-exists");
    if (executableCheck?.status === "OK") {
      try {
        const args = config.executableArgs ? [...config.executableArgs, "--version"] : ["--version"];
        const { stdout, stderr } = await execFileAsync(config.executablePath, args, {
          timeout: 5000,
          env: { ...process.env, ...config.env }
        });
        checks.push({
          id: "command-response",
          label: "Basic command response",
          status: "OK",
          message: "Executable responds to --version",
          details: stdout || stderr
        });
      } catch (error) {
        checks.push({
          id: "command-response",
          label: "Basic command response",
          status: "WARN",
          message: "Executable did not respond or --version not supported",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      checks.push({
        id: "command-response",
        label: "Basic command response",
        status: "SKIP",
        message: "Skipped (executable not found)"
      });
    }
  }

  const summary = overallStatus === "READY"
    ? "OpenClaude provider is ready"
    : overallStatus === "BLOCKED"
    ? "OpenClaude provider is blocked (configuration or setup issues)"
    : "OpenClaude provider has errors";

  return {
    provider: "openclaude",
    status: overallStatus,
    checks,
    summary
  };
}

export async function discoverOpenClaudeProvider(homeDir: string): Promise<ProviderDiscoveryResult> {
  const config = await loadOpenClaudeConfig(homeDir);
  const timestamp = new Date().toISOString();

  if (!config) {
    return {
      provider: "openclaude",
      timestamp,
      status: "FAILED",
      error: "Config file not found. Run provider doctor first."
    };
  }

  if (!config.executablePath) {
    return {
      provider: "openclaude",
      timestamp,
      status: "FAILED",
      error: "executablePath not configured"
    };
  }

  const discoveryDir = path.join(homeDir, "data", "providers", "openclaude", "discovery");
  await fs.mkdir(discoveryDir, { recursive: true });

  let helpOutput: string | undefined;
  let versionOutput: string | undefined;
  let error: string | undefined;

  // Try --help
  try {
    const helpArgs = config.executableArgs ? [...config.executableArgs, "--help"] : ["--help"];
    const { stdout, stderr } = await execFileAsync(config.executablePath, helpArgs, {
      timeout: 10000,
      env: { ...process.env, ...config.env },
      cwd: config.workingDirectory || undefined
    });
    helpOutput = stdout || stderr;
    await fs.writeFile(path.join(discoveryDir, "help.txt"), helpOutput, "utf8");
  } catch (err) {
    error = `--help failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Try --version
  try {
    const versionArgs = config.executableArgs ? [...config.executableArgs, "--version"] : ["--version"];
    const { stdout, stderr } = await execFileAsync(config.executablePath, versionArgs, {
      timeout: 10000,
      env: { ...process.env, ...config.env },
      cwd: config.workingDirectory || undefined
    });
    versionOutput = stdout || stderr;
    await fs.writeFile(path.join(discoveryDir, "version.txt"), versionOutput, "utf8");
  } catch (err) {
    if (!error) {
      error = `--version failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Generate report
  const reportPath = path.join(discoveryDir, "discovery-report.md");
  const report = generateDiscoveryReport(config, helpOutput, versionOutput, error, timestamp);
  await fs.writeFile(reportPath, report, "utf8");

  return {
    provider: "openclaude",
    timestamp,
    status: error ? "FAILED" : "SUCCESS",
    helpOutput,
    versionOutput,
    error,
    reportPath
  };
}

function generateDiscoveryReport(
  config: OpenClaudeProviderConfig,
  helpOutput: string | undefined,
  versionOutput: string | undefined,
  error: string | undefined,
  timestamp: string
): string {
  return `# OpenClaude Provider Discovery Report

## Timestamp

${timestamp}

## Configuration

- **Executable**: ${config.executablePath}
- **Working Directory**: ${config.workingDirectory || "not configured"}
- **Profile Name**: ${config.profileName}
- **Default Model**: ${config.defaultModel}
- **Timeout**: ${config.timeoutMs}ms
- **OPENCLAUDE_HOME**: ${config.env?.OPENCLAUDE_HOME || "not configured"}

## Discovery Results

### Status

${error ? "❌ FAILED" : "✅ SUCCESS"}

${error ? `### Error\n\n${error}\n` : ""}

### Version Output

${versionOutput ? `\`\`\`\n${versionOutput}\n\`\`\`` : "Not available"}

### Help Output

${helpOutput ? `\`\`\`\n${helpOutput}\n\`\`\`` : "Not available"}

## Next Steps

${error
  ? "Fix the configuration issues and run discovery again."
  : "Discovery successful. The provider is ready for integration testing."
}
`;
}
