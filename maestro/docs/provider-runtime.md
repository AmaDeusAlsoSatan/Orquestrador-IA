# Provider Runtime

This document describes how Maestro integrates with external LLM providers, specifically OpenClaude as the runtime for Kiro models.

## Overview

Maestro uses a **provider-adapter** architecture:

- **Provider**: The runtime environment (e.g., OpenClaude CLI, Grouter, Kiro CLI)
- **Adapter**: The Maestro integration layer (e.g., `openclaude`, `kiro_openclaude`, `grouter`)
- **Model**: The specific LLM model within the provider (e.g., `best-reasoning-free`)

## Provider Paths

Maestro supports multiple paths to access Kiro models:

### PRIMARY: Grouter + OpenClaude (Recommended)

**Path:** Maestro → Grouter (isolated) → OpenClaude (isolated) → Kiro

**Why this is the primary path:**
- **Isolation:** Grouter and OpenClaude run in isolated directories
- **OAuth/Device Code:** Grouter handles Kiro authorization via AWS Builder ID
- **OpenAI-compatible:** Grouter exposes an OpenAI-compatible endpoint
- **Dashboard:** Visual UI for managing providers and connections
- **Universal Router:** Grouter supports multiple providers, not just Kiro

**Status:** ✅ Implemented and ready for use

### EXPERIMENTAL: Kiro CLI Direct (Quarantined)

**Path:** Maestro → Kiro CLI (direct)

**Why this is experimental:**
- **Global Auth Risk:** Kiro CLI may reuse existing global authentication
- **No Isolation:** Kiro CLI uses global `~/.kiro-cli` directory by default
- **Conflict Risk:** May interfere with other projects (e.g., Kofuku)

**Status:** ⚠️ Quarantined - blocked by default if global auth detected

**Quarantine Rules:**
1. Doctor returns `BLOCKED` if existing global auth is detected
2. Must explicitly set `allowExistingGlobalAuth: true` in config to override
3. Must specify `expectedEmail` to verify correct account
4. Email addresses are masked in output for privacy (e.g., `m*****@gmail.com`)

**Use cases:**
- Discovery and experimentation only
- When you need direct Kiro CLI access for testing
- When you explicitly want to use an existing Kiro CLI session

**Do NOT use for production workflows** - use Grouter instead.

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

## Grouter Bridge (PRIMARY)

### Overview

Grouter is a universal AI router that provides OAuth + API Key providers behind one OpenAI-compatible proxy. It's the **recommended path** for accessing Kiro models in Maestro.

**Key Features:**
- Device code flow for Kiro authorization (AWS Builder ID)
- Isolated data storage (no global config conflicts)
- Dashboard UI for managing providers
- OpenAI-compatible endpoint for easy integration
- Supports multiple providers (Kiro, Claude, OpenAI, etc.)

**Architecture:**
```
Maestro (project/agent manager)
  ↓ references connections via allowlist
Grouter (account vault/manager)
  ↓ exposes OpenAI-compatible endpoint
OpenClaude (CLI/coding agent)
  ↓ uses Grouter endpoint
Kiro (model/provider)
```

## Grouter Account Linking

### Philosophy

**Grouter acts as the account vault/manager. Maestro does not copy credentials.**

Instead of duplicating Kiro authorization, Maestro:
1. Discovers existing Grouter connections (read-only)
2. Links to specific connections via explicit allowlist
3. Stores only safe references (`GrouterConnectionRef`)
4. Never copies tokens, refresh tokens, or raw credentials
5. Masks email addresses for privacy

**Benefits:**
- Single source of truth for accounts (Grouter)
- No credential duplication
- Explicit permission model (allowlist)
- Audit trail of which connections are allowed
- Easy to revoke access (unlink)

### Configuration

Grouter provider config requires three security fields:

```json
{
  "allowGlobalStorageReadOnly": false,
  "linkedConnectionIds": [],
  "strictConnectionAllowlist": true
}
```

**Fields:**
- `allowGlobalStorageReadOnly`: Set to `true` to allow using global Grouter storage in read-only mode
- `linkedConnectionIds`: Array of connection IDs explicitly allowed for Maestro use
- `strictConnectionAllowlist`: If `true`, only linked connections can be used (recommended)

### Doctor States

The Grouter doctor has three states based on linking:

