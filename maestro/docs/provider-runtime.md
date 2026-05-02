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

## OpenClaude-Grouter Provider Test

### Overview

The provider test command allows you to test OpenClaude via Grouter with a minimal prompt **without integrating into runs or modifying projects**. This is a safe way to validate that the entire chain (Maestro → OpenClaude → Grouter → Kiro) is working correctly.

### Command

```bash
maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST
```

Debug mode:

```bash
maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST --debug --timeout-ms 30000 --variant minimal
```

Supported variants:

- `minimal`: `-p --provider openai --model <model> <prompt>`
- `json`: `-p --provider openai --model <model> --output-format json <prompt>`
- `bare`: `-p --provider openai --model <model> --bare <prompt>`
- `no-session`: `-p --provider openai --model <model> --no-session-persistence <prompt>`
- `current`: current full harness flags, including json, bare, and no-session

### Requirements

**Explicit Confirmation:**
- The `--confirm RUN_PROVIDER_TEST` flag is **required**
- Without this flag, the command will block
- This prevents accidental execution

**Pre-flight Checks (BLOCKING):**
1. ✓ Config file exists: `data/config/openclaude-grouter.json`
2. ✓ Provider doctor is READY
3. ✓ **Grouter daemon is running** (BLOCKING for test, unlike doctor which only warns)
4. ✓ **Model is configured** in config file
5. ✓ Linked connection exists and is in allowlist

**Note:** For doctor/discovery, Grouter daemon offline is only a WARNING. For test execution, it's BLOCKING.

### What It Does

1. Loads `data/config/openclaude-grouter.json`
2. Runs all pre-flight checks
3. Executes OpenClaude in non-interactive mode:
   ```bash
   node <openclaude-bin> -p --provider openai --output-format json "<prompt>"
   ```
4. Injects environment variables:
   - `OPENCLAUDE_HOME=./data/providers/openclaude-grouter`
   - `OPENAI_BASE_URL=http://127.0.0.1:3099/v1`
   - `OPENAI_API_KEY=any-value`
   - `OPENAI_MODEL=<model>`
5. Captures stdout and stderr
6. Saves all outputs to test directory

### What It Does NOT Do

- ❌ Does not attach output to any run
- ❌ Does not modify project state
- ❌ Does not modify repository
- ❌ Does not integrate with AgentInvocation
- ❌ Does not commit anything to git

### Output Location

All test outputs are saved to:

```
data/providers/openclaude-grouter/tests/<timestamp>/
  00-test-metadata.json   # Test configuration
  01-prompt.md            # The prompt sent
  02-stdout.txt           # OpenClaude stdout
  03-stderr.txt           # OpenClaude stderr
  04-result.md            # Full test report
```

When `--debug` is enabled, additional files are saved:

```text
  05-command.txt
  06-env-sanitized.json
  07-grouter-status.txt
  08-grouter-models.txt
  09-openclaude-home-tree.txt
  10-direct-grouter-request.json
  11-direct-grouter-response.json
  12-grouter-serve-logs-before.txt
  13-openclaude-fresh-home-help.txt
  14-openclaude-fresh-home-tree.txt
  15-grouter-serve-logs-after.txt
  16-debug-report.md
```

**These files are NOT committed to git** (excluded via `.gitignore`).

### Example: Model Not Configured

```bash
$ maestro provider test --provider openclaude_grouter --prompt "OK" --confirm RUN_PROVIDER_TEST

Pre-flight checks:

✓ Doctor status: READY
✓ Grouter daemon: RUNNING
✗ Model: NOT CONFIGURED

Model is not configured in data/config/openclaude-grouter.json.
Run: grouter models
Then set model in config.

Error: Model is not configured
```

### Example: Daemon Not Running

```bash
$ maestro provider test --provider openclaude_grouter --prompt "OK" --confirm RUN_PROVIDER_TEST

Pre-flight checks:

✓ Doctor status: READY
✗ Grouter daemon: NOT RUNNING

Grouter daemon is required for provider test.
Run: grouter serve on

Error: Grouter daemon is not running
```

### Example: Successful Test

