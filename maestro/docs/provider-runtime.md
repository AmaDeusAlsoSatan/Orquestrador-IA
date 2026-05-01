# Provider Runtime

Maestro treats agents as workers inside a local company. The user should talk to the CEO and approve important gates; the system should prepare the right work for Supervisor, Executor, Reviewer, and QA.

This document describes the first provider runtime layer. It is intentionally conservative: it does not run OpenClaude, Kiro, or Codex automatically yet.

## Core Concepts

### AgentProfile

An `AgentProfile` is a worker definition:

- role, such as `CEO`, `CTO_SUPERVISOR`, `FULL_STACK_EXECUTOR`, `CODE_REVIEWER`, or `QA_VALIDATOR`;
- provider, such as `manual`, `codex_manual`, `openclaude`, or `kiro_openclaude`;
- optional model name;
- responsibilities;
- allowed actions.

Profiles live in Maestro state and can be changed without changing code.

### Provider

A provider is the runtime backend used by an agent profile.

Current providers:

- `manual`: prepares prompt files and waits for a human/manual output.
- `codex_manual`: same safe manual flow, but semantically means the output is expected from Codex.
- `openclaude`: reserved for an isolated Maestro OpenClaude runtime.
- `kiro_openclaude`: reserved for the path where Maestro calls OpenClaude, and OpenClaude uses a Kiro/provider profile.

### Model

The model is a label attached to a profile. In this phase, model names can be placeholders such as:

- `best-reasoning-free`
- `best-coding-free`
- `best-review-free`
- `local-validation`

The editable default map is created at:

```text
data/config/agent-model-map.json
```

## OpenClaude Isolation

Maestro must not reuse the OpenClaude configuration, memory, provider state, or history from another assistant.

Use two separate OpenClaude worlds:

```text
OpenClaude A - current assistant
  config/history/memory/providers owned by the assistant

OpenClaude B - Maestro orchestrator
  isolated config/history/memory/providers owned by Maestro
```

When OpenClaude is enabled later, Maestro should use only a dedicated config such as:

```text
data/config/openclaude-runtime.json
```

The current adapter stub intentionally returns `BLOCKED` if no dedicated Maestro OpenClaude config exists. This protects the assistant's OpenClaude from accidental reuse.

## Kiro via OpenClaude

`kiro_openclaude` means:

```text
Maestro -> Provider Adapter -> OpenClaude CLI/profile -> Kiro/provider/model -> output back to Maestro
```

Maestro does not talk directly to Kiro in this phase. It prepares invocations and records results. The real provider bridge comes later.

## Agent Invocations

An invocation is a durable record of one agent attempt for one run.

Generated files:

```text
data/runs/<project-id>/<run-id>/agents/<invocation-id>/
  00-invocation.json
  01-input-prompt.md
  02-output.md
```

Initial stage mapping:

```text
CTO_SUPERVISOR      -> 03-codex-supervisor-prompt.md
FULL_STACK_EXECUTOR -> handoff/07-kiro-prompt.md
CODE_REVIEWER       -> review/08-codex-reviewer-prompt.md
QA_VALIDATOR        -> 24-validation-workspace.md
CEO                 -> 01-goal.md
```

Manual adapters create the prompt and then return `BLOCKED`, because they are waiting for manual output. This is deliberate. It formalizes the old copy/paste flow without pretending automation is already available.

Status policy:

- `BLOCKED` means the invocation is waiting on a human output or missing provider configuration.
- `FAILED` means an adapter attempted work and hit an actual runtime error.
- `SUCCEEDED` means an output was attached or produced and recorded by Maestro.

Normal agent invocations are blocked for runs in `FINALIZED` or `BLOCKED` status. A future audit mode can inspect completed runs, but execution-stage invocations should not mutate a closed run.

## Commands

```bash
corepack pnpm run maestro agents init-defaults
corepack pnpm run maestro agents list
corepack pnpm run maestro agents show --agent cto-supervisor
corepack pnpm run maestro agents update --agent full-stack-executor --provider kiro_openclaude --model best-coding-free
corepack pnpm run maestro agent invoke --run <run-id> --role CTO_SUPERVISOR
corepack pnpm run maestro agent attach-output --invocation <invocation-id> --file ./codex-plan.md
```

For stage-backed roles, `agent attach-output` also updates the matching run stage:

- `SUPERVISOR_PLAN` -> `07-supervisor-output.md`
- `EXECUTOR_IMPLEMENT` -> `08-executor-output.md`
- `REVIEWER_REVIEW` -> `09-reviewer-output.md`

## Future Work

- Configure isolated Maestro OpenClaude runtime.
- Add a real `openclaude` adapter implementation.
- Add queue/heartbeat worker.
- Add audit-only invocations for finalized runs.
- Keep Human Review Gate as the final acceptance authority.