**State A: BLOCKED (no read-only permission)**
```
Status: BLOCKED
Message: Global Grouter storage detected; explicit linking required
Action: Set allowGlobalStorageReadOnly=true and link connections
```

**State B: BLOCKED (read-only but no links)**
```
Status: BLOCKED
Message: Global Grouter storage allowed read-only, but no linked connection exists
Action: Run sync and link commands
```

**State C: READY (read-only with links)**
```
Status: READY
Isolation check: WARN
Message: Using global Grouter storage in explicit linked read-only mode
Details: Found 6 existing connection(s). Linked connections: 1. Strict allowlist: enabled.
```

### Commands

**1. List Grouter Connections**

```bash
maestro provider grouter list
```

Lists all connections in Grouter with masked emails:

```
Grouter connections
  bd8020e4 | unknown | o*************@gmail.com | unknown
  0c010b69 | unknown | (no email) | active
Total: 6 connection(s)
```

**2. Sync Connections**

```bash
maestro provider grouter sync
```

Syncs connection metadata to Maestro state (no credentials copied):

```
Synced 6 Grouter connection ref(s).
No credentials were copied.
```

**3. Link Connection**

```bash
maestro provider grouter link --connection <id> --provider kiro --label "Kiro principal"
```

Links a specific connection for Maestro use:

```
Linked Grouter connection: 0c010b69
  Provider: kiro
  Label: Kiro principal
  Linked at: 2026-05-01T20:37:00.758Z
Connection is now allowed for use by Maestro.
```

**4. Unlink Connection**

```bash
maestro provider grouter unlink --connection <id>
```

Removes permission for Maestro to use the connection (connection remains in Grouter).

**5. Verify with Doctor**

```bash
maestro provider doctor --provider grouter
```

Checks configuration and linked connections.

### Workflow

**Initial Setup:**

1. Ensure Grouter has Kiro connection (via dashboard or CLI)
2. Update Maestro config: `allowGlobalStorageReadOnly: true`
3. Sync connections: `maestro provider grouter sync`
4. Link desired connection: `maestro provider grouter link --connection <id> --provider kiro`
5. Verify: `maestro provider doctor --provider grouter`

**Example:**

```bash
# List available connections
maestro provider grouter list

# Sync to Maestro state
maestro provider grouter sync

# Link Kiro connection
maestro provider grouter link --connection 0c010b69 --provider kiro --label "Kiro principal"

# Verify
maestro provider doctor --provider grouter
# Status: READY
# Linked connections: 1
```

### Security

**What is stored:**
- Connection ID (e.g., `0c010b69`)
- Provider name (e.g., `kiro`)
- Masked email (e.g., `o*************@gmail.com`)
- Label (e.g., `"Kiro principal"`)
- Linked timestamp
- Status (e.g., `active`)

**What is NOT stored:**
- Tokens
- Refresh tokens
- Raw auth output
- Full email addresses (masked by default)
- Credentials of any kind

**Allowlist Enforcement:**

When `strictConnectionAllowlist: true`:
- Only connections in `linkedConnectionIds` can be used
- Attempts to use other connections will be blocked
- Provides audit trail of authorized connections

### Privacy

Email addresses are automatically masked:
- `odachisamadesu@gmail.com` → `o*************@gmail.com`
- `mmahtctqbq80@gmail.com` → `m*************@gmail.com`

Masking preserves first character for identification while protecting privacy.

### Important: Grouter Storage

**Current Limitation:**

Grouter uses global storage (`~/.grouter/grouter.db`) and does not support isolated storage via environment variables or CLI flags.

**Maestro's Approach:**

Instead of trying to isolate Grouter (not possible), Maestro:
1. Accepts that Grouter storage is global
2. Uses explicit linking to control which connections are allowed
3. Never copies credentials
4. Provides audit trail via `linkedConnectionIds`

This is safer than duplicating authorization and maintains Grouter as the single source of truth for accounts.

### Important: Grouter Storage (Continued)

### Important: Isolated Configuration

**Maestro MUST NOT reuse Grouter configuration from other projects (e.g., Kofuku).**

Grouter requires an isolated instance to avoid:
- Interfering with other projects' provider connections
- Mixing authentication sessions
- Conflicting configurations
- Accidental data leakage between contexts

### Configuration

1. **Copy the example configuration:**

```bash
cp config/grouter.example.json data/config/grouter.json
```

2. **Edit `data/config/grouter.json`:**

