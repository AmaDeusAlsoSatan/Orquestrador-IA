# Maestro

Maestro is a local control plane for AI-assisted project orchestration. The goal is to keep project context, backlog, decisions, known problems, next actions, and agent notes outside of chat history, in a local Vault that can evolve into a richer CLI, server, and desktop tool.

This first MVP is deliberately small. It does not run agents, automate providers, rotate accounts, modify external projects, integrate with Kiro, or execute write actions inside repositories. Repository onboarding is read-only.

## What exists in this MVP

- A simple pnpm monorepo written in TypeScript.
- A CLI called `maestro`.
- A local project registry stored in `data/maestro.json`.
- A Markdown Vault under `data/vault/projects/<project-id>/`.
- Initial package boundaries for core, memory, agents, providers, and runner.
- Agent role definitions for CEO, CTO, FULL_STACK_DEV, QA, and MEMORY.
- Conceptual Agent Adapter types for Codex supervisor, Kiro executor, OpenClaude executor, local LLM, and manual work.
- A default `codex-supervises-kiro` workflow definition.
- Context import into `07-imported-context.md`.
- Read-only repository snapshots into `08-repo-snapshot.md`, `09-dev-scripts.md`, and `10-technical-map.md`.
- Context pack generation into `11-context-pack.md`.
- Manual run lifecycle under `data/runs/<project-id>/<timestamp-slug>/`.
- Persistent per-project task manager with Vault sync.
- Documentation for the planned architecture and roadmap.

## What is planned later

- Simulated agents and task management.
- OpenClaude headless/gRPC integration.
- A permissioned terminal/runner.
- A local UI.
- Provider routing through an OpenAI-compatible router style.
- Quota-aware provider planning without bypassing provider limits or automating account creation.

## Install

```bash
pnpm install
pnpm run build
```

## Run the CLI

From the `maestro` directory:

```bash
pnpm run maestro init
pnpm run maestro project add --name ShopeeBooster --repo-path "C:/path/to/repo" --description "Growth tooling" --stack "TypeScript,Node" --priority high
pnpm run maestro project list
pnpm run maestro project show shopeebooster
pnpm run maestro project snapshot --project shopeebooster
pnpm run maestro context pack --project shopeebooster
pnpm run maestro run prepare --project shopeebooster --goal "Describe the next task"
pnpm run maestro memory status
```

If `pnpm` is not available in your PATH, use Corepack:

```bash
corepack pnpm install
corepack pnpm run build
corepack pnpm run maestro init
```

## One Piece TCG pilot

The first real project can be registered like this, replacing the repository path with the actual local path:

```bash
corepack pnpm run maestro project add --name "One Piece TCG" --repo-path "CAMINHO_DO_REPO_DO_JOGO" --description "Jogo digital inspirado no One Piece Card Game/TCG usado como projeto piloto do Maestro." --stack "TypeScript, React, Vite"
```

For the local pilot workspace on this machine:

```bash
corepack pnpm run maestro project add --name "One Piece TCG" --repo-path "C:\Users\Defal\Documents\Projetos\One Piece! Tag Force" --description "Jogo digital inspirado no One Piece Card Game/TCG usado como projeto piloto do Maestro." --stack "TypeScript, React, Vite"
```

## Import Old Context

Export or copy old chat context into a `.md` or `.txt` file, then import it into the project Vault:

```bash
corepack pnpm run maestro context import --project one-piece-tcg --file ./contexto-codex-one-piece.md
corepack pnpm run maestro context status --project one-piece-tcg
```

## Fluxo Manual Atual

1. Cadastrar o projeto:

```bash
corepack pnpm run maestro project add --name "One Piece TCG" --repo-path "CAMINHO_DO_REPO_DO_JOGO" --description "Jogo digital inspirado no One Piece Card Game/TCG usado como projeto piloto do Maestro." --stack "TypeScript, React, Vite"
```

2. Gerar snapshot read-only do repositório:

```bash
corepack pnpm run maestro project snapshot --project one-piece-tcg
```

3. Importar contexto antigo, se houver:

```bash
corepack pnpm run maestro context import --project one-piece-tcg --file ./contexto-codex-one-piece.md
```

4. Gerar o context pack:

```bash
corepack pnpm run maestro context pack --project one-piece-tcg
```

5. Preparar uma run manual:

```bash
corepack pnpm run maestro run prepare --project one-piece-tcg --goal "Implementar o próximo bloco de efeitos da Perona sem quebrar o fluxo atual do jogo."
```

6. Copiar o prompt do Codex Supervisor da pasta da run.
7. Futuramente, usar o plano aprovado no prompt do Kiro Executor.
8. Revisar a implementação com o prompt do Codex Reviewer.
9. Atualizar a memória do Vault com decisões, pendências e próximos passos.

## Fluxo manual de uma run

Por enquanto, o usuário copia e cola manualmente as respostas do Codex e do Kiro em arquivos `.md`. O Maestro não chama Codex, não chama Kiro e não executa nada no repositório; ele apenas organiza o ciclo e atualiza o Vault.

```bash
corepack pnpm run maestro run prepare --project one-piece-tcg --goal "Implementar o próximo bloco de efeitos da Perona sem quebrar o fluxo atual do jogo."

corepack pnpm run maestro run list --project one-piece-tcg

corepack pnpm run maestro run show --run <run-id>

corepack pnpm run maestro run attach --run <run-id> --stage supervisor --file ./codex-plan.md

corepack pnpm run maestro run attach --run <run-id> --stage executor --file ./kiro-report.md

corepack pnpm run maestro run attach --run <run-id> --stage reviewer --file ./codex-review.md

corepack pnpm run maestro run finalize --run <run-id>
```

Lifecycle:

