import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type {
  OpenClaudeGrouterProviderConfig,
  ProviderDoctorResult,
  ProviderCheck,
  ProviderDiscoveryResult
} from "@maestro/core";
import { loadState } from "@maestro/core";
import { loadGrouterConfig, doctorGrouterProvider } from "./grouter-doctor";

const execFileAsync = promisify(execFile);

export async function loadOpenClaudeGrouterConfig(homeDir: string): Promise<OpenClaudeGrouterProviderConfig | undefined> {
  const configPath = path.join(homeDir, "data", "config", "openclaude-grouter.json");
  
  try {
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content) as OpenClaudeGrouterProviderConfig;
  } catch {
    return undefined;
  }
}

export async function doctorOpenClaudeGrouterProvider(homeDir: string): Promise<ProviderDoctorResult> {
  const checks: ProviderCheck[] = [];
  let overallStatus: "READY" | "BLOCKED" | "ERROR" = "READY";

  // Check 1: Config file exists
  const config = await loadOpenClaudeGrouterConfig(homeDir);
  if (!config) {
    checks.push({
      id: "config-exists",
      label: "Configuration file",
      status: "ERROR",
      message: "OpenClaude-Grouter provider config missing",
      details: `Expected: ${path.join(homeDir, "data/config/openclaude-grouter.json")}\nCopy from: config/openclaude-grouter.example.json`
    });
    overallStatus = "BLOCKED";
  } else {
    checks.push({
      id: "config-exists",
      label: "Configuration file",
      status: "OK",
      message: "Config file found"
    });

    // Check 2: OpenClaude executable configured
    if (!config.executablePath || config.executablePath.trim() === "") {
      checks.push({
        id: "executable-configured",
        label: "OpenClaude executable configured",
        status: "ERROR",
        message: "executablePath not configured in config file"
      });
      overallStatus = "BLOCKED";
    } else {
      checks.push({
        id: "executable-configured",
        label: "OpenClaude executable configured",
        status: "OK",
        message: `Configured: ${config.executablePath}`
      });

      // Check 3: OpenClaude responds to --help
      try {
        const args = config.executableArgs ? [...config.executableArgs, "--help"] : ["--help"];
        const { stdout, stderr } = await execFileAsync(config.executablePath, args, {
          timeout: 5000,
          env: { ...process.env, ...config.env }
        });
        checks.push({
          id: "openclaude-response",
          label: "OpenClaude command response",
          status: "OK",
          message: "OpenClaude responds to --help",
          details: (stdout || stderr).slice(0, 200)
        });
      } catch (error) {
        checks.push({
          id: "openclaude-response",
          label: "OpenClaude command response",
          status: "ERROR",
          message: "OpenClaude did not respond or not installed",
          details: error instanceof Error ? error.message : String(error)
        });
        overallStatus = "BLOCKED";
      }
    }

    // Check 4: Grouter provider is READY
    const grouterDoctor = await doctorGrouterProvider(homeDir);
    if (grouterDoctor.status !== "READY") {
      checks.push({
        id: "grouter-ready",
        label: "Grouter provider status",
        status: "ERROR",
        message: "Grouter provider is not READY",
        details: `Grouter status: ${grouterDoctor.status}\nRun: maestro provider doctor --provider grouter`
      });
      overallStatus = "BLOCKED";
    } else {
      checks.push({
        id: "grouter-ready",
        label: "Grouter provider status",
        status: "OK",
        message: "Grouter provider is READY"
      });
    }

    // Check 5: Linked connection exists
    if (!config.linkedConnectionId || config.linkedConnectionId.trim() === "") {
      checks.push({
        id: "linked-connection",
        label: "Linked Grouter connection",
        status: "ERROR",
        message: "linkedConnectionId not configured",
        details: "Run: maestro provider grouter sync\nThen: maestro provider grouter link --connection <id>"
      });
      overallStatus = "BLOCKED";
    } else {
      const state = await loadState(homeDir);
      const connection = state.grouterConnections.find((c) => c.id === config.linkedConnectionId);
      
      if (!connection) {
        checks.push({
          id: "linked-connection",
          label: "Linked Grouter connection",
          status: "ERROR",
          message: "Linked connection not found in state",
          details: `Connection ID: ${config.linkedConnectionId}\nRun: maestro provider grouter sync`
        });
        overallStatus = "BLOCKED";
      } else {
        checks.push({
          id: "linked-connection",
          label: "Linked Grouter connection",
          status: "OK",
          message: `Connection found: ${connection.id}`,
          details: `Provider: ${connection.provider}\nLabel: ${connection.label || "(no label)"}\nStatus: ${connection.status || "unknown"}`
        });
      }
    }

    // Check 6: Grouter connection is in allowlist
    if (config.linkedConnectionId) {
      const grouterConfig = await loadGrouterConfig(homeDir);
      if (grouterConfig && !grouterConfig.linkedConnectionIds.includes(config.linkedConnectionId)) {
        checks.push({
          id: "connection-allowlist",
          label: "Connection in Grouter allowlist",
          status: "ERROR",
          message: "Linked connection not in Grouter allowlist",
          details: `Connection ID: ${config.linkedConnectionId}\nRun: maestro provider grouter link --connection ${config.linkedConnectionId}`
        });
        overallStatus = "BLOCKED";
      } else if (grouterConfig) {
        checks.push({
          id: "connection-allowlist",
          label: "Connection in Grouter allowlist",
          status: "OK",
          message: "Connection is in Grouter allowlist"
        });
      }
    }

    // Check 7: Base URL configured
    if (!config.baseUrl || config.baseUrl.trim() === "") {
      checks.push({
        id: "base-url",
        label: "Base URL configured",
        status: "ERROR",
        message: "baseUrl not configured"
      });
      overallStatus = "BLOCKED";
    } else {
      checks.push({
        id: "base-url",
        label: "Base URL configured",
        status: "OK",
        message: `Configured: ${config.baseUrl}`
      });
    }

    // Check 8: Environment variables configured
    if (!config.env.OPENAI_BASE_URL || !config.env.OPENAI_API_KEY) {
      checks.push({
        id: "env-vars",
        label: "Environment variables",
        status: "ERROR",
        message: "OPENAI_BASE_URL or OPENAI_API_KEY not configured in env"
      });
      overallStatus = "BLOCKED";
    } else {
      checks.push({
        id: "env-vars",
        label: "Environment variables",
        status: "OK",
        message: "OPENAI_BASE_URL and OPENAI_API_KEY configured"
      });
    }

    // Check 9: Grouter daemon status (WARN only, not blocking)
    const grouterConfig = await loadGrouterConfig(homeDir);
    if (grouterConfig && grouterConfig.executablePath) {
      try {
        const { stdout } = await execFileAsync(grouterConfig.executablePath, ["status"], {
          timeout: 5000
        });
        
        if (stdout.includes("running") || stdout.includes("active")) {
          checks.push({
            id: "grouter-daemon",
            label: "Grouter daemon status",
            status: "OK",
            message: "Grouter daemon is running"
          });
        } else {
          checks.push({
            id: "grouter-daemon",
            label: "Grouter daemon status",
            status: "WARN",
            message: "Grouter daemon not running",
            details: "Run: grouter serve on"
          });
        }
      } catch (error) {
        checks.push({
          id: "grouter-daemon",
          label: "Grouter daemon status",
          status: "WARN",
          message: "Could not check Grouter daemon status",
          details: "Run: grouter serve on"
        });
      }
    }
  }

  const summary = overallStatus === "READY"
    ? "OpenClaude-Grouter provider is ready (OpenClaude via Grouter endpoint)"
    : overallStatus === "BLOCKED"
    ? "OpenClaude-Grouter provider is blocked (configuration or Grouter issues)"
    : "OpenClaude-Grouter provider has errors";

  return {
    provider: "openclaude_grouter",
    status: overallStatus,
    checks,
    summary
  };
}

