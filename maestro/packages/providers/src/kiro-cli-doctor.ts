import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type {
  KiroCliProviderConfig,
  ProviderDoctorResult,
  ProviderCheck,
  ProviderDiscoveryResult
} from "@maestro/core";

const execFileAsync = promisify(execFile);

export async function loadKiroCliConfig(homeDir: string): Promise<KiroCliProviderConfig | undefined> {
  const configPath = path.join(homeDir, "data", "config", "kiro-cli.json");
  
  try {
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content) as KiroCliProviderConfig;
  } catch {
    return undefined;
  }
}

export async function doctorKiroCliProvider(homeDir: string): Promise<ProviderDoctorResult> {
  const checks: ProviderCheck[] = [];
  let overallStatus: "READY" | "BLOCKED" | "ERROR" = "READY";

  // Check 1: Config file exists
  const config = await loadKiroCliConfig(homeDir);
  if (!config) {
    checks.push({
      id: "config-exists",
      label: "Configuration file",
      status: "ERROR",
      message: "Kiro CLI provider config missing",
      details: `Expected: ${path.join(homeDir, "data/config/kiro-cli.json")}\nCopy from: config/kiro-cli.example.json`
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

    // Check 4: Basic command response (only if executable exists)
    const executableCheck = checks.find((c) => c.id === "executable-exists");
    if (executableCheck?.status === "OK") {
      try {
        const { stdout, stderr } = await execFileAsync(config.executablePath, ["--help"], {
          timeout: 5000
        });
        checks.push({
          id: "command-response",
          label: "Basic command response",
          status: "OK",
          message: "Executable responds to --help",
          details: (stdout || stderr).slice(0, 200)
        });
      } catch (error) {
        checks.push({
          id: "command-response",
          label: "Basic command response",
          status: "WARN",
          message: "Executable did not respond or --help not supported",
          details: error instanceof Error ? error.message : String(error)
        });
      }

      // Check 5: Authentication status
      try {
        const { stdout } = await execFileAsync(config.executablePath, ["whoami", "--format", "json"], {
          timeout: 10000
        });
        
        try {
          const whoamiData = JSON.parse(stdout);
          if (whoamiData.email || whoamiData.user_id) {
            // Check if this is allowed
            if (!config.allowExistingGlobalAuth) {
              checks.push({
                id: "auth-status",
                label: "Authentication status",
                status: "ERROR",
                message: "Existing global Kiro CLI auth detected",
                details: "This may belong to Kofuku or another project. Set allowExistingGlobalAuth=true in config to override, or use Grouter provider instead."
              });
              overallStatus = "BLOCKED";
            } else if (config.expectedEmail && whoamiData.email !== config.expectedEmail) {
              const maskedEmail = maskEmail(whoamiData.email);
              checks.push({
                id: "auth-status",
                label: "Authentication status",
                status: "ERROR",
                message: "Authenticated with unexpected email",
                details: `Expected: ${config.expectedEmail}\nFound: ${maskedEmail}\nThis may be a different account.`
              });
              overallStatus = "BLOCKED";
            } else {
              const maskedEmail = maskEmail(whoamiData.email);
              checks.push({
                id: "auth-status",
                label: "Authentication status",
                status: "WARN",
                message: "Authenticated (using global auth)",
                details: `Email: ${maskedEmail}\nWARNING: Using global Kiro CLI auth. Consider using Grouter provider for isolation.`
              });
            }
          } else {
            checks.push({
              id: "auth-status",
              label: "Authentication status",
              status: "WARN",
              message: "Not authenticated",
              details: "Run: maestro provider auth start --provider kiro_cli"
            });
          }
        } catch {
          checks.push({
            id: "auth-status",
            label: "Authentication status",
            status: "WARN",
            message: "Could not parse whoami output",
            details: stdout.slice(0, 200)
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("not logged in") || errorMsg.includes("not authenticated")) {
          checks.push({
            id: "auth-status",
            label: "Authentication status",
            status: "WARN",
            message: "Not authenticated",
            details: "Run: maestro provider auth start --provider kiro_cli"
          });
        } else {
          checks.push({
            id: "auth-status",
            label: "Authentication status",
            status: "WARN",
            message: "Could not check authentication",
            details: errorMsg
          });
        }
      }
    } else {
      checks.push({
        id: "command-response",
        label: "Basic command response",
        status: "SKIP",
        message: "Skipped (executable not found)"
      });
      checks.push({
        id: "auth-status",
        label: "Authentication status",
        status: "SKIP",
        message: "Skipped (executable not found)"
      });
    }
  }

  const summary = overallStatus === "READY"
    ? "Kiro CLI provider is ready (EXPERIMENTAL: may use global auth)"
    : overallStatus === "BLOCKED"
    ? "Kiro CLI provider is blocked (global auth detected or configuration issues)"
    : "Kiro CLI provider has errors";

  return {
    provider: "kiro_cli",
    status: overallStatus,
    checks,
    summary
  };
}

function maskEmail(email: string): string {
  if (!email || !email.includes("@")) {
    return "***";
  }
  const [local, domain] = email.split("@");
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}${"*".repeat(local.length - 1)}@${domain}`;
}

export async function discoverKiroCliProvider(homeDir: string): Promise<ProviderDiscoveryResult> {
  const config = await loadKiroCliConfig(homeDir);
  const timestamp = new Date().toISOString();

  if (!config) {
    return {
      provider: "kiro_cli",
      timestamp,
      status: "FAILED",
      error: "Config file not found. Run provider doctor first."
    };
  }

  if (!config.executablePath) {
    return {
      provider: "kiro_cli",
      timestamp,
      status: "FAILED",
      error: "executablePath not configured"
    };
  }

  const discoveryDir = path.join(homeDir, "data", "providers", "kiro-cli", "discovery");
  await fs.mkdir(discoveryDir, { recursive: true });

  let helpOutput: string | undefined;
  let versionOutput: string | undefined;
  let error: string | undefined;

  const commands = [
    { args: ["--help"], file: "help.txt" },
    { args: ["login", "--help"], file: "login-help.txt" },
    { args: ["chat", "--help"], file: "chat-help.txt" },
    { args: ["whoami", "--help"], file: "whoami-help.txt" },
    { args: ["--version"], file: "version.txt" }
  ];

  for (const cmd of commands) {
    try {
      const { stdout, stderr } = await execFileAsync(config.executablePath, cmd.args, {
        timeout: 10000
      });
      const output = stdout || stderr;
      await fs.writeFile(path.join(discoveryDir, cmd.file), output, "utf8");
      
      if (cmd.file === "help.txt") {
        helpOutput = output;
      } else if (cmd.file === "version.txt") {
        versionOutput = output;
      }
    } catch (err) {
      if (!error) {
        error = `${cmd.args.join(" ")} failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  // Generate report
  const reportPath = path.join(discoveryDir, "discovery-report.md");
  const report = generateDiscoveryReport(config, helpOutput, versionOutput, error, timestamp);
  await fs.writeFile(reportPath, report, "utf8");

  return {
    provider: "kiro_cli",
    timestamp,
    status: error ? "FAILED" : "SUCCESS",
    helpOutput,
    versionOutput,
    error,
    reportPath
  };
}

function generateDiscoveryReport(
  config: KiroCliProviderConfig,
  helpOutput: string | undefined,
  versionOutput: string | undefined,
  error: string | undefined,
  timestamp: string
): string {
  return `# Kiro CLI Provider Discovery Report

## Timestamp

${timestamp}

## Configuration

- **Executable**: ${config.executablePath}
- **Timeout**: ${config.timeoutMs}ms
- **Trust All Tools**: ${config.trustAllTools}
- **Default Agent**: ${config.defaultAgent || "not configured"}
- **Default Model**: ${config.defaultModel || "not configured"}

## Discovery Results

### Status

${error ? "❌ FAILED" : "✅ SUCCESS"}

${error ? `### Error\n\n${error}\n` : ""}

### Version Output

${versionOutput ? `\`\`\`\n${versionOutput}\n\`\`\`` : "Not available"}

### Help Output

${helpOutput ? `\`\`\`\n${helpOutput}\n\`\`\`` : "Not available"}

## Key Commands

### Login with Device Flow

\`\`\`bash
kiro-cli login --use-device-flow
\`\`\`

### Check Authentication

\`\`\`bash
kiro-cli whoami --format json
\`\`\`

### Execute Chat (Non-Interactive)

\`\`\`bash
kiro-cli chat --no-interactive "Your prompt here"
\`\`\`

### Execute Chat with Trusted Tools

\`\`\`bash
kiro-cli chat --no-interactive --trust-all-tools "Your prompt here"
\`\`\`

## Next Steps

${error
  ? "Fix the configuration issues and run discovery again."
  : "Discovery successful. The provider is ready for authorization and integration testing."
}
`;
}
