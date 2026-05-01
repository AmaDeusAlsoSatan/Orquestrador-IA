# Maestro Architecture

Maestro is planned as a local orchestration layer for project-aware AI agents. The current MVP creates the registry, Vault, CLI, package boundaries, read-only repository snapshots, context packs, and manual run preparation.

## Interfaces

The first interface is the CLI in `apps/cli`. Future interfaces may include:

- A local server in `apps/server`.
- A desktop UI.
- A small local API for other tools to read project memory.

All interfaces should talk to shared packages instead of duplicating behavior.

## Core

`packages/core` owns shared domain types, state shape, ID helpers, path helpers, and registry persistence. It should stay provider-neutral and agent-neutral.

Current responsibilities:

- Project registry.
- JSON state file access.
- Shared TypeScript types.

## Memory and Vault

`packages/memory` owns the local Markdown Vault. Each project gets isolated memory documents under:

```text
data/vault/projects/<project-id>/
```

The Vault is intentionally plain Markdown so project context can be read, edited, backed up, and versioned without depending on a chat thread.

Repository onboarding is read-only. Maestro can inspect package metadata, important files, project structure, and read-only git information, then store that snapshot in the Vault:

- `08-repo-snapshot.md`
- `09-dev-scripts.md`
- `10-technical-map.md`
- `11-context-pack.md`

## Agents

`packages/agents` currently defines only static agent roles:

- CEO
- CTO
- FULL_STACK_DEV
- QA
- MEMORY

No LLM calls happen in MVP 1. Future versions can add simulated agents, task planning, role prompts, and handoff rules.

The next conceptual layer is Agent Adapters. An adapter represents the way Maestro talks to or coordinates a worker. Planned adapter types include:

- CODEX_SUPERVISOR
- KIRO_EXECUTOR
- OPENCLAUDE_EXECUTOR
- LOCAL_LLM
- MANUAL

The first default workflow is `codex-supervises-kiro`: Maestro gathers Vault context, Codex plans, Kiro implements, Kiro reports, Codex reviews, and Maestro updates memory only after review.

## Providers

`packages/providers` is a placeholder boundary for future model providers and local proxies. MVP 1 includes no real provider automation.

Future integration may include an OpenAI-compatible local router style similar to Grouter. This should be used for legitimate provider selection and quota visibility, not for bypassing limits or automating account creation.

## Runner

`packages/runner` is a placeholder for future command execution. The current MVP does not execute write operations inside user repositories. The repository snapshot command is limited to read-only filesystem inspection and read-only git commands.

Future runner work should include:

- Explicit permissions.
- Dry-run support.
- Per-project execution policies.
- Logs under `data/logs`.
- Clear separation between reading project state and mutating project files.

## Future OpenClaude Integration

OpenClaude may later run as a headless service with gRPC and file/bash tools. Maestro should treat it as one possible execution backend, behind a provider or runner abstraction.

MVP 1 does not start, configure, or modify any existing OpenClaude installation.

## Future Router Integration

A future provider router can expose an OpenAI-compatible local endpoint and multiple provider profiles. Maestro should only store configuration and routing preferences after the provider package has explicit user-controlled settings.

MVP 1 does not create accounts, rotate accounts, bypass limits, or automate providers.

## Project Isolation

Every project has:

- Registry metadata in `data/maestro.json`.
- Vault memory in `data/vault/projects/<project-id>/`.
- Optional manual run artifacts in `data/runs/<project-id>/`.

Future automation must keep this isolation and require explicit permission before touching any external repository.