```bash
$ maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST

Pre-flight checks:

✓ Doctor status: READY
✓ Grouter daemon: RUNNING
✓ Model: claude-sonnet-4
✓ Linked connection: 0c010b69 (Kiro principal)

All pre-flight checks passed. Executing test...

Executing: node C:\...\openclaude\bin\openclaude -p --provider openai --output-format json Responda apenas: OK

Test completed.

Exit code: 0
Status: SUCCESS

Stdout (first 500 chars):
{"response":"OK"}

Full result saved to: data/providers/openclaude-grouter/tests/2026-05-01T21-30-00-000Z/04-result.md
```

### Workflow

**Before running test:**

1. Ensure Grouter daemon is running:
   ```bash
   grouter serve on
   ```

2. Check available models:
   ```bash
   grouter models
   ```

3. Configure model in `data/config/openclaude-grouter.json`:
   ```json
   {
     "model": "claude-sonnet-4",
     ...
   }
   ```

4. Run provider doctor:
   ```bash
   maestro provider doctor --provider openclaude_grouter
   ```

5. Run test:
   ```bash
   maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST
   ```

### Security

- ✓ Requires explicit confirmation flag
- ✓ Does not touch project repositories
- ✓ Does not modify Maestro state
- ✓ Outputs are not committed to git
- ✓ Email addresses are masked in logs
- ✓ No tokens are logged

## Debugging OpenClaude-Grouter timeouts

If the provider test hangs or times out, do not wire it into `AgentInvocation` yet. First isolate where the chain fails:

```text
Maestro -> OpenClaude -> Grouter -> Kiro
```

Use variants to identify flag-specific issues:

```bash
maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST --debug --timeout-ms 30000 --variant minimal
maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST --debug --timeout-ms 30000 --variant json
maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST --debug --timeout-ms 30000 --variant bare
maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST --debug --timeout-ms 30000 --variant no-session
maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST --debug --timeout-ms 30000 --variant current
```

How to read the results:

- If `10-direct-grouter-request.json` / `11-direct-grouter-response.json` succeeds but OpenClaude times out, the problem is likely OpenClaude flags, config, or `OPENCLAUDE_HOME`.
- If the direct Grouter request fails or times out, the problem is likely Grouter, the model name, endpoint compatibility, or the linked Kiro connection.
- If `09-openclaude-home-tree.txt` or `14-openclaude-fresh-home-tree.txt` shows unexpected config/session files, verify OpenClaude is respecting the isolated `OPENCLAUDE_HOME`.
- If outputs mention `kofuku-auto`, stop and investigate global config leakage before continuing.

The harness kills timed-out processes and records partial stdout/stderr, so every failed run should still leave a usable report under `data/providers/openclaude-grouter/tests/<timestamp>/`.

### Next Steps After Successful Test

Once the test responds correctly (e.g., "OK"), the next phase will be:

1. Connect `openclaude_grouter` to `AgentInvocation`
2. Start with Supervisor/Reviewer roles (no file modifications)
3. Then add Executor role (with file modifications in sandbox)
4. Integrate into full workflow

## OpenClaude-Grouter Integration (AgentInvocation)

### Overview

The `openclaude_grouter` provider enables Maestro agents to use Kiro models through a fully isolated chain:

```
Maestro AgentInvocation
  ↓
OpenClaude (isolated settings)
  ↓
Grouter (fake streaming)
  ↓
Kiro Translator
  ↓
AWS CodeWhisperer
```

**Key Features:**
- **Complete Isolation:** OpenClaude uses isolated settings file via `--settings` flag
- **No Global Conflicts:** Does not interfere with Kofuku or other projects
- **Automatic Setup:** Settings file created automatically on first use
- **Stdin Prompts:** Prompts passed via stdin to avoid Windows quoting issues
- **Fake Streaming:** Grouter provides simulated SSE streaming for OpenClaude compatibility

**Status:** ✅ Implemented and validated

### Difference from Direct Grouter

**Direct Grouter (`grouter` provider):**
- Used for provider testing and discovery
- Requires manual Grouter daemon management
- Direct HTTP requests to Grouter endpoint
- Good for: Testing, debugging, manual invocations

**OpenClaude-Grouter (`openclaude_grouter` provider):**
- Used for agent invocations in runs
- OpenClaude CLI wraps Grouter endpoint
- Isolated settings per project
- Good for: Production workflows, automated agent execution

### Configuration

**File:** `data/config/openclaude-grouter.json`

```json
{
  "openclaudeBin": "C:\\Users\\YourUser\\AppData\\Roaming\\npm\\node_modules\\openclaude\\bin\\openclaude",
  "model": "kiro/claude-sonnet-4.5",
  "grouterBaseUrl": "http://127.0.0.1:3099/v1",
  "grouterApiKey": "any-value"
}
```

