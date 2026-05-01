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

## Kiro Authorization Flow

### Overview

Kiro models require device code authorization before they can be used, similar to AWS SSO or Grouter. This is a security measure to ensure that only authorized users can access Kiro models.

**The authorization flow is separate from configuration.** Even if the provider doctor passes, you still need to authorize before executing prompts.

### Authorization Status

Check the current authorization status:

```bash
corepack pnpm run maestro provider auth status --provider kiro_openclaude
```

This shows all auth sessions for the provider, including:
- Session ID
- Flow type (device_code, manual_interactive, api_key)
- Status (NOT_AUTHORIZED, AUTHORIZING, AUTHORIZED, FAILED, EXPIRED)
- Device code and verification URL (if available)
- Expiration time
- Error messages (if failed)

### Starting Authorization

Start a new authorization session:

```bash
corepack pnpm run maestro provider auth start --provider kiro_openclaude
```

**Expected flow:**

1. Maestro creates an auth session
2. Maestro calls OpenClaude to initiate device code flow
3. OpenClaude returns:
   - User code (e.g., `LTPF-NRNC`)
   - Verification URL (e.g., `https://view.awsapps.com/start/#/device?user_code=LTPF-NRNC`)
   - Expiration time (typically 15 minutes)
4. Maestro displays the code and URL
5. User opens the URL in a browser
6. User enters the code and authorizes
7. Maestro polls for completion

**Current Status:** The authorization command is implemented but the actual OpenClaude auth command discovery is still in progress. The command will create a session and indicate that the auth flow needs to be discovered.

### Polling for Completion

After authorizing in the browser, check if authorization is complete:

```bash
corepack pnpm run maestro provider auth poll --session <session-id>
```

This checks if the user has completed authorization and updates the session status.

**Current Status:** Polling is not yet implemented. Manual verification is required.

### Cancelling Authorization

Cancel an ongoing authorization session:

```bash
corepack pnpm run maestro provider auth cancel --session <session-id>
```

This marks the session as failed and prevents further polling.

### Authorization Storage

Auth sessions are stored in:

```
data/providers/<provider>/auth/<session-id>/
  00-auth-session.json    # Session metadata
  01-raw-output.txt       # Raw output from auth command
```

**These files are NOT committed to git** (excluded via `.gitignore`).

### Device Code Format

Maestro supports multiple device code formats:

**AWS SSO format:**
```
YOUR CODE LTPF-NRNC
https://view.awsapps.com/start/#/device?user_code=LTPF-NRNC
```

**Standard OAuth format:**
```
user_code=LTPF-NRNC
verification_uri=https://example.com/device
verification_uri_complete=https://example.com/device?user_code=LTPF-NRNC
expires_in=900
```

**JSON format:**
```json
{
  "user_code": "LTPF-NRNC",
  "verification_uri": "https://example.com/device",
  "verification_uri_complete": "https://example.com/device?user_code=LTPF-NRNC",
  "device_code": "...",
  "expires_in": 900,
  "interval": 5
}
```

### OpenClaude Auth Commands

OpenClaude provides auth commands:

```bash
openclaude auth login --help
openclaude auth login --sso
openclaude auth status
openclaude auth logout
```

**Investigation needed:**
- Does `openclaude auth login --sso` trigger device code flow for Kiro?
- Is there a `--provider kiro` flag?
- What is the output format?
- How do we detect when authorization is complete?

### UI Integration

The Maestro web UI will provide a visual interface for authorization:

**Provider card:**
```
Kiro via OpenClaude
Status: NOT_AUTHORIZED
[Start Authorization]
```

**During authorization:**
```
Your code: LTPF-NRNC
Authorization URL: https://view.awsapps.com/start/#/device?user_code=LTPF-NRNC
[Copy Code] [Open URL] [I've authorized, check status] [Cancel]
```

**After authorization:**
```
Kiro via OpenClaude
Status: AUTHORIZED
Authorized at: 2026-05-01T18:30:00Z
```

### Workflow Integration

**Before authorization:**
```bash
maestro agent invoke --run <id> --role FULL_STACK_EXECUTOR
# Error: Provider kiro_openclaude not authorized
# Run: maestro provider auth start --provider kiro_openclaude
```

**After authorization:**
```bash
maestro agent invoke --run <id> --role FULL_STACK_EXECUTOR
# Invocation created: inv-xxx
# Status: RUNNING
# Calling Kiro via OpenClaude...
# Output captured and attached
# Status: SUCCEEDED
```

### Security Considerations

1. **Isolated credentials:** Kiro credentials are stored in the isolated `OPENCLAUDE_HOME` directory
2. **No credential sharing:** Maestro does not reuse the assistant's OpenClaude credentials
3. **Session expiration:** Auth sessions expire after a period (typically 15 minutes for device code)
4. **Manual re-authorization:** If credentials expire, user must re-authorize
5. **No automatic token refresh:** Maestro does not automatically refresh tokens (for now)

### Next Steps

1. ⏳ Investigate OpenClaude auth commands for Kiro
2. ⏳ Implement device code flow in `provider auth start`
3. ⏳ Implement polling in `provider auth poll`
4. ⏳ Add UI for authorization in web app
5. ⏳ Integrate auth check into agent invocation
6. ⏳ Test full authorization flow
7. ⏳ Document Kiro-specific auth requirements

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
