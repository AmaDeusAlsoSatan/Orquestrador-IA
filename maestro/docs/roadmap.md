# Maestro Roadmap

## MVP 1: Project Registry + Vault + CLI

- Create the pnpm monorepo.
- Add the `maestro` CLI.
- Store projects in `data/maestro.json`.
- Create Markdown Vault folders per project.
- Define initial agent roles and core types.
- Add read-only project onboarding and repository snapshots.
- Generate context packs for future supervisor planning.
- Prepare manual run folders with Codex/Kiro prompts.

## MVP 2: Simulated Agents + Task Manager

- Add task records and task status transitions.
- Add simulated agent handoffs without LLM calls.
- Produce agent notes in the project Vault.
- Add basic decision and problem tracking commands.
- Expand Agent Adapter profiles for supervisor, executor, reviewer, and memory roles.
- Generate Kiro instructions, specs, and steering files from approved Maestro workflows.

## MVP 3: OpenClaude Headless Integration

- Add an OpenClaude client boundary.
- Support a configured headless/gRPC endpoint.
- Keep all tool execution behind explicit permissions.
- Log requests and outcomes per project.

## MVP 4: Terminal/Runner With Permissions

- Add a local runner with allowlists and confirmations.
- Support dry runs.
- Record command logs under `data/logs`.
- Keep repository mutation disabled by default.

## MVP 5: Local UI

- Add a local server API.
- Add a desktop or web UI for registry, Vault, backlog, and decisions.
- Keep CLI and UI backed by the same core packages.

## MVP 6: Quota-Aware Provider Router

- Add provider profiles.
- Integrate with a local OpenAI-compatible router style.
- Surface quota and cost information where available.
- Do not bypass provider limits.
- Do not automate account creation.
