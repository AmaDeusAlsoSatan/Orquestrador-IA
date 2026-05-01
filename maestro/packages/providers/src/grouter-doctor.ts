import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type {
  GrouterProviderConfig,
  ProviderDoctorResult,
  ProviderCheck,
  ProviderDiscoveryResult
} from "@maestro/core";

const execFileAsync = promisify(execFile);

export async function loadGrouterConfig(homeDir: string): Promise<GrouterProviderConfig | undefined> {
  const configPath = path.join(homeDir, "data", "config", "grouter.json");
  
  try {
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content) as GrouterProviderConfig;
  } catch {
    return undefined;
  }
}

export async function doctorGrouterProvider(homeDir: string): Promise<ProviderDoctorResult> {
  const checks: ProviderCheck[] = [];
  let overallStatus: "READY" | "BLOCKED" | "ERROR" = "READY";

  // Check 1: Config file exists
  const config = await loadGrouterConfig(homeDir);
  if (!config) {
    checks.push({
      id: "config-exists",
      label: "Configuration file",
      status: "ERROR",
      message: "Grouter provider config missing",
      details: `Expected: ${path.join(homeDir, "data/config/grouter.json")}\nCopy from: config/grouter.example.json`
    });
    overallStatus = "BLOCKED";
  } else {
    checks.push({
      id: "config-exists",
      label: "Configuration file",
      status: "OK",
      message: "Config file found"
    });

    // Check 2: Executable configured
    if (!config.executablePath || config.executablePath.trim() === "") {
      checks.push({
        id: "executable-configured",
        label: "Executable configured",
        status: "ERROR",
        message: "executablePath not configured in config file"
      });
      overallStatus = "BLOCKED";
    } else {
      checks.push({
        id: "executable-configured",
        label: "Executable configured",
        status: "OK",
        message: `Configured: ${config.executablePath}`
      });

      // Check 3: Grouter responds to --help
      try {
        const { stdout, stderr } = await execFileAsync(config.executablePath, ["--help"], {
          timeout: 5000
        });
        checks.push({
          id: "command-response",
          label: "Basic command response",
          status: "OK",
          message: "Grouter responds to --help",
          details: (stdout || stderr).slice(0, 200)
        });
      } catch (error) {
        checks.push({
          id: "command-response",
          label: "Basic command response",
          status: "ERROR",
          message: "Grouter did not respond or not installed",
          details: error instanceof Error ? error.message : String(error)
        });
        overallStatus = "BLOCKED";
      }
    }

    // Check 4: Data home configured
    if (!config.dataHome || config.dataHome.trim() === "") {
      checks.push({
        id: "data-home-configured",
        label: "Data home configured",
        status: "WARN",
        message: "dataHome not configured (may use global ~/.grouter)"
      });
    } else {
      checks.push({
        id: "data-home-configured",
        label: "Data home configured",
        status: "OK",
        message: `Configured: ${config.dataHome}`
      });

      // Check 5: Data home exists or can be created
      const dataHomePath = path.isAbsolute(config.dataHome)
        ? config.dataHome
        : path.join(homeDir, config.dataHome);

      try {
        await fs.access(dataHomePath);
        checks.push({
          id: "data-home-exists",
          label: "Data home directory",
          status: "OK",
          message: "Directory exists"
        });
      } catch {
        try {
          await fs.mkdir(dataHomePath, { recursive: true });
          checks.push({
            id: "data-home-exists",
            label: "Data home directory",
            status: "OK",
            message: "Directory created"
          });
        } catch (error) {
          checks.push({
            id: "data-home-exists",
            label: "Data home directory",
            status: "ERROR",
            message: "Cannot create directory",
            details: error instanceof Error ? error.message : String(error)
          });
          overallStatus = "BLOCKED";
        }
      }
    }

    // Check 6: Grouter daemon status
    const executableCheck = checks.find((c) => c.id === "command-response");
    if (executableCheck?.status === "OK") {
      try {
        const { stdout } = await execFileAsync(config.executablePath, ["status"], {
          timeout: 5000
        });
        
        if (stdout.includes("running") || stdout.includes("active")) {
          checks.push({
            id: "daemon-status",
            label: "Grouter daemon status",
            status: "OK",
            message: "Daemon is running",
            details: stdout.slice(0, 200)
          });
        } else {
          checks.push({
            id: "daemon-status",
            label: "Grouter daemon status",
            status: "WARN",
            message: "Daemon not running",
            details: "Run: grouter serve on"
          });
        }
      } catch (error) {
        checks.push({
          id: "daemon-status",
          label: "Grouter daemon status",
          status: "WARN",
          message: "Could not check daemon status",
          details: "Run: grouter serve on"
        });
      }

      // Check 7: Check for global home usage
      try {
        const { stdout } = await execFileAsync(config.executablePath, ["config"], {
          timeout: 5000
        });
        
        if (stdout.includes("~/.grouter") || stdout.includes(".grouter/grouter.db")) {
          checks.push({
            id: "isolation-check",
            label: "Isolation check",
            status: "WARN",
            message: "Grouter may be using global home",
            details: "WARNING: Default global home detected (~/.grouter). Isolation not confirmed. Check if dataHome is being used."
          });
        } else {
          checks.push({
            id: "isolation-check",
            label: "Isolation check",
            status: "OK",
            message: "No global home detected in config"
          });
        }
      } catch {
        checks.push({
          id: "isolation-check",
          label: "Isolation check",
          status: "WARN",
          message: "Could not verify isolation",
          details: "Unable to check grouter config"
        });
      }
    } else {
      checks.push({
        id: "daemon-status",
        label: "Grouter daemon status",
        status: "SKIP",
        message: "Skipped (grouter not responding)"
      });
      checks.push({
        id: "isolation-check",
        label: "Isolation check",
        status: "SKIP",
        message: "Skipped (grouter not responding)"
      });
    }
  }

  const summary = overallStatus === "READY"
    ? "Grouter provider is ready (PRIMARY provider path)"
    : overallStatus === "BLOCKED"
    ? "Grouter provider is blocked (configuration or setup issues)"
    : "Grouter provider has errors";

  return {
    provider: "grouter",
    status: overallStatus,
    checks,
    summary
  };
}