**Required Fields:**

- `openclaudeBin`: Path to OpenClaude CLI executable
- `model`: Kiro model to use (e.g., `kiro/claude-sonnet-4.5`)
- `grouterBaseUrl`: Grouter endpoint URL (default: `http://127.0.0.1:3099/v1`)
- `grouterApiKey`: API key for Grouter (can be any value, e.g., `any-value`)

**Optional Fields:**

- `timeoutMs`: Timeout for invocations (default: 300000 = 5 minutes)
- `homeDir`: Custom isolated home directory (default: `data/providers/openclaude-grouter/home`)

### Isolation Strategy

**OpenClaude Isolation:**

The provider creates an isolated OpenClaude settings file:

```
data/providers/openclaude-grouter/home/settings.json
```

This file contains:
```json
{
  "baseUrl": "http://127.0.0.1:3099/v1",
  "apiKey": "any-value",
  "model": "kiro/claude-sonnet-4.5"
}
```

**How Isolation Works:**

1. Maestro calls `ensureOpenClaudeIsolation()` before each invocation
2. Function creates isolated home directory if needed
3. Function writes isolated `settings.json` with Grouter config
4. OpenClaude invoked with `--settings <isolated-path>` flag
5. OpenClaude uses isolated settings, ignoring global `~/.openclaude/settings.json`

**Benefits:**

- ✅ Kofuku continues using global settings (port 3104, model `kofuku-auto`)
- ✅ Maestro uses isolated settings (port 3099, model `kiro/claude-sonnet-4.5`)
- ✅ No manual configuration switching required
- ✅ No risk of interfering with other projects

**Grouter Storage:**

Grouter continues using global storage (`~/.grouter/grouter.db`) by design. This is acceptable because:
- Grouter acts as account vault/manager
- Maestro uses explicit connection linking (allowlist)
- No credential duplication
- Single source of truth for Kiro authorization

### Command Execution

**Provider Test:**

```bash
maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST
```

**Agent Invocation (Automatic):**

When an agent is configured with `openclaude_grouter` provider, Maestro automatically:

1. Loads config from `data/config/openclaude-grouter.json`
2. Ensures isolated OpenClaude home exists
3. Writes isolated settings file
4. Builds command: `node <openclaude-bin> -p --provider openai --model <model>`
5. Passes prompt via stdin (avoids Windows quoting issues)
6. Injects `--settings <isolated-path>` flag
7. Captures stdout and returns as agent output

**Example Command:**

```bash
node C:\...\openclaude\bin\openclaude -p --provider openai --model kiro/claude-sonnet-4.5 --settings C:\...\maestro\data\providers\openclaude-grouter\home\settings.json
```

**Stdin Input:**
```
Your task is to...
```

### Workflow

**Initial Setup:**

1. Ensure Grouter daemon is running:
   ```bash
   grouter serve on
   ```

2. Verify Grouter has Kiro connection:
   ```bash
   grouter list
   ```

3. Create config file:
   ```bash
   cp config/openclaude-grouter.example.json data/config/openclaude-grouter.json
   ```

4. Edit config with correct paths and model

5. Run provider test:
   ```bash
   maestro provider test --provider openclaude_grouter --prompt "Responda apenas: OK" --confirm RUN_PROVIDER_TEST
   ```

6. If test passes, provider is ready for agent invocations

**Agent Configuration:**

In `data/config/agent-model-map.json`:

```json
{
  "CTO_SUPERVISOR": {
    "provider": "openclaude_grouter",
    "model": "kiro/claude-sonnet-4.5"
  },
  "FULL_STACK_EXECUTOR": {
    "provider": "openclaude_grouter",
    "model": "kiro/claude-sonnet-4.5"
  },
  "CODE_REVIEWER": {
    "provider": "openclaude_grouter",
    "model": "kiro/claude-sonnet-4.5"
  }
}
```

### Runtime Agent Profiles

**Important:** AgentInvocation uses the `AgentProfile` stored in Maestro state as the effective runtime configuration. The `agent-model-map.json` file may be used as a planning/local reference, but it does not override the runtime AgentProfile unless explicitly wired into the runtime.

**To change the provider/model used by an agent at runtime, use:**