1. `run prepare` cria a pasta da run, registra a run no estado e gera os prompts iniciais.
2. `run attach --stage supervisor` salva `07-supervisor-output.md` e atualiza o prompt do Kiro com o plano aprovado.
3. `run attach --stage executor` salva `08-executor-output.md` e atualiza o prompt do reviewer com objetivo, plano e relatório.
4. `run attach --stage reviewer` salva `09-reviewer-output.md`.
5. `run finalize` cria `10-final-summary.md`, marca a run como `FINALIZED` e adiciona entradas append-only em `06-agent-log.md` e `05-next-actions.md`.
6. `run block` marca a run como `BLOCKED` e registra o motivo no log.

## Task Manager

Tasks are permanent backlog items for each project. Runs can be linked to tasks, so Maestro can track what exists, what is in progress, what needs review, and which run worked on each item.

```bash
corepack pnpm run maestro task add --project one-piece-tcg --title "Implementar efeitos restantes da Perona" --description "Mapear e implementar os próximos efeitos necessários sem quebrar o fluxo atual." --priority HIGH --tags "perona,effects"

corepack pnpm run maestro task list --project one-piece-tcg

corepack pnpm run maestro task show --task <task-id>

corepack pnpm run maestro run prepare --project one-piece-tcg --task <task-id>

corepack pnpm run maestro run finalize --run <run-id>

corepack pnpm run maestro task complete --task <task-id>

corepack pnpm run maestro task sync-vault --project one-piece-tcg

corepack pnpm run maestro project dashboard --project one-piece-tcg
```

Task statuses:

```text
TODO
READY
IN_PROGRESS
REVIEW_NEEDED
DONE
BLOCKED
CANCELLED
```

When a run is prepared from a task, the task moves to `IN_PROGRESS` and stores the run id. When the linked run is finalized, the task moves to `REVIEW_NEEDED`; a human then decides whether to complete, reopen, block, or cancel it.

## Segurança de repositório e captura de diff

Maestro only uses read-only Git inspection. It does not run `git add`, `git commit`, `git reset`, `git checkout`, `git clean`, or any command that mutates the project repository.

```bash
corepack pnpm run maestro repo status --project one-piece-tcg

corepack pnpm run maestro repo guard --project one-piece-tcg

corepack pnpm run maestro repo diff --project one-piece-tcg

corepack pnpm run maestro run prepare --project one-piece-tcg --task <task-id>

# Depois que o Kiro executar manualmente:
corepack pnpm run maestro run capture-diff --run <run-id>

# Depois anexar o relatório do Kiro:
corepack pnpm run maestro run attach --run <run-id> --stage executor --file ./kiro-report.md
```

`run prepare` captures `11-git-baseline.md`, so the run knows how the repository looked before execution. `run capture-diff` creates:

```text
12-git-after-executor.md
13-git-diff.md
14-changed-files.md
```

The Codex Reviewer prompt should use the real diff, not only the executor report. If a run is finalized without `13-git-diff.md`, Maestro warns that the review may have been based only on manual reporting.

## Kiro Handoff Package

After the Codex Supervisor generates a plan, Maestro can create a structured handoff package for the Kiro Executor. This package contains everything Kiro needs to execute the task without making large architectural decisions on its own.

```bash
corepack pnpm run maestro run prepare --project one-piece-tcg --task <task-id>

# After pasting the prompt into Codex and saving the response:
corepack pnpm run maestro run attach --run <run-id> --stage supervisor --file ./codex-plan.md

# Create the handoff package:
corepack pnpm run maestro run handoff --run <run-id>
```

The handoff package is created inside the run folder at `handoff/` and contains:

```text
handoff/
  00-read-this-first.md
  01-executor-rules.md
  02-approved-codex-plan.md
  03-project-context.md
  04-task-contract.md
  05-expected-report-format.md
  06-do-not-touch.md
  07-kiro-prompt.md
```

### Handoff Package Contents