export async function discoverOpenClaudeGrouterProvider(homeDir: string): Promise<ProviderDiscoveryResult> {
  const config = await loadOpenClaudeGrouterConfig(homeDir);
  const timestamp = new Date().toISOString();

  if (!config) {
    return {
      provider: "openclaude_grouter",
      timestamp,
      status: "FAILED",
      error: "Config file not found. Run provider doctor first."
    };
  }

  if (!config.executablePath) {
    return {
      provider: "openclaude_grouter",
      timestamp,
      status: "FAILED",
      error: "executablePath not configured"
    };
  }

  const discoveryDir = path.join(homeDir, "data", "providers", "openclaude-grouter", "discovery");
  await fs.mkdir(discoveryDir, { recursive: true });

  let helpOutput: string | undefined;
  let versionOutput: string | undefined;
  let error: string | undefined;

  const commands = [
    { args: ["--help"], file: "help.txt" },
    { args: ["--version"], file: "version.txt" },
    { args: ["-p", "--help"], file: "print-help.txt" }
  ];

  for (const cmd of commands) {
    try {
      const args = config.executableArgs ? [...config.executableArgs, ...cmd.args] : cmd.args;
      const { stdout, stderr } = await execFileAsync(config.executablePath, args, {
        timeout: 10000,
        env: { ...process.env, ...config.env }
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

  // Also run Grouter discovery commands
  const grouterConfig = await loadGrouterConfig(homeDir);
  if (grouterConfig && grouterConfig.executablePath) {
    const grouterCommands = [
      { args: ["status"], file: "grouter-status.txt" },
      { args: ["models"], file: "grouter-models.txt" }
    ];

    for (const cmd of grouterCommands) {
      try {
        const { stdout, stderr } = await execFileAsync(grouterConfig.executablePath, cmd.args, {
          timeout: 10000
        });
        const output = stdout || stderr;
        await fs.writeFile(path.join(discoveryDir, cmd.file), output, "utf8");
      } catch (err) {
        // Non-critical, continue
      }
    }
  }

  // Generate report
  const reportPath = path.join(discoveryDir, "discovery-report.md");
  const report = generateDiscoveryReport(config, helpOutput, versionOutput, error, timestamp);
  await fs.writeFile(reportPath, report, "utf8");

  return {
    provider: "openclaude_grouter",
    timestamp,
    status: error ? "FAILED" : "SUCCESS",
    helpOutput,
    versionOutput,
    error,
    reportPath
  };
}

function generateDiscoveryReport(
  config: OpenClaudeGrouterProviderConfig,
  helpOutput: string | undefined,
  versionOutput: string | undefined,
  error: string | undefined,
  timestamp: string
): string {
  return `# OpenClaude-Grouter Provider Discovery Report

## Timestamp

${timestamp}

## Configuration

- **Executable**: ${config.executablePath}
- **Executable Args**: ${config.executableArgs?.join(" ") || "none"}
- **Working Directory**: ${config.workingDirectory}
- **Mode**: ${config.mode}
- **Provider**: ${config.provider}
- **Base URL**: ${config.baseUrl}
- **Model**: ${config.model || "not configured"}
- **Linked Connection ID**: ${config.linkedConnectionId}
- **Timeout**: ${config.timeoutMs}ms

## Environment Variables

- **OPENCLAUDE_HOME**: ${config.env.OPENCLAUDE_HOME}
- **OPENAI_BASE_URL**: ${config.env.OPENAI_BASE_URL}
- **OPENAI_API_KEY**: ${config.env.OPENAI_API_KEY ? "(configured)" : "(not configured)"}

## Discovery Results

### Status

${error ? "❌ FAILED" : "✅ SUCCESS"}

${error ? `### Error\n\n${error}\n` : ""}

### Version Output

${versionOutput ? `\`\`\`\n${versionOutput}\n\`\`\`` : "Not available"}

### Help Output

${helpOutput ? `\`\`\`\n${helpOutput.slice(0, 1000)}\n...\n\`\`\`` : "Not available"}

## Architecture

\`\`\`
Maestro (project/agent manager)
  ↓ invokes OpenClaude with env vars
OpenClaude CLI (--provider openai)
  ↓ uses OPENAI_BASE_URL and OPENAI_API_KEY
Grouter (OpenAI-compatible endpoint)
  ↓ routes to linked connection
Kiro (model/provider)
\`\`\`

## Key Commands

### Start Grouter Daemon

\`\`\`bash
grouter serve on
\`\`\`

### Check Grouter Status

\`\`\`bash
grouter status
\`\`\`

### Test OpenClaude with Grouter

\`\`\`bash
OPENAI_BASE_URL=${config.baseUrl} OPENAI_API_KEY=${config.apiKey} \\
  ${config.executablePath} ${config.executableArgs?.join(" ") || ""} -p --provider openai "Responda apenas: OK"
\`\`\`

**WARNING:** This is a test command only. Do not run without explicit confirmation.

## Environment Injection

OpenClaude will be invoked with:

\`\`\`bash
env:
  OPENCLAUDE_HOME: ${config.env.OPENCLAUDE_HOME}
  OPENAI_BASE_URL: ${config.env.OPENAI_BASE_URL}
  OPENAI_API_KEY: ${config.env.OPENAI_API_KEY}

command:
  ${config.executablePath} ${config.executableArgs?.join(" ") || ""} -p --provider openai --output-format json "<prompt>"
\`\`\`

## Next Steps

${error
  ? "Fix the configuration issues and run discovery again."
  : "Discovery successful. Ensure Grouter daemon is running and linked connection is configured."
}

## Security Notes

- **Isolated OpenClaude Home**: ${config.env.OPENCLAUDE_HOME}
- **No Global Config**: OpenClaude uses isolated home directory
- **Grouter Auth**: Authentication handled by Grouter via linked connection
- **API Key**: Can be any value (e.g., "any-value") since Grouter handles auth
`;
}