```json
{
  "executablePath": "grouter",
  "routerUrl": "http://127.0.0.1:3099",
  "dashboardUrl": "http://127.0.0.1:3099/dashboard",
  "provider": "kiro",
  "model": "",
  "openClaudeProfile": "maestro-openclaude",
  "dataHome": "./data/providers/grouter"
}
```

**Key fields:**

- `executablePath`: Path to the Grouter CLI executable (usually just `grouter` if installed globally)
- `routerUrl`: URL where Grouter proxy runs (default: `http://127.0.0.1:3099`)
- `dashboardUrl`: URL for Grouter dashboard UI (default: `http://127.0.0.1:3099/dashboard`)
- `provider`: Provider to use (e.g., `kiro`)
- `model`: Specific model to use (optional, can be set per invocation)
- `openClaudeProfile`: OpenClaude profile name for integration (e.g., `maestro-openclaude`)
- `dataHome`: Isolated directory for Grouter data (e.g., `./data/providers/grouter`)

### Provider Doctor

Before using Grouter, run the provider doctor to verify configuration:

```bash
corepack pnpm run maestro provider doctor --provider grouter
```

The doctor checks:
- ✓ Configuration file exists
- ✓ Executable is configured
- ✓ Grouter responds to --help
- ✓ Data home is configured
- ✓ Data home directory exists or can be created
- ⚠ Grouter daemon status (warns if not running)
- ⚠ Isolation check (warns if global home detected)

**Status:**
- `READY`: Provider is ready to use (PRIMARY provider path)
- `BLOCKED`: Configuration or setup issues need to be fixed
- `ERROR`: Critical errors prevent provider use

### Provider Discovery

After the doctor passes, run discovery to inspect the provider:

```bash
corepack pnpm run maestro provider discover --provider grouter
```

Discovery runs:
- `grouter --help` → saved to `data/providers/grouter/discovery/help.txt`
- `grouter --version` → saved to `data/providers/grouter/discovery/version.txt`
- `grouter status` → saved to `data/providers/grouter/discovery/status.txt`
- `grouter list` → saved to `data/providers/grouter/discovery/list.txt`
- `grouter models` → saved to `data/providers/grouter/discovery/models.txt`
- `grouter config` → saved to `data/providers/grouter/discovery/config.txt`
- Generates `data/providers/grouter/discovery/discovery-report.md`

This is a **read-only** operation that does not modify state or start the daemon.

### Starting Grouter Daemon

To use Grouter, you need to start the daemon:

```bash
grouter serve on
```

This starts:
- Router proxy on port 3099
- Dashboard UI on http://localhost:3099/dashboard
- Per-provider proxies on ports 3100+

**Check status:**

```bash
grouter serve
# or
grouter status
```

**Stop daemon:**

```bash
grouter serve off
```

**View logs:**

```bash
grouter serve logs
```

### Adding Kiro Provider

**Recommended: Via Dashboard (Visual UI)**

1. Start Grouter daemon: `grouter serve on`
2. Open dashboard: http://localhost:3099/dashboard
3. Click "Add Provider"
4. Select "Kiro"
5. Complete device code flow:
   - Grouter displays user code (e.g., `LTPF-NRNC`)
   - Grouter displays verification URL
   - Open URL in browser
   - Enter code and authorize with AWS Builder ID
   - Grouter saves credentials in isolated storage
6. Provider is now available

**Alternative: Via CLI**

```bash
grouter add
# Follow interactive wizard
# Select Kiro
# Complete device code flow
```

**Verify provider:**

```bash
grouter list
# Should show Kiro connection with status
```

### Connecting OpenClaude to Grouter

After adding Kiro provider to Grouter, connect OpenClaude:

```bash
grouter up openclaude --provider kiro
```

**⚠️ WARNING:** Before running this command, verify that it supports isolated OpenClaude home/profile. Check:

```bash
grouter up openclaude --help
```

Look for flags like:
- `--profile <name>`
- `--home <path>`
- `--config <path>`

If no isolation flags exist, you may need to set `OPENCLAUDE_HOME` environment variable before running.

### Isolation Verification

After setup, verify isolation:

```bash
# Check Grouter data location
grouter config

# Should show isolated path, NOT ~/.grouter
```

If you see `~/.grouter` or global paths, isolation is NOT confirmed. This is a risk for conflicts with other projects.