```bash
maestro agents update --agent cto-supervisor --provider openclaude_grouter --model "kiro/claude-sonnet-4.5"
maestro agents update --agent full-stack-executor --provider openclaude_grouter --model "kiro/claude-sonnet-4.5"
maestro agents update --agent code-reviewer --provider openclaude_grouter --model "kiro/claude-sonnet-4.5"
```

**To verify the effective runtime profile:**

```bash
maestro agents list
maestro agents show --agent cto-supervisor
maestro agents show --agent full-stack-executor
maestro agents show --agent code-reviewer
```

**Configuration Precedence:**

1. **AgentProfile (State)** - Used by AgentInvocation runtime ✅
2. **agent-model-map.json** - Local reference only (not used by runtime) ⚠️

**Storage:**

Agent profiles are stored in Maestro's internal state (not version controlled). Changes made via `maestro agents update` persist automatically and take effect immediately for new invocations.

### Validated Chain

The complete chain has been validated:

**Provider Test:**
- ✅ Exit code: 0
- ✅ Status: SUCCESS
- ✅ Output: "OK"

**Agent Invocation:**
- ✅ Status: SUCCEEDED
- ✅ Output: "OK"
- ✅ Isolated settings used
- ✅ Global Kofuku settings preserved

**Full Chain:**
1. ✅ Maestro AgentInvocation → Prompt prepared
2. ✅ OpenClaude (isolated) → Receives prompt via stdin
3. ✅ Grouter (fake streaming) → Wraps response in SSE format
4. ✅ Kiro Translator → Calls AWS SDK
5. ✅ AWS CodeWhisperer → Returns response

### Security

**What is Isolated:**
- ✅ OpenClaude settings file
- ✅ OpenClaude home directory
- ✅ No interference with global OpenClaude config

**What is NOT Isolated:**
- ⚠️ Grouter storage (global by design)
- ⚠️ Grouter daemon (shared across projects)

**Mitigation:**
- Grouter uses explicit connection linking (allowlist)
- Maestro never copies credentials
- Grouter acts as single source of truth for accounts

**Privacy:**
- Email addresses masked in logs
- No tokens logged
- Settings file contains only endpoint config (no credentials)

### Troubleshooting

**Issue: Provider test times out**

Check:
1. Is Grouter daemon running? `grouter serve`
2. Is Kiro connection active? `grouter list`
3. Is model correct? `grouter models`
4. Check Grouter logs: `grouter serve logs`

**Issue: "Existing global auth detected"**

This is expected for Grouter. The provider uses explicit linking, not isolation.

**Issue: OpenClaude uses wrong settings**

Verify:
1. `--settings` flag is being passed
2. Isolated settings file exists: `data/providers/openclaude-grouter/home/settings.json`
3. Settings file contains correct Grouter endpoint

**Issue: Kofuku affected by Maestro**

This should NOT happen. Verify:
1. Kofuku uses global settings: `~/.openclaude/settings.json`
2. Maestro uses isolated settings: `data/providers/openclaude-grouter/home/settings.json`
3. Check Kofuku settings file is unchanged

### Limitations

**Current Limitations:**

1. **Fake Streaming:** Grouter simulates SSE streaming over non-streaming Kiro SDK
   - Not true incremental token streaming
   - Full response generated before streaming starts
   - Sufficient for OpenClaude compatibility

2. **Windows .cmd Files:** Special handling required for `.cmd` files with spaces in paths
   - Uses `cmd.exe /c` with `shell: false`
   - Avoids DEP0190 warnings

3. **Exit Code 3221226505:** OpenClaude crash exit code
   - Treated as success only if stdout is not empty
   - Requires explicit flag: `allowStackBufferOverrunWithStdout: true`

### Next Steps

**After Successful Validation:**

1. ✅ Provider test passing
2. ✅ Agent invocation passing
3. ⏭️ Configure all agents (Supervisor, Executor, Reviewer)
4. ⏭️ Test with real task (e.g., documentation update)
5. ⏭️ Integrate into full workflow (CEO → Supervisor → Executor → Reviewer)
6. ⏭️ Test with production project (e.g., One Piece Tag Force)

### Prompt Identity Boundary

**Important:** OpenClaude is a transport/runtime detail. Agent prompts must NOT identify the model as "OpenClaude".

**Why this matters:**

