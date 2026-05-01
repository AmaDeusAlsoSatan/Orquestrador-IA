# Supervisor Executor Workflow

Maestro will treat Codex, Kiro, OpenClaude, local LLMs, and manual work as agent adapters. MVP 2 only defines the workflow vocabulary. It does not run Codex, Kiro, OpenClaude, or any provider.

## Roles

- Maestro is the orchestrator and permanent memory layer.
- Codex is the technical supervisor and reviewer.
- Kiro is the executor.
- The Vault is the durable project memory.

## Default Flow

The default workflow is `codex-supervises-kiro`.

1. `collect-context`
   - Role: MEMORY_MANAGER.
   - Reads project context from the Vault.
   - Produces a context brief.

2. `codex-plan`
   - Role: SUPERVISOR.
   - Adapter type: CODEX_SUPERVISOR.
   - Produces the technical plan, constraints, acceptance criteria, and review focus.

3. `kiro-implement`
   - Role: EXECUTOR.
   - Adapter type: KIRO_EXECUTOR.
   - Implements only what the supervisor plan allows.

4. `kiro-report`
   - Role: EXECUTOR.
   - Produces a report with changed files, summary, tests, pending work, questions, and risks.

5. `codex-review`
   - Role: REVIEWER.
   - Adapter type: CODEX_SUPERVISOR.
   - Reviews the diff and report before the work is accepted.

6. `memory-update`
   - Role: MEMORY_MANAGER.
   - Updates the Vault with decisions, open problems, and next actions after review.

## Executor Constraints

The executor must not make large architectural decisions alone. It should follow the supervisor plan, keep changes scoped, and report uncertainty before expanding the task.

The executor should generate a report before any memory update is accepted.

## Reviewer Responsibilities

The supervisor/reviewer checks whether the executor followed the plan. Review should focus on regressions, unnecessary complexity, inconsistent patterns, missing tests, and changes outside the approved scope.

The reviewer either approves the work or rejects it with objective corrections.

## Maestro Responsibilities

Maestro records project memory in the Vault. It should preserve:

- Project overview.
- Current state.
- Backlog.
- Decisions.
- Known problems.
- Next actions.
- Agent logs.
- Imported context.

Future versions can generate `AGENTS.md`, Kiro specs, steering files, and executor prompts from this workflow. Those files should be generated explicitly and reviewed before being used.