### Testing Grouter Connection

Test the Kiro connection:

```bash
grouter test
# or
grouter test <kiro-connection-id>
```

This verifies that Grouter can communicate with Kiro using the stored credentials.

### Next Steps for Grouter Integration

1. ✅ Run `maestro provider doctor --provider grouter`
2. ✅ Run `maestro provider discover --provider grouter`
3. ⏳ Start Grouter daemon: `grouter serve on`
4. ⏳ Add Kiro provider via dashboard
5. ⏳ Connect OpenClaude to Grouter (verify isolation first)
6. ⏳ Test Grouter connection
7. ⏳ Implement Grouter adapter in Maestro agents
8. ⏳ Test with a simple invocation
9. ⏳ Integrate into full workflow

## Kiro CLI Direct (EXPERIMENTAL - Quarantined)

### Overview

Kiro CLI provides direct access to Kiro models without Grouter or OpenClaude. However, it has **serious isolation risks** and is **quarantined by default**.

**⚠️ WARNING: This provider is EXPERIMENTAL and NOT recommended for production use.**

### Why Quarantined?

1. **Global Auth Detection:** Kiro CLI may reuse existing global authentication from other projects
2. **No Isolation:** Kiro CLI uses global `~/.kiro-cli` directory by default
3. **Conflict Risk:** May interfere with other projects (e.g., Kofuku)
4. **Account Confusion:** May use wrong account without explicit verification

### Configuration

1. **Copy the example configuration:**

```bash
cp config/kiro-cli.example.json data/config/kiro-cli.json
```

2. **Edit `data/config/kiro-cli.json`:**

```json
{
  "executablePath": "C:\\Users\\YourUser\\AppData\\Local\\Kiro-Cli\\kiro-cli.EXE",
  "timeoutMs": 300000,
  "trustAllTools": false,
  "defaultAgent": "",
  "defaultModel": "",
  "allowExistingGlobalAuth": false,
  "expectedEmail": "",
  "isolationMode": "unknown"
}
```

**Security fields:**

- `allowExistingGlobalAuth`: Set to `true` to allow using existing global auth (NOT recommended)
- `expectedEmail`: Email address to verify (e.g., `your-email@example.com`)
- `isolationMode`: `"unknown"`, `"global"`, or `"isolated"` (for documentation only)

### Provider Doctor

Run the provider doctor to check configuration:

```bash
corepack pnpm run maestro provider doctor --provider kiro_cli
```

**Quarantine Behavior:**

If doctor detects existing global auth:
- Status: `BLOCKED`
- Message: "Existing global Kiro CLI auth detected"
- Details: "This may belong to Kofuku or another project. Set allowExistingGlobalAuth=true in config to override, or use Grouter provider instead."

**Email Masking:**

For privacy, email addresses are masked in output:
- `mmahtctqbq80@gmail.com` → `m*****@gmail.com`

**Override Quarantine (NOT recommended):**

To use existing global auth:

1. Set `allowExistingGlobalAuth: true` in config
2. Set `expectedEmail: "your-email@example.com"` to verify correct account
3. Run doctor again

If email doesn't match, doctor will still block.

### Provider Discovery

After doctor passes (or quarantine is overridden), run discovery:

```bash
corepack pnpm run maestro provider discover --provider kiro_cli
```

Discovery runs:
- `kiro-cli --help` → saved to `data/providers/kiro-cli/discovery/help.txt`
- `kiro-cli login --help` → saved to `data/providers/kiro-cli/discovery/login-help.txt`
- `kiro-cli chat --help` → saved to `data/providers/kiro-cli/discovery/chat-help.txt`
- `kiro-cli whoami --help` → saved to `data/providers/kiro-cli/discovery/whoami-help.txt`
- `kiro-cli --version` → saved to `data/providers/kiro-cli/discovery/version.txt`
- Generates `data/providers/kiro-cli/discovery/discovery-report.md`

### When to Use Kiro CLI Direct

**Valid use cases:**
- Discovery and experimentation only
- Testing Kiro CLI commands and flags
- When you explicitly want to use an existing Kiro CLI session for testing

**Do NOT use for:**
- Production workflows (use Grouter instead)
- Automated agent invocations (use Grouter instead)
- Any scenario where isolation is important

### Recommendation

**Use Grouter instead.** It provides the same Kiro access with proper isolation and better integration.

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