When using Kiro/Amazon Q through OpenClaude, the model may reject prompts that identify it as "OpenClaude" because:
- OpenClaude is just the CLI/transport layer
- The actual model is Kiro/Amazon Q
- Identity mismatch causes the model to respond: "I'm not the system described in that prompt — I'm Amazon Q..."

**Correct approach:**

Use role-based identity in agent prompts:
- **CTO Supervisor:** "You are operating as the CTO Supervisor role in Maestro"
- **Full Stack Executor:** "You are operating as the Full Stack Executor role in Maestro"
- **Code Reviewer:** "You are operating as the Code Reviewer role in Maestro"

**Add to all agent prompts:**
```
Do not discuss your model identity, provider, transport, or runtime.
```

This avoids provider/model identity conflicts, especially with Kiro/Amazon Q.

**Implementation:**

Agent prompts are generated in `packages/memory/src/run-prepare.ts`:
- `renderCodexSupervisorPrompt()` - CTO Supervisor role
- `renderKiroExecutorPrompt()` - Full Stack Executor role
- `renderCodexReviewerPrompt()` - Code Reviewer role

Each prompt uses role-based identity and explicitly instructs the model not to discuss its identity.

### Agent Invocation Stage Promotion

**Automatic Output Promotion:**

When an AgentInvocation succeeds and passes its output contract, Maestro automatically promotes the output into the corresponding run stage artifact.

**Role to Stage Mapping:**

| Agent Role | Invocation Stage | Run Stage | Output File | Next Run Status |
|------------|------------------|-----------|-------------|-----------------|
| CTO_SUPERVISOR | SUPERVISOR_PLAN | supervisor | 07-supervisor-output.md | SUPERVISOR_PLANNED |
| FULL_STACK_EXECUTOR | EXECUTOR_IMPLEMENT | executor | 08-executor-output.md | EXECUTOR_REPORTED |
| CODE_REVIEWER | REVIEWER_REVIEW | reviewer | 09-reviewer-output.md | REVIEWED |
| CEO | CEO_INTAKE | (none) | (not promoted) | (unchanged) |
| QA_VALIDATOR | QA_VALIDATE | (none) | (not promoted) | (unchanged) |

**How It Works:**

1. Agent invocation executes via `prepareAgentInvocation()`
2. Output is validated against output contract
3. If status is `SUCCEEDED`, output is automatically promoted:
   - Output copied to run stage file (e.g., `07-supervisor-output.md`)
   - Run status updated (e.g., `PREPARED` → `SUPERVISOR_PLANNED`)
   - Next stage prompt regenerated with new context
4. If promotion fails, invocation still succeeds but warning is logged

**Benefits:**

- ✅ No manual `maestro run attach` required
- ✅ Automatic workflow progression
- ✅ Consistent with manual attach behavior
- ✅ Preserves both invocation artifact and run stage artifact

**Implementation:**

Automatic promotion is implemented in:
- `apps/cli/src/index.ts` - `invokeAgentCommand()` function
- `apps/server/src/index.ts` - `invokeRunAgentRoute()` function

Both reuse the existing `attachRunStage()` function from `packages/memory/src/run-lifecycle.ts`.

### References

