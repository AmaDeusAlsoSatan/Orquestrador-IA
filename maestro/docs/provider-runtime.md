# Provider Runtime

This document describes how Maestro integrates with external LLM providers, specifically OpenClaude as the runtime for Kiro models.

## Overview

Maestro uses a **provider-adapter** architecture:

- **Provider**: The runtime environment (e.g., OpenClaude CLI)
- **Adapter**: The Maestro integration layer (e.g., `openclaude`, `kiro_openclaude`)
- **Model**: The specific LLM model within the provider (e.g., `best-reasoning-free`)

## OpenClaude Bridge

### Important: Isolated Configuration

**The Maestro MUST NOT reuse the OpenClaude configuration from your current assistant.**

Maestro requires an isolated OpenClaude instance/profile to avoid:
- Interfering with your current assistant's sessions
- Mixing conversation histories
- Conflicting configurations
- Accidental data leakage between contexts

### Configuration

1. **Copy the example configuration:**

```bash
cp config/openclaude.example.json data/config/openclaude.json
```

2. **Edit `data/config/openclaude.json`:**

```json
{
  "executablePath": "/path/to/openclaude",
  "workingDirectory": "/path/to/working/dir",
  "profileName": "maestro-kiro",
  "defaultModel": "best-reasoning-free",
  "timeoutMs": 300000,
  "env": {
    "OPENCLAUDE_HOME": "./data/providers/openclaude"
  }
}
```

**Key fields:**

- `executablePath`: Path to the OpenClaude CLI executable
- `workingDirectory`: Directory where OpenClaude will run
- `profileName`: Isolated profile name for Maestro (e.g., `maestro-kiro`)
- `defaultModel`: Default Kiro model to use
- `timeoutMs`: Timeout for provider invocations (5 minutes default)
- `env.OPENCLAUDE_HOME`: Isolated home directory for OpenClaude data

### Provider Doctor

Before using OpenClaude, run the provider doctor to verify configuration:

```bash
corepack pnpm run maestro provider doctor --provider openclaude
```

The doctor checks:
- ✓ Configuration file exists
- ✓ Executable path is configured
- ✓ Executable file exists
- ✓ Working directory is configured and exists
- ✓ Isolated OPENCLAUDE_HOME is configured
- ✓ Isolated home directory exists or can be created
- ✓ Basic command response (--version)

**Status:**
- `READY`: Provider is ready to use
- `BLOCKED`: Configuration or setup issues need to be fixed
- `ERROR`: Critical errors prevent provider use

### Provider Discovery

After the doctor passes, run discovery to inspect the provider:

```bash
corepack pnpm run maestro provider discover --provider openclaude
```

Discovery runs:
- `<openclaude> --help` → saved to `data/providers/openclaude/discovery/help.txt`
- `<openclaude> --version` → saved to `data/providers/openclaude/discovery/version.txt`
- Generates `data/providers/openclaude/discovery/discovery-report.md`

This is a **read-only** operation that does not execute prompts or modify state.

## Agent Adapters

Maestro agent adapters map to provider configurations:

### Manual Adapters

- `manual`: Human provides output manually
- `codex_manual`: Codex Supervisor (manual)

These adapters return `BLOCKED` status and require manual output via:

```bash
maestro agent attach-output --invocation <id> --file <output.md>
```

### OpenClaude Adapters

- `openclaude`: Generic OpenClaude adapter
- `kiro_openclaude`: Kiro-specific OpenClaude adapter

**Current Status:** These adapters are implemented but **intentionally disabled** until provider configuration is complete and tested.

When invoked, they return:
- `BLOCKED: OpenClaude provider config missing` (if config not found)
- `BLOCKED: OpenClaude executable not found` (if executable missing)
- `BLOCKED: OpenClaude provider not ready` (if doctor hasn't passed)
- `BLOCKED: OpenClaude execution intentionally disabled until provider run is enabled` (if ready but not yet enabled)

## Model Placeholders

The default configuration includes placeholder model names:

- `best-reasoning-free`: Placeholder for best reasoning model
- `best-coding-free`: Placeholder for best coding model
- `best-review-free`: Placeholder for best review model

**These are NOT real model names.** You must replace them with actual Kiro model names available in your OpenClaude instance.

To find available models, check your OpenClaude documentation or run:

```bash
<openclaude> --list-models
```

(if such a command exists)

## Agent Roles and Models

Maestro agent roles map to models:

| Role | Adapter | Model Placeholder | Purpose |
|------|---------|-------------------|---------|
| CEO | `codex_manual` | N/A | Strategic planning (manual) |
| CTO_SUPERVISOR | `codex_manual` | N/A | Technical planning (manual) |
| FULL_STACK_EXECUTOR | `kiro_openclaude` | `best-coding-free` | Code execution |
| CODE_REVIEWER | `openclaude` | `best-review-free` | Code review |
| QA_VALIDATOR | `openclaude` | `best-reasoning-free` | Quality validation |

Update these mappings with:

```bash
maestro agents update --agent <id> --provider <provider> --model <model>
```

## Workflow Integration

### Current Workflow (Manual)

1. Prepare run
2. Invoke Supervisor: `maestro agent invoke --run <id> --role CTO_SUPERVISOR`
3. Manually run Codex, copy output
4. Attach output: `maestro agent attach-output --invocation <id> --file <output.md>`
5. Run moves to `SUPERVISOR_PLANNED`
6. Repeat for Executor, Reviewer

### Future Workflow (Automated)

1. Prepare run
2. Invoke Supervisor: `maestro agent invoke --run <id> --role CTO_SUPERVISOR`
3. **Maestro automatically calls OpenClaude → Kiro**
4. Output captured and attached automatically
5. Run moves to `SUPERVISOR_PLANNED`
6. Repeat for Executor, Reviewer

## Safety and Isolation

**Critical Rules:**

1. **Never reuse the assistant's OpenClaude configuration**
2. **Always use isolated `OPENCLAUDE_HOME`**
3. **Use separate profile name** (e.g., `maestro-kiro`)
4. **Test with discovery before enabling execution**
5. **Start with manual adapters, migrate to automated gradually**

## Next Steps

1. ✅ Run `maestro provider doctor --provider openclaude`
2. ✅ Fix any configuration issues
3. ✅ Run `maestro provider discover --provider openclaude`
4. ✅ Review discovery report
5. ⏳ Update model placeholders with real Kiro model names
6. ⏳ Enable OpenClaude execution in adapters
7. ⏳ Test with a simple invocation
8. ⏳ Integrate into full workflow

## Troubleshooting

### Config file not found

```
Error: OpenClaude provider config missing
```

**Solution:** Copy `config/openclaude.example.json` to `data/config/openclaude.json` and edit.

### Executable not found

```
Error: Executable file not found
```

**Solution:** Update `executablePath` in config to point to the correct OpenClaude CLI executable.

### Provider not ready

```
Error: OpenClaude provider not ready
```

**Solution:** Run `maestro provider doctor --provider openclaude` to diagnose issues.

### Discovery failed

```
Error: --help failed: ...
```

**Solution:** Check that the executable path is correct and the OpenClaude CLI is properly installed.

## Future Enhancements

- Support for other providers (Anthropic API, OpenAI API, local models)
- Provider-specific configuration profiles
- Model capability detection
- Automatic model selection based on task requirements
- Cost tracking and budgeting
- Rate limiting and retry logic
- Streaming output support