- **00-read-this-first.md**: Explains the purpose of the handoff package and the executor's role.
- **01-executor-rules.md**: Mandatory rules for the executor (follow the plan, don't expand scope, etc.).
- **02-approved-codex-plan.md**: The complete plan from the Codex Supervisor.
- **03-project-context.md**: The project context pack.
- **04-task-contract.md**: Run metadata, task details, and acceptance criteria.
- **05-expected-report-format.md**: The required format for the executor's report.
- **06-do-not-touch.md**: List of files and folders that should not be modified.
- **07-kiro-prompt.md**: The complete prompt ready to copy and paste into Kiro.

### Workflow with Handoff Package

1. Prepare the run and attach the supervisor output:

```bash
corepack pnpm run maestro run prepare --project one-piece-tcg --task <task-id>
corepack pnpm run maestro run attach --run <run-id> --stage supervisor --file ./codex-plan.md
```

2. Create the handoff package:

```bash
corepack pnpm run maestro run handoff --run <run-id>
```

3. Copy the content of `handoff/07-kiro-prompt.md` and paste it into Kiro.

4. After Kiro executes, capture the diff:

```bash
corepack pnpm run maestro run capture-diff --run <run-id>
```

5. Attach Kiro's report:

```bash
corepack pnpm run maestro run attach --run <run-id> --stage executor --file ./kiro-report.md
```

6. The Codex Reviewer will receive the approved plan, Kiro's report, and the real Git diff.

The handoff package reduces the risk of Kiro "going off on its own" by providing a closed execution contract with clear rules, approved plan, and required report format.

## Codex Review Package

After the Kiro Executor finishes and the Git diff is captured, Maestro can create a structured review package for the Codex Reviewer. This package contains everything Codex needs to review the work against the approved plan and the real Git diff.

```bash
# After Kiro executes:
corepack pnpm run maestro run capture-diff --run <run-id>

# After saving Kiro's report:
corepack pnpm run maestro run attach --run <run-id> --stage executor --file ./kiro-report.md

# Create the review package:
corepack pnpm run maestro run review-package --run <run-id>
```

The review package is created inside the run folder at `review/` and contains:

```text
review/
  00-read-this-first.md
  01-reviewer-rules.md
  02-original-goal.md
  03-approved-codex-plan.md
  04-executor-report.md
  05-git-evidence.md
  06-real-diff.md
  07-review-checklist.md
  08-codex-reviewer-prompt.md
  09-verdict-template.md
```

### Review Package Contents

- **00-read-this-first.md**: Explains the purpose of the review package and the reviewer's role.
- **01-reviewer-rules.md**: Mandatory rules for the reviewer (review the diff, compare with plan, etc.).
- **02-original-goal.md**: The original objective of the run.
- **03-approved-codex-plan.md**: The complete plan from the Codex Supervisor.
- **04-executor-report.md**: The report from the Kiro Executor.
- **05-git-evidence.md**: Git baseline, after state, and changed files.
- **06-real-diff.md**: The actual Git diff showing code changes.
- **07-review-checklist.md**: Systematic checklist for thorough review.
- **08-codex-reviewer-prompt.md**: The complete prompt ready to copy and paste into Codex.
- **09-verdict-template.md**: The required format for the reviewer's verdict.

### Workflow with Review Package

1. After Kiro executes, capture the diff:

```bash
corepack pnpm run maestro run capture-diff --run <run-id>
```

2. Attach Kiro's report:

```bash
corepack pnpm run maestro run attach --run <run-id> --stage executor --file ./kiro-report.md
```

3. Create the review package:

```bash
corepack pnpm run maestro run review-package --run <run-id>
```

4. Copy the content of `review/08-codex-reviewer-prompt.md` and paste it into Codex.

5. After Codex reviews, attach the verdict:

```bash
corepack pnpm run maestro run attach --run <run-id> --stage reviewer --file ./codex-review.md
```

6. Finalize the run:

```bash
corepack pnpm run maestro run finalize --run <run-id>
```

The review package ensures the Codex Reviewer doesn't trust only the executor's report. It provides the real Git diff, the approved plan, and a structured checklist to ensure thorough review.

### Important Note

If the Git diff is not captured before creating the review package, Maestro will warn that the review will be less reliable. The review package will still be created, but it will contain a warning that the diff is missing.

## Run Workspace Sandbox

Maestro can create a disposable workspace sandbox for each run. The Kiro Executor should work inside this copy, not inside the original project repository.

```bash
# Depois de preparar a run e anexar o plano do Codex:
corepack pnpm run maestro run workspace create --run <run-id>

# Gerar handoff apontando para o sandbox:
corepack pnpm run maestro run handoff --run <run-id>

# Depois que o Kiro executar no sandbox:
corepack pnpm run maestro run workspace status --run <run-id>
corepack pnpm run maestro run capture-diff --run <run-id>
```

The sandbox is created under:

```text
data/workspaces/<project-id>/<run-id>/
```

The copy ignores heavy or sensitive paths such as `.git`, `node_modules`, `dist`, `build`, `.env`, logs, and files larger than 10 MB. Maestro also creates:

```text
.maestro/
  workspace-metadata.json
  ignored-files.md
  README-MAESTRO-WORKSPACE.md
```

Inside the sandbox, Maestro initializes a separate Git repository and commits a baseline. Future diffs are captured from that sandbox when it exists:

```text
Fonte do diff: WORKSPACE_SANDBOX
```

If no workspace exists, `run capture-diff` keeps the previous behavior and captures from the original repo:

```text
Fonte do diff: ORIGINAL_REPO
```

Applying sandbox changes back to the original repo is intentionally not implemented yet. That will require a future explicit approval step.

## Patch Promotion Gate

After the Kiro Executor works in the sandbox, the Codex Reviewer reviews, and you approve, Maestro can export the sandbox changes as a patch, validate if it applies cleanly to the original repo, generate an apply plan, and apply it to the original repository.

```bash
# Depois que o Kiro executou no sandbox, o diff foi capturado,
# o Codex revisou e você aprovou:
corepack pnpm run maestro run decide --run <run-id> --status APPROVED --notes "Aprovado para promoção."

# Exportar patch do sandbox:
corepack pnpm run maestro run patch export --run <run-id>

# Validar se o patch aplicaria no repo original:
corepack pnpm run maestro run patch check --run <run-id>

# Gerar plano de aplicação:
corepack pnpm run maestro run patch plan --run <run-id>

# Dry-run (valida sem aplicar):
corepack pnpm run maestro run patch apply --run <run-id> --dry-run

# Aplicação real no repo original:
corepack pnpm run maestro run patch apply --run <run-id> --confirm APPLY_TO_ORIGINAL_REPO
```

### Patch Export

`patch export` generates a Git patch from the workspace sandbox and creates:

```text
17-promotion-patch.patch
18-promotion-summary.md
```

The patch contains all changes made in the sandbox since the baseline commit.

### Patch Check

`patch check` validates if the patch would apply cleanly to the original repository using `git apply --check`. It creates:

```text
19-promotion-check.md
```

If the original repo is dirty (has uncommitted changes), the check is blocked and you must clean the repo first.

If the check passes, the patch can be promoted. If it fails, there are conflicts that need to be resolved.

### Patch Plan

`patch plan` generates an apply plan document:

```text
20-apply-plan.md
```

The plan includes:

- Run and project information
- Patch statistics (files changed, additions, deletions)
- Check status
- Pre-conditions for applying
- List of files that will be changed
- Risks
- Apply commands (dry-run and real)

### Patch Apply

`patch apply` applies the approved patch to the original repository. This command has strong safety checks:

**Required conditions:**
- Run must exist
- Project must exist
- Workspace sandbox must exist
- Patch file (17-promotion-patch.patch) must exist
- Patch check status must be CHECK_PASSED
- Human decision must be APPROVED
- Original repo must be CLEAN (no uncommitted changes)
- User must provide explicit confirmation: `--confirm APPLY_TO_ORIGINAL_REPO`

**Dry-run mode:**
```bash
corepack pnpm run maestro run patch apply --run <run-id> --dry-run
```

Dry-run executes all validations and `git apply --check` but does NOT apply the patch. It creates:

```text
21-apply-preflight.md
22-apply-result.md (with DRY_RUN_PASSED status)
23-applied-diff.md (with dry-run notice)
```

**Real apply:**
```bash
corepack pnpm run maestro run patch apply --run <run-id> --confirm APPLY_TO_ORIGINAL_REPO
```

Real apply executes `git apply` on the original repository and creates:

```text
21-apply-preflight.md
22-apply-result.md (with APPLIED status)
23-applied-diff.md (with actual diff from original repo)
```

**Important notes:**
- The patch is applied to the working tree only (no automatic commit)
- You must review the changes manually
- You must run tests to validate
- You must commit manually if everything is correct
- You can discard changes with `git reset --hard` if needed

**After applying:**
1. Review the changes: `git -C "<repo-path>" diff`
2. Run tests to validate the changes
3. Commit manually: `git -C "<repo-path>" commit -am "message"`
4. Or discard if needed: `git -C "<repo-path>" reset --hard`

### Safety Guarantees

The Patch Promotion Gate ensures that:

- Changes are validated before touching the original repo
- Conflicts are detected early
- You have a clear plan before applying
- The process is auditable and reversible
- No automatic commits are made
- Explicit confirmation is required for real apply
- All safety checks must pass before applying

## Validation Gate

After changes are made in the workspace sandbox or applied to the original repository, Maestro can run validation commands to ensure the changes don't break the build, typecheck, tests, or other quality checks.

### Detecting Validation Commands

Maestro can automatically detect validation commands from your `package.json` scripts:

```bash
corepack pnpm run maestro validation detect --project one-piece-tcg
```

This command:
- Detects the package manager (pnpm, npm, yarn, bun) by looking for lockfiles
- Reads `package.json` scripts
- Creates a validation profile with common commands: build, typecheck, test, lint, check
- Marks build and typecheck as required (must pass for validation to succeed)
- Saves the profile to `data/vault/projects/<project-id>/16-validation-profile.md`

### Listing Validation Commands

```bash
corepack pnpm run maestro validation list --project one-piece-tcg
```

Shows the configured validation commands, their timeouts, and whether they're required.

### Running Validation on Workspace

After the Kiro Executor works in the sandbox, validate the changes before review:

```bash
corepack pnpm run maestro validation run --run <run-id> --target WORKSPACE
```

This runs all configured validation commands in the workspace sandbox and creates:

```text
24-validation-workspace.md
validation/workspace/<timestamp>/
  stdout-build.log
  stderr-build.log
  stdout-typecheck.log
  stderr-typecheck.log
  ...
```

**Validation status:**
- `PASSED`: All required commands passed
- `FAILED`: One or more required commands failed
- `BLOCKED`: Commands couldn't run (timeout, missing dependencies, etc.)

### Running Validation on Original Repo

After applying the patch to the original repository, validate before committing:

```bash
corepack pnpm run maestro validation run --run <run-id> --target ORIGINAL_REPO
```

**Important:** This command only works after `patch apply` has been executed and the promotion status is `APPLIED`.

This runs validation commands in the original repository and creates:

```text
25-validation-original.md
validation/original/<timestamp>/
  stdout-build.log
  stderr-build.log
  ...
```

### Validation Workflow

**Recommended workflow:**

1. Kiro works in workspace sandbox
2. Capture diff
3. **Run validation on workspace** ← Catch issues early
4. Codex reviews (with validation results)
5. Human approves
6. Export and check patch
7. Apply patch to original repo
8. **Run validation on original repo** ← Verify before commit
9. If validation passes, commit manually
10. If validation fails, fix issues or discard changes

### Safety Notes

- Validation commands come from the detected/configured profile (no arbitrary commands)
- Each command has a timeout (default: 120s for build/typecheck, 300s for tests)
- Commands that timeout are marked as BLOCKED
- Validation runs are logged with full stdout/stderr for debugging
- Validation on original repo may create build artifacts (dist/, node_modules/, etc.)

### Integration with Review

The Codex Review Package automatically includes validation results when available:
- `24-validation-workspace.md` is included in the review package
- Reviewer can see if validation passed or failed
- Reviewer can check logs to understand failures

## Human Review Gate

The Codex Reviewer recommends, but the human operator decides. A run is not accepted as task completion until a human decision is recorded in Maestro.

```bash
# Depois de anexar a revisao do Codex:
corepack pnpm run maestro run attach --run <run-id> --stage reviewer --file ./codex-review.md

# Aprovar execucao:
corepack pnpm run maestro run decide --run <run-id> --status APPROVED --notes "A implementacao foi aceita."

# Pedir ajustes e criar follow-up task:
corepack pnpm run maestro run decide --run <run-id> --status NEEDS_CHANGES --notes "Faltou cobrir X e Y." --create-follow-up-task

# Rejeitar:
corepack pnpm run maestro run decide --run <run-id> --status REJECTED --notes "A execucao fugiu do plano aprovado."

# Bloquear:
corepack pnpm run maestro run decide --run <run-id> --status BLOCKED --notes "Depende de decisao externa."
```

When a human decision is recorded, Maestro creates `15-human-decision.md` inside the run folder and appends the decision to the project Vault.

Decision effects:

- `APPROVED`: linked task moves to `DONE`.
- `NEEDS_CHANGES`: linked task returns to `TODO`; optionally creates a follow-up task.
- `REJECTED`: linked task returns to `TODO`; optionally creates a rework task.
- `BLOCKED`: linked task moves to `BLOCKED` with the human notes as the blocker.

The Vault receives append-only updates in:

- `03-decisions.md`
- `04-known-problems.md` for non-approved decisions
- `05-next-actions.md`
- `06-agent-log.md`

Useful follow-up commands:

```bash
corepack pnpm run maestro run show --run <run-id>
corepack pnpm run maestro project dashboard --project one-piece-tcg
corepack pnpm run maestro context pack --project one-piece-tcg
```

The context pack now includes recent human decisions, and the task board shows the latest human decision linked to each task. This keeps the final acceptance gate explicit: agents can plan, execute, and review, but the human decides what is actually accepted.

## Pilot Run Mode

Pilot Run Mode is a guided checklist workflow for executing your first real run on a project. It helps you safely navigate through the complete Maestro workflow with manual steps and validation gates.

### Purpose

Pilot mode does NOT automate Codex or Kiro integration. Instead, it:
- Creates a small, safe pilot task
- Guides you through each step with recommended commands
- Shows a checklist of completed and pending steps
- Ensures you follow the safe workflow (workspace sandbox → validation → review → patch → apply)

### Starting a Pilot Run

```bash
corepack pnpm run maestro pilot start --project one-piece-tcg --title "Primeira task piloto segura" --description "Fazer uma mudança pequena e reversível para validar o fluxo real." --priority LOW --tags "pilot,safe"
```

This command:
1. Creates a pilot task with the specified title and description
2. Runs memory refresh to update project context
3. Creates a context pack
4. Detects validation commands (if not already done)
5. Creates a pilot checklist at `17-pilot-run-checklist.md`
6. Shows the next recommended command

**Important:** Choose a small, safe task for your first pilot run. Examples:
- Add a small internal README
- Add a missing npm script
- Fix a simple typo or comment
- Add basic documentation

Avoid complex features or risky changes for the first pilot.

### Checking Pilot Status

```bash
corepack pnpm run maestro pilot status --project one-piece-tcg
```

Shows a checklist of all pilot run steps:
- ✓ Completed steps
- TODO Pending steps

Example output:
```
Pilot Run Status - One Piece TCG

Task: Primeira task piloto segura (pilot-1234567890)
Status: IN_PROGRESS

  [✓] Task piloto criada
  [✓] Run preparada
  [✓] Workspace criado
  [✓] Handoff gerado
  [TODO] Kiro executar no workspace
  [TODO] Validation WORKSPACE
  [TODO] Capture diff
  [TODO] Review package
  [TODO] Human decision
  [TODO] Patch export/check/plan
  [TODO] Dry-run apply
  [TODO] Apply real
  [TODO] Validation ORIGINAL_REPO
  [TODO] Commit manual

Use 'maestro pilot next' para ver o próximo passo recomendado.
```

### Getting Next Step

```bash
corepack pnpm run maestro pilot next --project one-piece-tcg
```

Analyzes the current state and recommends the next command to run. Examples:

**If run not prepared:**
```
Próximo passo para: Primeira task piloto segura

  maestro run prepare --project one-piece-tcg --task pilot-1234567890
```

**If handoff not generated:**
```
Próximo passo para: Primeira task piloto segura

  maestro run handoff --run <run-id>
```

**If Kiro needs to execute (manual step):**
```
Próximo passo manual:
  1. Copie o prompt: <run-path>/handoff/07-kiro-prompt.md
  2. Cole no Kiro
  3. Garanta que o Kiro trabalhe somente no workspace: <workspace-path>
  4. Depois rode: maestro validation run --run <run-id> --target WORKSPACE
```

**If ready to apply patch:**
```
Próximo passo para: Primeira task piloto segura

  maestro run patch apply --run <run-id> --dry-run
```

### Complete Pilot Workflow

The pilot mode guides you through this complete workflow:

1. **Create pilot task** - `pilot start`
2. **Prepare run** - `run prepare`
3. **Create workspace** - `run workspace create`
4. **Generate handoff** - `run handoff`
5. **Execute in Kiro** (manual) - Copy prompt, paste in Kiro, ensure Kiro works only in workspace
6. **Validate workspace** - `validation run --target WORKSPACE`
7. **Capture diff** - `run capture-diff`
8. **Generate review package** - `run review-package`
9. **Review in Codex** (manual) - Copy prompt, paste in Codex, save verdict
10. **Attach reviewer output** - `run attach --stage reviewer`
11. **Human decision** - `run decide --status APPROVED`
12. **Export patch** - `run patch export`
13. **Check patch** - `run patch check`
14. **Generate apply plan** - `run patch plan`
15. **Dry-run apply** - `run patch apply --dry-run`
16. **Apply to original repo** - `run patch apply --confirm APPLY_TO_ORIGINAL_REPO`
17. **Validate original repo** - `validation run --target ORIGINAL_REPO`
18. **Manual review and commit** - Review diff, run tests, commit manually
19. **Update memory** - `memory refresh`

### Pilot Checklist File

The pilot checklist is saved at:
```
data/vault/projects/<project-id>/17-pilot-run-checklist.md
```

It contains:
- Objective and task details
- Main safety rule (Kiro works only in workspace)
- Complete checklist with managed markers
- Useful commands for status and next steps

### Safety Rules

Pilot mode enforces these safety rules:

1. **Kiro works only in workspace sandbox** - Never in the original repo
2. **Validation before review** - Catch issues early in the workspace
3. **Human decision required** - No automatic approval
4. **Patch check required** - Verify patch applies cleanly
5. **Dry-run before apply** - Test apply without modifying repo
6. **Explicit confirmation** - Must type `--confirm APPLY_TO_ORIGINAL_REPO`
7. **Validation after apply** - Verify original repo still works
8. **Manual commit** - You review and commit, not Maestro

### After Pilot Run

Once you complete your first pilot run successfully:
- You understand the complete Maestro workflow
- You have validated that all gates work correctly
- You can confidently run larger tasks
- You can create more complex pilot tasks

The pilot mode remains available for future runs - use it whenever you want guided execution with safety checks.

## First Real Pilot Run

The first real pilot run was completed successfully on 2026-05-01 with the One Piece TCG project. The complete postmortem is documented in:

**[docs/pilot-run-001-postmortem.md](docs/pilot-run-001-postmortem.md)**

Key achievements:
- ✅ Complete workflow executed (20 steps from pilot start to finalization)
- ✅ Workspace sandbox isolation worked correctly
- ✅ Codex Reviewer received real Git diff
- ✅ Human Review Gate enforced explicit approval
- ✅ Patch Promotion with multiple safety checks
- ✅ Validation on both workspace and original repo
- ✅ Manual commit maintained human control

Bugs found and fixed during the pilot run:
- Untracked files not appearing in diff (fixed in `60f09d1`)
- Review package not embedding real diff (fixed in `60f09d1`)
- `--dry-run` flag not accepting boolean (fixed in `e395bf8`)

**The Maestro is ready for real tasks.**

## Completed Runs / Run Archive

After a run is finalized and the changes are manually committed to the original repository, you can record the final commit in Maestro for audit and tracking purposes.

### Recording the Final Commit (CLI)

```bash
corepack pnpm run maestro run attach-commit --run <run-id> --commit <sha> --message <message>
```

Example:

```bash
corepack pnpm run maestro run attach-commit --run 2026-05-01T00-57-10-466Z-task-adicionar-readme-interno-description-criar- --commit ab89f4fe9dfe2ae10aa5789500b3db950be6e7c9 --message "docs: add internal development guide"
```

This command:
- Creates `26-final-commit.md` in the run folder
- Records the commit SHA, message, and timestamp
- Updates the run record in `maestro.json`
- Provides audit trail for completed deliveries

### Recording the Final Commit (UI)

The Maestro UI provides a visual interface for recording final commits:

1. Navigate to the **Runs** tab
2. Select a finalized run from the **Runs Concluídas** section
3. If no commit is recorded, a form will appear in the finalized run panel
4. Enter the commit SHA and message
5. Click **Registrar commit**

The UI will automatically refresh and display the recorded commit information.

### UI Features for Completed Runs

The Maestro UI provides comprehensive support for managing completed runs:

#### Run Separation by Status

Runs are automatically organized into three sections:
- **Runs Ativas**: Active runs (PREPARED, SUPERVISOR_PLANNED, EXECUTOR_READY, EXECUTOR_REPORTED, REVIEW_READY, REVIEWED)
- **Runs Concluídas**: Completed runs (FINALIZED) with commit information
- **Runs Bloqueadas**: Blocked runs (BLOCKED)

#### Finalized Run Panel

When viewing a finalized run, the UI displays:
- ✓ Run Finalizada header with audit notice
- Task name and status
- Human decision status
- Patch promotion status
- Validation results
- Final commit (SHA + message) or registration form
- Creation and finalization timestamps
- All audit files accessible via file viewer

#### Dashboard Integration

The project dashboard shows:
- **Runs ativas**: Count of active runs
- **Runs concluídas**: Count of completed runs with commits
- **Runs bloqueadas**: Count of blocked runs
- **Última entrega concluída**: Most recent completed run with:
  - Commit SHA (first 7 chars)
  - Commit message
  - Goal/objective
  - Finalization date

#### Memory Integration

The context pack and active memory now include:
- **Últimas Entregas Concluídas**: Last 5 completed runs with:
  - Run ID
  - Goal/objective
  - Finalization date
  - Commit SHA and message (or "não registrado")

This ensures the Codex Supervisor receives information about recent deliveries when planning future work.

### Important Notes

- The run must be in `FINALIZED` status to attach a commit
- Maestro does NOT create commits automatically - this command only records commits you made manually
- The commit should exist in the original repository before recording it
- This is for tracking and audit purposes only
- Execution actions are hidden for finalized runs in the UI
- Only audit/read actions are available for completed runs

### Viewing Completed Runs (CLI)

Use `maestro run show --run <run-id>` to see all run details including the final commit:

```bash
corepack pnpm run maestro run show --run <run-id>
```

The output will include:
- Final commit SHA
- Commit message
- When the commit was recorded
- All run artifacts and status

### Run Lifecycle with Final Commit

The complete lifecycle of a run with commit tracking:

1. Prepare run
2. Supervisor plans
3. Executor works in sandbox
4. Validation in workspace
5. Capture diff
6. Reviewer reviews
7. Human decides
8. Export and check patch
9. Dry-run apply
10. Apply to original repo
11. Validation in original repo
12. **Manual commit in original repo**
13. **Record commit in Maestro** (CLI or UI) ← New step
14. Finalize run
15. Memory refresh and checkpoint

This ensures every completed run has a clear link to the actual commit in the project repository.

## Run Timeline

The Run Timeline provides a visual audit trail of all events that occurred during a run's lifecycle. It derives events from run artifacts and presents them in chronological order.

### What is the Timeline?

The timeline automatically detects and displays key events based on the presence of artifact files in the run directory:

- **Run Created**: Initial run preparation
- **Supervisor Attached**: Codex Supervisor plan generated
- **Workspace Created**: Sandbox environment created
- **Handoff Created**: Executor handoff package generated
- **Executor Attached**: Kiro Executor completed work
- **Diff Captured**: Code changes captured
- **Review Package Created**: Review materials prepared
- **Reviewer Attached**: Codex Reviewer completed analysis
- **Human Decision**: Human Review Gate decision recorded
- **Patch Exported**: Changes exported as unified patch
- **Patch Checked**: Patch verified against original repo
- **Patch Planned**: Apply plan generated
- **Patch Dry-Run**: Dry-run apply completed
- **Patch Applied**: Patch applied to original repo
- **Validation Workspace**: Workspace validation executed
- **Validation Original**: Original repo validation executed
- **Finalized**: Run completed and memory updated
- **Final Commit Recorded**: Commit registered for audit

### Using the Timeline (CLI)

View the timeline for any run:

```bash
corepack pnpm run maestro run timeline --run <run-id>
```

Example output:
```
Timeline da Run: 2026-05-01T00-57-10-466Z-task-adicionar-readme-interno-description-criar-
Goal: Criar README-INTERNAL.md
Status: FINALIZED

✓ Run criada
  Run preparada e registrada no sistema
  Timestamp: 01/05/2026, 00:57:10
  Artefato: 00-run-metadata.json

✓ Plano do Supervisor anexado
  Codex Supervisor gerou o plano técnico
  Timestamp: 01/05/2026, 01:02:15
  Artefato: 07-supervisor-output.md

...

✓ Commit final registrado
  Commit do repositório original registrado para auditoria
  Timestamp: 01/05/2026, 02:30:45
  Artefato: 26-final-commit.md

Total de eventos: 18
```

### Using the Timeline (UI)

In the Run Console:

1. Select a run from the list
2. Click "Carregar Timeline" button
3. View all events in chronological order with:
   - Event icon (✓ for success, ✗ for error, ⚠ for warning, ℹ for info)
   - Event title and description
   - Timestamp
   - Associated artifact file

### Timeline Benefits

- **Audit Trail**: Complete history of what happened during the run
- **Debugging**: Quickly identify when and where issues occurred
- **Documentation**: Clear record for team review and compliance
- **Learning**: Understand the full workflow by seeing all steps
- **No Manual Tracking**: Timeline is automatically derived from artifacts

### Timeline for Completed Runs

For finalized runs, the timeline is especially useful as it provides a complete audit trail without needing to open multiple artifact files. It shows the entire journey from preparation to final commit.

## Agent Runtime / Provider Adapter Layer

Maestro now has the first formal layer for treating Codex, Kiro, OpenClaude, and manual work as configurable company workers instead of loose external chats.

Initialize default profiles:

```bash
corepack pnpm run maestro agents init-defaults
```

Inspect and update agents:

```bash
corepack pnpm run maestro agents list
corepack pnpm run maestro agents show --agent cto-supervisor
corepack pnpm run maestro agents update --agent full-stack-executor --provider kiro_openclaude --model best-coding-free
```

Prepare an invocation for a run:

```bash
corepack pnpm run maestro agent invoke --run <run-id> --role CTO_SUPERVISOR
```

Attach the manual/stub output back to the invocation:

```bash
corepack pnpm run maestro agent attach-output --invocation <invocation-id> --file ./codex-plan.md
```

The first runtime is intentionally safe:

- `manual` and `codex_manual` create invocation prompt files and return `BLOCKED`, waiting for manual output.
- `openclaude` and `kiro_openclaude` are safe stubs until an isolated Maestro OpenClaude runtime is configured.
- `BLOCKED` means the invocation is waiting for manual output or provider configuration; `FAILED` is reserved for real runtime errors.
- Normal agent invocations are blocked once a run is `FINALIZED` or `BLOCKED`; audit-only invocation is future work.
- Maestro does not reuse any OpenClaude config from another assistant.
- Generated invocations live under `data/runs/<project>/<run>/agents/<invocation-id>/`.
- Stage-backed invocation outputs are also attached to the run: Supervisor -> `07-supervisor-output.md`, Executor -> `08-executor-output.md`, Reviewer -> `09-reviewer-output.md`.

The UI Run Console includes an **Agentes da Run** panel for preparing Supervisor, Executor, and Reviewer invocations. When an invocation is `BLOCKED`, the panel shows a textarea to attach the manual output without leaving the UI.

Read the architecture notes in [docs/provider-runtime.md](docs/provider-runtime.md).

## Memory Consolidation / Active Context

Maestro can consolidate the growing Vault into an operational memory layer. This keeps the current state easy to recover without depending on chat history or manually rereading every log.

```bash
corepack pnpm run maestro memory refresh --project one-piece-tcg

corepack pnpm run maestro memory brief --project one-piece-tcg

corepack pnpm run maestro memory checkpoint --project one-piece-tcg --notes "Checkpoint apos fechar o ciclo de governanca manual."
```

What each command does:

- `memory refresh` regenerates the current operational memory:
  - `12-active-context.md`
  - `14-open-questions.md`
  - `15-risk-register.md`
- `memory brief` prints a short terminal summary of where the project stopped.
- `memory checkpoint` appends a historical checkpoint to `13-project-checkpoint.md`.
- `context pack` now places the Active Context near the top, before longer logs and raw Vault history.

The refreshed files use managed markers such as:

```md
<!-- MAESTRO:ACTIVE_CONTEXT:START -->
...
<!-- MAESTRO:ACTIVE_CONTEXT:END -->
```

Manual notes outside the managed markers are preserved. The first implementation is deterministic: it reads projects, tasks, runs, human decisions, and Vault files, but does not call Codex, Kiro, or any LLM.

You can also link the CLI locally after building:

```bash
pnpm --filter @maestro/cli link --global
maestro init
maestro project list
```

## Runtime data

`maestro init` creates the local runtime data:

```text
data/
  logs/
  maestro.json
  runs/
  vault/
    global/
    projects/
```

When a project is added, Maestro creates:

```text
data/vault/projects/<project-id>/
  00-overview.md
  01-current-state.md
  02-backlog.md
  03-decisions.md
  04-known-problems.md
  05-next-actions.md
  06-agent-log.md
  07-imported-context.md
  08-repo-snapshot.md
  09-dev-scripts.md
  10-technical-map.md
  11-context-pack.md
```

Prepared manual runs live under:

```text
data/runs/<project-id>/<timestamp-slug>/
  00-run-metadata.json
  01-goal.md
  02-context-pack.md
  03-codex-supervisor-prompt.md
  04-kiro-executor-prompt.md
  05-codex-reviewer-prompt.md
  06-run-log.md
  07-supervisor-output.md
  08-executor-output.md
  09-reviewer-output.md
  10-final-summary.md
  11-git-baseline.md
  12-git-after-executor.md
  13-git-diff.md
  14-changed-files.md
  handoff/
    00-read-this-first.md
    01-executor-rules.md
    02-approved-codex-plan.md
    03-project-context.md
    04-task-contract.md
    05-expected-report-format.md
    06-do-not-touch.md
    07-kiro-prompt.md
  review/
    00-read-this-first.md
    01-reviewer-rules.md
    02-original-goal.md
    03-approved-codex-plan.md
    04-executor-report.md
    05-git-evidence.md
    06-real-diff.md
    07-review-checklist.md
    08-codex-reviewer-prompt.md
    09-verdict-template.md
```

## Diagnostics and Smoke Tests

Maestro includes diagnostic and smoke test commands to verify system health and validate the complete workflow.

### Doctor Command

The `doctor` command checks Maestro's health and configuration:

```bash
# Check global Maestro health:
corepack pnpm run maestro doctor

# Check specific project health:
corepack pnpm run maestro doctor --project one-piece-tcg
```

The doctor command verifies:

- MAESTRO_HOME configuration
- State file existence and validity
- Required folders (vault, runs, logs, workspaces)
- Git availability
- Project-specific checks (repo status, vault files, tasks, runs, workspaces, promotions)

### Smoke Test

The `smoke-test` command runs a complete end-to-end workflow in an isolated temporary environment:

```bash
# Run smoke test (cleans up after):
corepack pnpm run maestro smoke-test

# Run smoke test with verbose output and keep artifacts:
corepack pnpm run maestro smoke-test --keep --verbose

# Run smoke test with patch apply (validates apply command):
corepack pnpm run maestro smoke-test --with-apply --keep --verbose
```

The smoke test validates the complete Maestro workflow:

1. Creates a temporary MAESTRO_HOME and fake Git repository
2. Initializes Maestro
3. Registers a test project
4. Creates a snapshot
5. Creates a task
6. Refreshes memory
7. Creates context pack
8. Prepares a run
9. Attaches supervisor output (simulated)
10. Creates a workspace sandbox
11. Generates handoff package
12. Modifies files in the workspace
13. Checks workspace status
14. Captures Git diff
15. Attaches executor output (simulated)
16. Generates review package
17. Attaches reviewer output (simulated)
18. Records human decision (APPROVED)
19. Exports patch
20. Checks patch applies cleanly
21. Generates apply plan
22. **[With --with-apply]** Runs patch apply dry-run
23. **[With --with-apply]** Applies patch to fake repo
24. **[With --with-apply]** Verifies fake repo has changes
25. Finalizes run
26. Refreshes memory
27. Verifies all artifacts were created
28. Confirms original repo state (unchanged without --with-apply, changed with --with-apply)
29. Runs doctor on the test environment

**Smoke test with --with-apply:**

The `--with-apply` flag extends the smoke test to validate the patch apply command:

- Runs `patch apply --dry-run` to validate all safety checks
- Applies the patch to the fake repository (not to any real project)
- Verifies the fake repo has the expected changes after apply
- Creates additional artifacts: `21-apply-preflight.md`, `22-apply-result.md`, `23-applied-diff.md`
- Confirms no real repositories were touched

This validates the complete cycle: workspace → patch → check → plan → apply.

The smoke test generates a report in `data/logs/smoke-tests/` with:

- Test result (PASS/FAIL)
- All steps executed
- Artifacts verified
- Any errors or warnings
- Path to temporary environment (if `--keep` was used)

**Important:** Both smoke tests (with and without --with-apply) must pass before deploying Maestro. They validate that the complete workflow is reliable and safe.

### When to Run Diagnostics

- After installing or updating Maestro
- Before starting work on a new project
- When troubleshooting issues
- Before implementing new features that modify repositories
- As part of CI/CD validation

## Environment

By default, Maestro uses the directory where the CLI is executed as its home. Set `MAESTRO_HOME` if you want the CLI to manage a specific Maestro directory from another location.
## Maestro UI

O Maestro agora tem uma primeira interface local para operar o fluxo sem depender de uma sequencia longa de comandos no terminal.

Comandos principais:

```bash
corepack pnpm install
corepack pnpm run build
corepack pnpm run dev:ui
```

URLs locais:

- Web UI: `http://127.0.0.1:5173`
- API local: `http://127.0.0.1:4317/api/health`

A UI roda em modo local trusted, sem login por enquanto. Ela ainda nao integra Codex ou Kiro automaticamente: o fluxo continua manual, mas agora a tela organiza projetos, tasks, runs, prompts, anexos, handoffs, review packages, decisoes humanas, validacoes e patch promotion.

O CLI continua sendo o motor do Maestro. A UI chama a API local, e a API reaproveita os mesmos modulos do monorepo para manter o comportamento consistente.

O que ja existe no MVP da UI:

- Project switcher.
- Dashboard do projeto ativo.
- CEO Command Center simulado, onde cada pedido vira task rastreavel.
- Task manager basico.
- Run Console com checklist visual.
- Viewer de prompts e arquivos importantes da run.
- Attach de outputs do Codex Supervisor, Kiro Executor e Codex Reviewer.
- Human Review Gate.
- Acoes controladas para workspace, handoff, capture diff, review package, patch export/check/plan, validacoes e finalize.
- Memory view com Active Context, checkpoints, open questions, risk register e context pack.

O que continua propositalmente fora:

- Integracao automatica com Codex.
- Integracao automatica com Kiro.
- Provider router.
- Login/autenticacao.
- Deploy.
- Commit automatico.
- Patch apply pela UI.

### UI workflow for a run

1. Selecione o projeto no Project Switcher.
2. Abra a aba `Runs` e selecione a run ativa.
3. Leia o bloco `Proximo passo`.
4. Copie `03-codex-supervisor-prompt.md` pela UI.
5. Cole o prompt no Codex e peça apenas o plano técnico, sem modificar arquivos.
6. Cole a resposta em `Anexar saida do Codex Supervisor`.
7. Use `Preparar execucao do Kiro` para criar o workspace sandbox e gerar o handoff.
8. Abra e copie `handoff/07-kiro-prompt.md`.
9. Entregue o prompt ao Kiro manualmente.
10. Depois da execução manual, volte para a UI para anexar relatório, capturar diff, gerar review package e registrar a decisão humana.

O Kiro deve trabalhar somente no workspace mostrado pela UI. O repo original não recebe patch pela UI neste MVP.