**Related Documentation:**
- [Grouter Bridge (PRIMARY)](#grouter-bridge-primary)
- [OpenClaude-Grouter Provider Test](#openclaude-grouter-provider-test)
- [Grouter Account Linking](#grouter-account-linking)

**Related Files:**
- `packages/providers/src/openclaude-home.ts` - Isolation module
- `packages/providers/src/command-runner.ts` - Command execution
- `packages/agents/src/runtime.ts` - Agent runtime adapter
- `packages/agents/src/output-contracts.ts` - Output validation
- `packages/memory/src/run-prepare.ts` - Prompt generation with role-based identity
- `packages/memory/src/run-lifecycle.ts` - Run stage attachment
- `apps/cli/src/index.ts` - CLI with automatic promotion
- `apps/server/src/index.ts` - Server with automatic promotion

**Commits:**
- `5e42f05` - fix: isolate openclaude grouter runtime
- `2d4ab76` - feat: enable openclaude grouter agent invocations
- `14e7943` - fix: pass openclaude grouter prompts via stdin
- `66fff76` - fix: use role-based agent prompt identity

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


## OpenClaude-Grouter stdin mode

On Windows, prompts must be passed to OpenClaude through stdin instead of as a positional CLI argument.

**Reason:** Passing the prompt as a positional argument through `openclaude.cmd` may break quoting and split prompts containing spaces, punctuation, quotes, accents, or multiline content.

**The working invocation is:**

```text
openclaude.cmd -p
```

The Maestro writes the prompt to stdin.

**Validated chain:**

```
Maestro → OpenClaude → Grouter → Kiro
```

**Result:**
- Exit code: 0
- Stdout: OK

This approach ensures that prompts with any content (spaces, special characters, multilingual text, etc.) are passed intact to OpenClaude without being fragmented by Windows shell quoting rules.

## Run Workspace Creation

### Overview

Maestro creates isolated workspace sandboxes for agent execution using Git clone instead of recursive filesystem copy. This approach is fast, safe, and avoids copying unwanted artifacts.

**Benefits:**
- ✅ Fast creation (seconds instead of minutes)
- ✅ Only copies versioned files (no `node_modules`, `dist`, `data/`, `.tmp`)
- ✅ Clean workspace (no Maestro artifacts from source)
- ✅ Safe isolation (original repository untouched)
- ✅ Git-aware (preserves repository structure and history)

### Implementation

**Method:** `git clone --local --no-hardlinks`

**Location:** `packages/runner/src/workspace-manager.ts`

**How it works:**

1. Detect Git repository root using `git rev-parse --show-toplevel`
2. Clone repository locally: `git clone --local --no-hardlinks <gitRoot> <workspacePath>`
3. Handle monorepo case (if source is subdirectory of Git root)
4. Configure workspace Git (user.name, user.email, core.longpaths)
5. Create Maestro metadata directory (`.maestro/`)
6. Exclude metadata from Git tracking

**Monorepo Support:**

If the source repository is a subdirectory of a Git root (e.g., Maestro project inside a monorepo):
- Clone from Git root
- Set `effectiveWorkspacePath` to subdirectory within workspace
- Agents work in subdirectory, not root

**Example:**

```bash
# Source: C:\Projects\monorepo\maestro
# Git root: C:\Projects\monorepo
# Workspace: C:\Projects\maestro\data\workspaces\project\run-id
# Effective path: C:\Projects\maestro\data\workspaces\project\run-id\maestro
```

### Performance

**Before (recursive copy):**
- Time: 120+ seconds
- Risk: Copying `node_modules`, `dist`, `data/`, `workspaces/`, `.tmp`, logs, etc.
- Result: Huge workspace with unwanted artifacts

**After (git clone):**
- Time: ~6 seconds
- Risk: None (only versioned files copied)
- Result: Clean workspace with only source code

**Measured:**
```bash
Measure-Command { maestro run workspace create --run <id> }
# TotalSeconds: 5.98
```

### Workspace Structure

**Created files:**

```
<workspacePath>/
  .git/                           # Git repository
  .maestro/                       # Maestro metadata (excluded from Git)
    README-MAESTRO-WORKSPACE.md   # Workspace documentation
    workspace-metadata.json       # Workspace state
  <project files>                 # Only versioned files from Git
```

**Not copied:**
- `node_modules/`
- `dist/`
- `data/`
- `workspaces/`
- `.tmp/`
- Logs, outputs, artifacts
- Any file ignored by `.gitignore`

### Commands

**Create workspace:**

```bash
maestro run workspace create --run <run-id>
```

**Check workspace status:**

```bash
maestro run show --run <run-id>
# Shows: Workspace exists: yes
#        Workspace status: CREATED
#        Workspace path: <path>
```

**Capture diff:**

```bash
maestro run workspace diff --run <run-id>
```

**Create patch:**

```bash
maestro run workspace patch --run <run-id> --out <patch-file>
```

### Workspace Lifecycle

1. **CREATED:** Workspace created, no changes yet
2. **MODIFIED:** Agent has made changes (detected via git status)
3. **CAPTURED:** Diff captured to run artifacts
4. **APPLIED:** Changes applied back to original repository (future)

### Safety Rules

**Agents must:**
- ✅ Work only inside workspace path
- ✅ Never modify original repository
- ✅ Respect workspace boundaries

**Maestro ensures:**
- ✅ Original repository never touched during execution
- ✅ Changes captured via Git diff
- ✅ Human approval required before applying changes
- ✅ Workspace can be deleted without affecting original

### Integration with Executor

**Workflow:**

1. Run prepared (status: `PREPARED`)
2. Workspace created automatically for Executor (if needed)
3. Executor generates unified diff patch
4. Maestro validates and applies patch to workspace
5. Maestro captures diff after execution
6. Executor output promoted (status: `EXECUTOR_REPORTED`)
7. Reviewer reviews diff
8. Human approves changes
9. Maestro applies patch to original repository (future)

### Troubleshooting

**Issue: Workspace creation times out**

Check:
1. Is source a Git repository? `git rev-parse --show-toplevel`
2. Is Git installed and in PATH? `git --version`
3. Is workspace path writable?

**Issue: Workspace contains unwanted files**

This should NOT happen with git clone. If it does:
1. Check `.gitignore` in source repository
2. Verify files are not versioned: `git ls-files`
3. Report as bug

**Issue: Monorepo subdirectory not working**

Verify:
1. Source path is inside Git repository
2. Effective workspace path is set correctly
3. Check workspace metadata: `<workspace>/.maestro/workspace-metadata.json`

### References

**Related Files:**
- `packages/runner/src/workspace-manager.ts` - Workspace creation
- `packages/runner/src/git-inspector.ts` - Git diff capture
- `packages/memory/src/run-lifecycle.ts` - Run lifecycle integration

**Related Commands:**
- `maestro run workspace create` - Create workspace
- `maestro run workspace diff` - Capture diff
- `maestro run workspace patch` - Create patch file
- `maestro run show` - Show workspace status

## Patch-Based Executor Mode

### Overview

The Full Stack Executor does not write files directly. Instead, it generates a unified diff patch that Maestro validates and applies inside the workspace sandbox. The original repository remains untouched until review, human approval, and patch promotion.

**Architecture:**

```
Supervisor Plan
  ↓
Executor generates unified diff
  ↓
Maestro extracts patch from output
  ↓
Maestro validates patch safety
  ↓
Maestro checks patch can be applied (git apply --check)
  ↓
Maestro applies patch to workspace sandbox
  ↓
Maestro captures real diff
  ↓
Executor output promoted to run stage
  ↓
Reviewer reviews diff
  ↓
Human approval
  ↓
Patch applied to original repository (future)
```

**Benefits:**
- ✅ **Security:** AI doesn't edit files directly
- ✅ **Control:** Maestro validates before applying
- ✅ **Auditability:** Explicit diff before application
- ✅ **Compatibility:** Works regardless of AI tools available
- ✅ **Safety:** Original repository never touched during execution

### Executor Prompt

The Executor prompt (`packages/memory/src/run-prepare.ts`) instructs the agent to:

1. Generate a unified diff patch (not direct file edits)
2. Use standard `git diff` format
3. Include proper context lines
4. Use relative paths from repository root
5. Return output in specific format with `## Patch` section

**Required Output Format:**

```markdown
## Implementação
[Description of what the patch changes]

## Arquivos Alterados
[List of files modified by the patch]

## Patch
\`\`\`diff
diff --git a/path/to/file b/path/to/file
index abc123..def456 100644
--- a/path/to/file
+++ b/path/to/file
@@ -1,3 +1,4 @@
 existing line
+new line
 existing line
\`\`\`

## Validação
[What should be checked after applying]

## Resultado
PATCH_PROPOSED
```

### Output Contract Validation

The Executor output contract (`packages/agents/src/output-contracts.ts`) validates:

1. ✓ Presence of `## Implementação` section
2. ✓ Presence of `## Patch` section
3. ✓ Presence of unified diff markers (`diff --git` or `---`/`+++`/`@@`)
4. ✓ Presence of result section

If validation fails, the invocation is marked as `FAILED` with a clear error message.

### Patch Extraction

The patch extractor (`packages/agents/src/patch-extractor.ts`) extracts unified diffs from agent output:

**Extraction Methods:**

1. **Fenced code blocks:** ` ```diff ... ``` ` or ` ```patch ... ``` `
2. **Unfenced diff:** Content starting with `diff --git`
3. **Unified diff markers:** Lines with `---`, `+++`, `@@`

**Safety Validation:**

- ✗ No absolute paths (security risk)
- ✗ No command substitution (`$(...)`, backticks)
- ✗ No `eval()` or `exec()` calls
- ✓ Must be valid unified diff format

### Patch Application

The patch applier (`packages/runner/src/patch-applier.ts`) applies patches to workspaces:

**Process:**

1. **Check:** `git apply --check <patch>` - validates patch can be applied cleanly
2. **Apply:** `git apply <patch>` - applies patch to workspace
3. **Capture:** Maestro captures real diff from workspace

**Failure Handling:**

If patch check or apply fails:
- Invocation marked as `FAILED`
- Error message includes `git apply` stderr
- Patch artifact saved for debugging
- Original repository untouched

### Workflow Integration

**CLI Integration** (`apps/cli/src/index.ts`):

When `maestro agent invoke --role FULL_STACK_EXECUTOR` succeeds:

1. Extract patch from agent output
2. Validate patch safety
3. Save patch artifact (`03-proposed.patch`)
4. Ensure workspace exists (create if needed)
5. Check patch can be applied (`git apply --check`)
6. Apply patch to workspace (`git apply`)
7. Capture workspace diff
8. Promote to run stage if all steps succeed

If any step fails, invocation is marked as `FAILED` with detailed error message.

### Example Usage

**Prepare run:**

```bash
maestro run prepare --project my-project --task my-task-001
```

**Invoke Supervisor:**

```bash
maestro agent invoke --run <run-id> --role CTO_SUPERVISOR
# Supervisor generates plan
# Run status: SUPERVISOR_PLANNED
```

**Invoke Executor:**

```bash
maestro agent invoke --run <run-id> --role FULL_STACK_EXECUTOR
# Executor generates unified diff patch
# Maestro extracts and validates patch
# Maestro applies patch to workspace sandbox
# Workspace diff captured
# Run status: EXECUTOR_REPORTED
```

**Review workspace diff:**

```bash
maestro run workspace diff --run <run-id>
# Shows actual changes in workspace
```

**Invoke Reviewer:**

```bash
maestro agent invoke --run <run-id> --role CODE_REVIEWER
# Reviewer analyzes diff and provides verdict
# Run status: REVIEWED
```

### Artifacts

**Patch artifacts saved:**

```
data/runs/<project>/<run-id>/agents/<invocation-id>/
  01-input-prompt.md      # Prompt sent to agent
  02-output.md            # Agent output with patch
  03-proposed.patch       # Extracted unified diff patch
```

**Run artifacts updated:**

```
data/runs/<project>/<run-id>/
  08-executor-output.md   # Promoted executor output
  12-git-after-executor.md # Git status after execution
  13-git-diff.md          # Real diff from workspace
  14-changed-files.md     # List of changed files
```

### Security

**Patch Safety Checks:**

- ✓ No absolute paths
- ✓ No command injection patterns
- ✓ Valid unified diff format
- ✓ Applied in isolated workspace sandbox
- ✓ Original repository never touched

**Workspace Isolation:**

- ✓ Workspace created via `git clone --local`
- ✓ Only versioned files copied
- ✓ Changes captured via Git diff
- ✓ Human approval required before applying to original

### Troubleshooting

**Issue: Patch extraction failed**

Check agent output (`02-output.md`):
- Does it contain `## Patch` section?
- Does it contain `diff --git` or unified diff markers?
- Is the diff inside a fenced code block?

**Issue: Patch safety validation failed**

Check patch artifact (`03-proposed.patch`):
- Does it contain absolute paths?
- Does it contain suspicious commands?
- Is it a valid unified diff?

**Issue: Patch apply check failed**

Check error message:
- Does the patch conflict with workspace state?
- Are the file paths correct (relative to repository root)?
- Does the patch have correct context lines?

**Issue: Patch apply failed**

This should not happen if check passed. If it does:
- Check workspace state: `git -C <workspace> status`
- Check patch format: `cat <patch-artifact>`
- Report as bug

### Future Enhancements

- **Patch preview:** Show patch diff before applying
- **Interactive patch application:** Allow selective hunk application
- **Patch validation rules:** Custom rules for project-specific constraints
- **Patch promotion:** Automatic application to original repository after approval
- **Patch history:** Track all patches generated for a run

### References

**Related Files:**
- `packages/memory/src/run-prepare.ts` - Executor prompt generation
- `packages/agents/src/output-contracts.ts` - Output validation
- `packages/agents/src/patch-extractor.ts` - Patch extraction and safety
- `packages/runner/src/patch-applier.ts` - Patch application
- `apps/cli/src/index.ts` - CLI integration

**Related Commands:**
- `maestro agent invoke --role FULL_STACK_EXECUTOR` - Invoke executor
- `maestro run workspace diff` - View workspace changes
- `maestro run show` - View run status and artifacts