export async function discoverGrouterProvider(homeDir: string): Promise<ProviderDiscoveryResult> {
  const config = await loadGrouterConfig(homeDir);
  const timestamp = new Date().toISOString();

  if (!config) {
    return {
      provider: "grouter",
      timestamp,
      status: "FAILED",
      error: "Config file not found. Run provider doctor first."
    };
  }

  if (!config.executablePath) {
    return {
      provider: "grouter",
      timestamp,
      status: "FAILED",
      error: "executablePath not configured"
    };
  }

  const discoveryDir = path.join(homeDir, "data", "providers", "grouter", "discovery");
  await fs.mkdir(discoveryDir, { recursive: true });

  let helpOutput: string | undefined;
  let versionOutput: string | undefined;
  let error: string | undefined;

  const commands = [
    { args: ["--help"], file: "help.txt" },
    { args: ["--version"], file: "version.txt" },
    { args: ["status"], file: "status.txt" },
    { args: ["list"], file: "list.txt" },
    { args: ["models"], file: "models.txt" },
    { args: ["config"], file: "config.txt" }
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
    provider: "grouter",
    timestamp,
    status: error ? "FAILED" : "SUCCESS",
    helpOutput,
    versionOutput,
    error,
    reportPath
  };
}

function generateDiscoveryReport(
  config: GrouterProviderConfig,
  helpOutput: string | undefined,
  versionOutput: string | undefined,
  error: string | undefined,
  timestamp: string
): string {
  return `# Grouter Provider Discovery Report

## Timestamp

${timestamp}

## Configuration

- **Executable**: ${config.executablePath}
- **Router URL**: ${config.routerUrl}
- **Dashboard URL**: ${config.dashboardUrl}
- **Provider**: ${config.provider}
- **Model**: ${config.model || "not configured"}
- **OpenClaude Profile**: ${config.openClaudeProfile}
- **Data Home**: ${config.dataHome}

## Discovery Results

### Status

${error ? "❌ FAILED" : "✅ SUCCESS"}

${error ? `### Error\n\n${error}\n` : ""}

### Version Output

${versionOutput ? `\`\`\`\n${versionOutput}\n\`\`\`` : "Not available"}

### Help Output

${helpOutput ? `\`\`\`\n${helpOutput}\n\`\`\`` : "Not available"}

## Key Commands

### Start Grouter Daemon

\`\`\`bash
grouter serve on
\`\`\`

### Check Status

\`\`\`bash
grouter status
\`\`\`

### List Providers

\`\`\`bash
grouter list
\`\`\`

### Add Kiro Provider (via Dashboard)

1. Open dashboard: ${config.dashboardUrl}
2. Click "Add Provider"
3. Select "Kiro"
4. Complete device code flow
5. Provider will be saved in isolated storage

### Connect OpenClaude to Grouter

\`\`\`bash
grouter up openclaude --provider ${config.provider}
\`\`\`

**WARNING:** Check if this command supports isolated OpenClaude home/profile before running.

## Next Steps

${error
  ? "Fix the configuration issues and run discovery again."
  : "Discovery successful. Start daemon with 'grouter serve on' and add Kiro provider via dashboard."
}

## Isolation Notes

- **Data Home**: ${config.dataHome}
- **OpenClaude Profile**: ${config.openClaudeProfile}
- **WARNING**: Verify that Grouter and OpenClaude are using isolated directories, not global ~/.grouter or ~/.openclaude
`;
}
