type ViewName = "dashboard" | "ceo" | "tasks" | "runs" | "memory" | "settings";

interface ProjectSummary {
  id: string;
  name: string;
  repoPath: string;
  description: string;
  status: string;
  priority: string;
  stack: string[];
  totalTasks?: number;
  openRuns?: number;
  reviewNeededTasks?: number;
  activeContextExists?: boolean;
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  tags: string[];
  relatedRunIds: string[];
}

interface Run {
  id: string;
  projectId: string;
  taskId?: string;
  goal: string;
  status: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  finalCommit?: {
    sha: string;
    message: string;
    recordedAt: string;
  };
}

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

interface RunFile {
  fileName: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
}

interface NextAction {
  label: string;
  description: string;
  actionType: "COPY_PROMPT" | "ATTACH_OUTPUT" | "RUN_ACTION" | "MANUAL";
  primary?: boolean;
  fileToOpen?: string;
  runAction?: string;
  stage?: "supervisor" | "executor" | "reviewer";
}

interface RunDetail {
  run: Run;
  project: ProjectSummary;
  task?: Task;
  files: RunFile[];
  checklist: ChecklistItem[];
  nextStep: string;
  nextActions: NextAction[];
  workspace?: { workspacePath: string; status: string };
  promotion?: { status: string; patchPath: string };
  decision?: { status: string; notes: string };
  agentProfiles?: AgentProfile[];
  agentInvocations?: AgentInvocation[];
}

interface AgentProfile {
  id: string;
  name: string;
  role: string;
  provider: string;
  model?: string;
  description: string;
}

interface AgentInvocation {
  id: string;
  runId: string;
  projectId: string;
  agentProfileId: string;
  role: string;
  provider: string;
  stage: string;
  inputPath: string;
  outputPath?: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

interface ActionLogEntry {
  action: string;
  status: "OK" | "ERROR";
  message: string;
  details?: string;
  at: string;
}

interface Dashboard {
  project: ProjectSummary;
  totalTasks: number;
  openTasks: number;
  openRuns: Run[];
  reviewNeededTasks: Task[];
  highPriorityTasks: Task[];
  runsAwaitingDecision: Run[];
  latestRun?: Run;
  latestPromotion?: { status: string };
  latestValidation?: { status: string; target: string };
  memoryStatus?: {
    activeContextExists: boolean;
    checkpointExists: boolean;
    openQuestionsCount: number;
    activeRiskCount: number;
  };
  brief?: {
    currentGoal: string;
    blockers: string[];
    highPriorityTasks: string[];
    runsAwaitingDecision: string[];
    nextStep: string;
  };
  nextStep: string;
}

interface AppState {
  projects: ProjectSummary[];
  activeProjectId?: string;
  view: ViewName;
  dashboard?: Dashboard;
  tasks: Task[];
  runs: Run[];
  selectedRunId?: string;
  runDetail?: RunDetail;
  timeline?: any[];
  fileViewer?: { fileName: string; content: string };
  memoryFile?: { fileName: string; content: string };
  actionLogs: ActionLogEntry[];
  busy: boolean;
  toast?: string;
}

const API_BASE = localStorage.getItem("maestro-api-base") || "http://127.0.0.1:4317";
const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found.");
}
const appRoot = app;

const state: AppState = {
  projects: [],
  activeProjectId: localStorage.getItem("maestro-active-project") || undefined,
  view: "dashboard",
  tasks: [],
  runs: [],
  actionLogs: [],
  busy: false
};

void boot();

async function boot(): Promise<void> {
  appRoot.addEventListener("click", (event) => void handleClick(event));
  await refreshProjects();
  render();
}

async function refreshProjects(): Promise<void> {
  const response = await api<{ projects: ProjectSummary[] }>("/api/projects");
  state.projects = response.projects;

  if (!state.activeProjectId && state.projects.length > 0) {
    state.activeProjectId = state.projects[0].id;
  }

  if (state.activeProjectId) {
    localStorage.setItem("maestro-active-project", state.activeProjectId);
    await refreshProjectData();
  }
}

async function refreshProjectData(): Promise<void> {
  if (!state.activeProjectId) return;
  const [dashboard, tasks, runs] = await Promise.all([
    api<Dashboard>(`/api/projects/${state.activeProjectId}/dashboard`),
    api<{ tasks: Task[] }>(`/api/projects/${state.activeProjectId}/tasks`),
    api<{ runs: Run[] }>(`/api/projects/${state.activeProjectId}/runs`)
  ]);
  state.dashboard = dashboard;
  state.tasks = tasks.tasks;
  state.runs = runs.runs;

  if (!state.selectedRunId && state.runs.length > 0) {
    state.selectedRunId = state.runs[0].id;
  }

  if (state.selectedRunId) {
    await loadRun(state.selectedRunId);
  }
}

async function loadRun(runId: string): Promise<void> {
  state.selectedRunId = runId;
  state.timeline = undefined; // Clear timeline when switching runs
  state.runDetail = await api<RunDetail>(`/api/runs/${runId}`);
}

function render(): void {
  const activeProject = state.projects.find((project) => project.id === state.activeProjectId);
  appRoot.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand"><span class="brand-mark">M</span><span>Maestro Command Center</span></div>
        <div class="topbar-right">
          <span class="active-project">${activeProject ? escapeHtml(activeProject.name) : "Nenhum projeto selecionado"}</span>
          <button data-command="doctor">Doctor</button>
        </div>
      </header>
      <div class="layout">
        <aside class="sidebar">
          ${renderNavigation()}
          ${renderProjectSwitcher()}
        </aside>
        <main class="main">
          ${renderMain()}
        </main>
      </div>
    </div>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
  bindForms();
}

function renderNavigation(): string {
  const entries: Array<[ViewName, string]> = [
    ["dashboard", "Dashboard"],
    ["ceo", "CEO Chat"],
    ["tasks", "Tasks"],
    ["runs", "Runs"],
    ["memory", "Memory"],
    ["settings", "Settings"]
  ];

  return `
    <h2>Workspace</h2>
    <nav class="nav">
      ${entries.map(([view, label]) => `<button class="${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`).join("")}
    </nav>
  `;
}

function renderProjectSwitcher(): string {
  return `
    <h2>Projetos</h2>
    <div class="project-list">
      ${state.projects.map((project) => `
        <button class="project-button ${project.id === state.activeProjectId ? "active" : ""}" data-project-id="${project.id}">
          <strong>${escapeHtml(project.name)}</strong>
          <span class="muted">${escapeHtml(project.id)}</span>
          <span class="badge-row">
            <span class="badge">${project.totalTasks || 0} tasks</span>
            <span class="badge">${project.openRuns || 0} runs</span>
          </span>
        </button>
      `).join("") || `<div class="empty">Nenhum projeto cadastrado.</div>`}
      <button data-view="settings">+ Adicionar Projeto</button>
    </div>
  `;
}

function renderMain(): string {
  if (!state.activeProjectId && state.view !== "settings") {
    return renderSettings();
  }

  switch (state.view) {
    case "dashboard":
      return renderDashboard();
    case "ceo":
      return renderCeoCommandCenter();
    case "tasks":
      return renderTasks();
    case "runs":
      return renderRuns();
    case "memory":
      return renderMemory();
    case "settings":
      return renderSettings();
  }
}

function renderDashboard(): string {
  const dashboard = state.dashboard;
  if (!dashboard) return `<div class="empty">Selecione um projeto.</div>`;

  const runCounts = (dashboard as any).runCounts || { active: 0, completed: 0, blocked: 0 };
  const latestCompletedRun = (dashboard as any).latestCompletedRun;

  return `
    <section class="section-title">
      <div>
        <h1>${escapeHtml(dashboard.project.name)}</h1>
        <p>${escapeHtml(dashboard.project.description || "Projeto local Maestro")}</p>
      </div>
      <button class="primary" data-view="ceo">Falar com CEO</button>
    </section>
    <div class="grid">
      ${metricCard("Status do projeto", dashboard.project.status, dashboard.project.repoPath)}
      ${metricCard("Proximo passo", dashboard.nextStep, "Use o CEO Chat para criar ou preparar trabalho.")}
      ${metricCard("Tasks abertas", String(dashboard.openTasks), `${dashboard.totalTasks} tasks no total`)}
      ${metricCard("Runs ativas", String(runCounts.active), `${runCounts.completed} concluídas, ${runCounts.blocked} bloqueadas`)}
      ${metricCard("Runs aguardando decisao", String(dashboard.runsAwaitingDecision.length), "Human Review Gate")}
      ${metricCard("Active Context", dashboard.memoryStatus?.activeContextExists ? "gerado" : "pendente", `${dashboard.memoryStatus?.activeRiskCount || 0} riscos ativos`)}
    </div>
    <div class="split" style="margin-top: 1rem;">
      <div class="card">
        <h3>Prioridades</h3>
        ${renderTaskMiniList(dashboard.highPriorityTasks)}
      </div>
      <div class="card">
        <h3>Última entrega concluída</h3>
        ${latestCompletedRun ? `
          <p><strong>Commit:</strong> <code>${escapeHtml(latestCompletedRun.finalCommit?.sha.slice(0, 7) || "não registrado")}</code></p>
          <p><strong>Mensagem:</strong> ${escapeHtml(latestCompletedRun.finalCommit?.message || "N/A")}</p>
          <p><strong>Goal:</strong> ${escapeHtml(latestCompletedRun.goal.slice(0, 80))}${latestCompletedRun.goal.length > 80 ? "..." : ""}</p>
          <p class="muted">Finalizada em: ${latestCompletedRun.finalizedAt ? new Date(latestCompletedRun.finalizedAt).toLocaleString("pt-BR") : "N/A"}</p>
        ` : `<p class="muted">Nenhuma run concluída ainda.</p>`}
      </div>
    </div>
    <div class="split" style="margin-top: 1rem;">
      <div class="card">
        <h3>Brief da memoria</h3>
        <p><strong>Objetivo atual:</strong> ${escapeHtml(dashboard.brief?.currentGoal || "Nao detectado")}</p>
        <p><strong>Proximo passo:</strong> ${escapeHtml(dashboard.brief?.nextStep || dashboard.nextStep)}</p>
        <div class="button-row">
          <button data-memory-action="REFRESH">Atualizar memoria ativa</button>
          <button data-memory-action="PACK">Gerar context pack</button>
          <button data-view="runs">Abrir runs</button>
        </div>
      </div>
      <div class="card">
        <h3>Patch promotion</h3>
        <p><strong>Status:</strong> ${escapeHtml(dashboard.latestPromotion?.status || "sem patch")}</p>
        <p class="muted">Última promoção registrada</p>
      </div>
    </div>
  `;
}

function renderCeoCommandCenter(): string {
  return `
    <section class="section-title">
      <div>
        <h1>CEO Command Center</h1>
        <p>Este MVP ainda nao chama LLM automaticamente. O pedido humano vira task/run, e o painel de agentes prepara as invocacoes formais.</p>
      </div>
    </section>
    <div class="split">
      <form class="card" id="ceo-form">
        <h3>Diga ao CEO o que fazer</h3>
        <div class="field">
          <label for="ceo-message">Pedido</label>
          <textarea id="ceo-message" name="message" placeholder="Diga ao CEO o que voce quer fazer neste projeto..."></textarea>
        </div>
        <div class="button-row" style="margin-top: 0.75rem;">
          <button class="primary" type="submit">Enviar para CEO</button>
          <button type="button" data-command="create-pilot-task">Criar pilot task segura</button>
        </div>
      </form>
      <div class="card">
        <h3>Fluxo gerado</h3>
        <p>O CEO simulado cria uma task com tag <code>ceo-request</code>. Depois voce prepara a run e usa o painel <strong>Agentes da Run</strong> para preparar Supervisor, Executor e Reviewer.</p>
        <p class="muted">Isso mantem a conversa presa a task/run e prepara o caminho para OpenClaude/Kiro isolados.</p>
      </div>
    </div>
  `;
}

function renderTasks(): string {
  return `
    <section class="section-title">
      <div>
        <h1>Tasks</h1>
        <p>Backlog persistente do projeto ativo.</p>
      </div>
    </section>
    <div class="split">
      <form class="card" id="task-form">
        <h3>Nova task</h3>
        <div class="field"><label>Titulo</label><input name="title" /></div>
        <div class="field"><label>Descricao</label><textarea name="description"></textarea></div>
        <div class="form-grid">
          <div class="field"><label>Prioridade</label><select name="priority"><option>MEDIUM</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></div>
          <div class="field"><label>Tags</label><input name="tags" placeholder="perona,effects" /></div>
        </div>
        <div class="button-row" style="margin-top: 0.75rem;"><button class="primary" type="submit">Criar task</button></div>
      </form>
      <div class="list">
        ${state.tasks.map(renderTaskItem).join("") || `<div class="empty">Sem tasks ainda.</div>`}
      </div>
    </div>
  `;
}

function renderRuns(): string {
  const activeRuns = state.runs.filter((run) => 
    ["PREPARED", "SUPERVISOR_PLANNED", "EXECUTOR_READY", "EXECUTOR_REPORTED", "REVIEW_READY", "REVIEWED"].includes(run.status)
  );
  const completedRuns = state.runs.filter((run) => run.status === "FINALIZED");
  const blockedRuns = state.runs.filter((run) => run.status === "BLOCKED");

  return `
    <section class="section-title">
      <div>
        <h1>Run Console</h1>
        <p>Prompts, anexos, validacoes, handoff, review e promocao de patch.</p>
      </div>
    </section>
    <div class="split">
      <div class="list">
        ${activeRuns.length > 0 ? `
          <h3 style="margin: 0.5rem 0;">Runs Ativas</h3>
          ${activeRuns.map(renderRunItem).join("")}
        ` : ""}
        ${completedRuns.length > 0 ? `
          <h3 style="margin: 1rem 0 0.5rem 0;">Runs Concluídas</h3>
          ${completedRuns.map(renderCompletedRunItem).join("")}
        ` : ""}
        ${blockedRuns.length > 0 ? `
          <h3 style="margin: 1rem 0 0.5rem 0;">Runs Bloqueadas</h3>
          ${blockedRuns.map(renderRunItem).join("")}
        ` : ""}
        ${state.runs.length === 0 ? `<div class="empty">Nenhuma run preparada.</div>` : ""}
      </div>
      ${renderSelectedRun()}
    </div>
  `;
}

function renderMemory(): string {
  const files = [
    "12-active-context.md",
    "13-project-checkpoint.md",
    "14-open-questions.md",
    "15-risk-register.md",
    "11-context-pack.md"
  ];

  return `
    <section class="section-title">
      <div>
        <h1>Memory</h1>
        <p>Memoria operacional consolidada do projeto.</p>
      </div>
      <div class="button-row">
        <button data-memory-action="REFRESH">Atualizar memoria ativa</button>
        <button data-memory-action="PACK">Gerar context pack</button>
      </div>
    </section>
    <div class="split">
      <div class="card">
        <h3>Arquivos de memoria</h3>
        <div class="list">
          ${files.map((file) => `<button data-memory-file="${file}">${file}</button>`).join("")}
        </div>
      </div>
      <div class="card">
        <h3>${escapeHtml(state.memoryFile?.fileName || "Selecione um arquivo")}</h3>
        ${state.memoryFile ? `<pre>${escapeHtml(state.memoryFile.content)}</pre>` : `<div class="empty">Abra um arquivo de memoria para leitura.</div>`}
      </div>
    </div>
  `;
}

function renderSettings(): string {
  return `
    <section class="section-title">
      <div>
        <h1>Settings</h1>
        <p>Configuração local trusted mode.</p>
      </div>
    </section>
    <div class="split">
      <form class="card" id="project-form">
        <h3>Adicionar Projeto</h3>
        <div class="field"><label>Nome</label><input name="name" required /></div>
        <div class="field"><label>Repo path</label><input name="repoPath" /></div>
        <div class="field"><label>Descricao</label><textarea name="description"></textarea></div>
        <div class="field"><label>Stack</label><input name="stack" placeholder="TypeScript, React, Vite" /></div>
        <div class="button-row" style="margin-top: 0.75rem;"><button class="primary" type="submit">Adicionar</button></div>
      </form>
      <div class="card">
        <h3>API</h3>
        <p>Base atual: <code>${escapeHtml(API_BASE)}</code></p>
        <p class="muted">A UI e a API rodam localmente. Codex e Kiro continuam manuais nesta fase.</p>
      </div>
    </div>
  `;
}

function renderSelectedRun(): string {
  const detail = state.runDetail;
  if (!detail) return `<div class="empty">Selecione uma run.</div>`;

  const isFinalized = detail.run.status === "FINALIZED";

  return `
    <div class="card">
      <h3>${escapeHtml(detail.run.id)}</h3>
      ${isFinalized ? renderFinalizedRunPanel(detail) : renderNextActionPanel(detail)}
      <div class="badge-row">
        <span class="badge ${isFinalized ? "ok" : ""}">${escapeHtml(detail.run.status)}</span>
        ${detail.workspace ? `<span class="badge ok">workspace ${escapeHtml(detail.workspace.status)}</span>` : `<span class="badge warn">sem workspace</span>`}
        ${detail.promotion ? `<span class="badge">${escapeHtml(detail.promotion.status)}</span>` : `<span class="badge">sem patch</span>`}
      </div>
      ${renderWorkspacePanel(detail)}
      <h3>Checklist</h3>
      <div class="checklist">${detail.checklist.map((item) => `<div class="check"><span class="dot ${item.done ? "done" : ""}">${item.done ? "✓" : ""}</span>${escapeHtml(item.label)}</div>`).join("")}</div>
      ${renderAgentPanel(detail)}
      ${renderTimelineSection(detail)}
      ${isFinalized ? "" : `
        <h3>Acoes</h3>
        <div class="button-row">
          <button class="primary" data-command="prepare-kiro" ${hasSupervisorOutput(detail) ? "" : "disabled"}>Preparar execucao do Kiro</button>
          ${actionButton("CREATE_WORKSPACE", "Criar workspace")}
          ${actionButton("GENERATE_HANDOFF", "Gerar Kiro Handoff")}
          ${actionButton("CAPTURE_DIFF", "Capturar diff")}
          ${actionButton("GENERATE_REVIEW_PACKAGE", "Gerar Review Package")}
          ${actionButton("PATCH_EXPORT", "Exportar patch")}
          ${actionButton("PATCH_CHECK", "Checar patch")}
          ${actionButton("PATCH_PLAN", "Gerar apply plan")}
          ${actionButton("VALIDATION_WORKSPACE", "Validar workspace")}
          ${actionButton("VALIDATION_ORIGINAL", "Validar original")}
          ${actionButton("FINALIZE", "Finalizar run")}
          <button disabled title="Futuro passo com confirmacao explicita">Patch apply bloqueado</button>
        </div>
      `}
      <h3>Prompts e arquivos</h3>
      <div class="button-row">
        ${fileButton("03-codex-supervisor-prompt.md")}
        ${fileButton("02-context-pack.md")}
        ${fileButton("11-git-baseline.md")}
        ${fileButton("handoff/00-read-this-first.md")}
        ${fileButton("handoff/01-executor-rules.md")}
        ${fileButton("handoff/04-task-contract.md")}
        ${fileButton("handoff/07-kiro-prompt.md")}
        ${fileButton("review/08-codex-reviewer-prompt.md")}
        ${fileButton("13-git-diff.md")}
        ${fileButton("20-apply-plan.md")}
        ${fileButton("10-final-summary.md")}
        ${fileButton("15-human-decision.md")}
        ${fileButton("23-applied-diff.md")}
        ${fileButton("25-validation-original.md")}
        ${detail.run.finalCommit ? fileButton("26-final-commit.md") : ""}
      </div>
      ${state.fileViewer ? `
        <div style="margin-top: 0.75rem;">
          <div class="button-row"><button data-command="copy-open-file">Copiar prompt/arquivo</button></div>
          <pre>${escapeHtml(state.fileViewer.content)}</pre>
        </div>
      ` : ""}
      ${isFinalized ? "" : renderAttachAndDecision(detail)}
      ${renderActionLogs()}
    </div>
  `;
}

function renderAttachCommitForm(detail: RunDetail): string {
  return `
    <form class="card" id="attach-commit-form" style="margin-top: 1rem; box-shadow: none; background: var(--bg);">
      <h4>Registrar commit final</h4>
      <div class="field">
        <label>Commit SHA</label>
        <input name="commitSha" placeholder="ab89f4fe9dfe2ae10aa5789500b3db950be6e7c9" required />
      </div>
      <div class="field">
        <label>Mensagem do commit</label>
        <input name="commitMessage" placeholder="docs: add internal development guide" required />
      </div>
      <button class="primary" type="submit">Registrar commit</button>
    </form>
  `;
}

function renderFinalizedRunPanel(detail: RunDetail): string {
  const run = detail.run;
  const createdDate = new Date(run.createdAt).toLocaleString("pt-BR");
  const finalizedDate = run.finalizedAt ? new Date(run.finalizedAt).toLocaleString("pt-BR") : "N/A";
  
  return `
    <div class="card" style="background: var(--panel-soft); box-shadow: none; margin-bottom: 1rem;">
      <h3>✓ Run Finalizada</h3>
      <p class="muted">Esta run foi concluída. Use esta tela como histórico/auditoria.</p>
      <div style="margin-top: 1rem;">
        <p><strong>Task:</strong> ${escapeHtml(detail.task?.title || run.taskId || "N/A")}</p>
        <p><strong>Decisão humana:</strong> ${escapeHtml(detail.decision?.status || "N/A")}</p>
        <p><strong>Patch:</strong> ${escapeHtml(detail.promotion?.status || "N/A")}</p>
        <p><strong>Validação original:</strong> ${detail.files.some((f) => f.fileName === "25-validation-original.md" && f.exists) ? "Executada" : "N/A"}</p>
        ${run.finalCommit ? `
          <p><strong>Commit final:</strong></p>
          <pre style="margin: 0.5rem 0; padding: 0.5rem; background: var(--bg); border-radius: 4px;">${escapeHtml(run.finalCommit.sha)}
${escapeHtml(run.finalCommit.message)}</pre>
        ` : `
          <p><strong>Commit final:</strong> Não registrado</p>
          ${renderAttachCommitForm(detail)}
        `}
        <p><strong>Criada em:</strong> ${createdDate}</p>
        <p><strong>Finalizada em:</strong> ${finalizedDate}</p>
      </div>
    </div>
  `;
}

function renderNextActionPanel(detail: RunDetail): string {
  const primary = detail.nextActions.find((action) => action.primary) || detail.nextActions[0];

  if (!primary) {
    return `<div class="empty">Nenhum proximo passo detectado.</div>`;
  }

  return `
    <div class="card" style="background: var(--panel-soft); box-shadow: none; margin-bottom: 1rem;">
      <h3>Proximo passo</h3>
      <p class="item-title">${escapeHtml(primary.label)}</p>
      <p class="muted">${escapeHtml(primary.description)}</p>
      ${renderNextActionInstructions(detail, primary)}
      <div class="button-row" style="margin-top: 0.75rem;">
        ${detail.nextActions.map(renderNextActionButton).join("")}
      </div>
    </div>
  `;
}

function renderNextActionInstructions(detail: RunDetail, action: NextAction): string {
  if (action.stage === "supervisor" || (!hasSupervisorOutput(detail) && detail.run.status === "PREPARED")) {
    return `
      <ol>
        <li>Copie o prompt do Codex Supervisor.</li>
        <li>Cole no Codex.</li>
        <li>Peca para ele gerar o plano tecnico sem modificar arquivos.</li>
        <li>Cole a resposta abaixo em "Anexar saida do Codex Supervisor".</li>
      </ol>
    `;
  }

  return "";
}

function renderNextActionButton(action: NextAction): string {
  if (action.actionType === "COPY_PROMPT" && action.fileToOpen) {
    return `<button class="${action.primary ? "primary" : ""}" data-run-file="${escapeHtml(action.fileToOpen)}">${escapeHtml(action.label)}</button>`;
  }

  if (action.actionType === "RUN_ACTION" && action.runAction) {
    return `<button class="${action.primary ? "primary" : ""}" data-run-action="${escapeHtml(action.runAction)}">${escapeHtml(action.label)}</button>`;
  }

  if (action.actionType === "ATTACH_OUTPUT" && action.stage) {
    return `<button data-focus-attach="${escapeHtml(action.stage)}">${escapeHtml(action.label)}</button>`;
  }

  return `<button disabled>${escapeHtml(action.label)}</button>`;
}

function renderWorkspacePanel(detail: RunDetail): string {
  if (!detail.workspace) {
    return `<div class="empty" style="margin-top: 1rem;">Workspace sandbox ainda nao criado. Crie antes de entregar a tarefa ao Kiro.</div>`;
  }

  return `
    <div class="card" style="box-shadow: none; margin-top: 1rem;">
      <h3>Workspace seguro</h3>
      <p><strong>Kiro deve trabalhar somente neste workspace:</strong></p>
      <pre>${escapeHtml(detail.workspace.workspacePath)}</pre>
      <p><strong>Nao altere o repo original:</strong></p>
      <pre>${escapeHtml(detail.project.repoPath)}</pre>
      <div class="button-row">
        <button data-command="copy-workspace-path">Copiar caminho do workspace</button>
      </div>
    </div>
  `;
}

function renderTimelineSection(detail: RunDetail): string {
  return `
    <div style="margin-top: 1rem;">
      <h3>Timeline da Run</h3>
      <div class="button-row">
        <button data-command="load-timeline">Carregar Timeline</button>
      </div>
      ${state.timeline ? renderTimeline(state.timeline) : `<div class="empty">Clique em "Carregar Timeline" para ver os eventos da run.</div>`}
    </div>
  `;
}

function renderAgentPanel(detail: RunDetail): string {
  const roles = ["CTO_SUPERVISOR", "FULL_STACK_EXECUTOR", "CODE_REVIEWER"];
  const profiles = detail.agentProfiles || [];
  const invocations = detail.agentInvocations || [];

  if (profiles.length === 0) {
    return `
      <div style="margin-top: 1rem;">
        <h3>Agentes da Run</h3>
        <div class="empty">Nenhum perfil de agente configurado. Rode <code>maestro agents init-defaults</code>.</div>
      </div>
    `;
  }

  return `
    <div style="margin-top: 1rem;">
      <h3>Agentes da Run</h3>
      <div class="list">
        ${roles.map((role) => {
          const profile = profiles.find((item) => item.role === role);
          const latest = invocations.find((item) => item.role === role);

          if (!profile) {
            return `<div class="item"><strong>${escapeHtml(role)}</strong><p class="muted">Perfil nao configurado.</p></div>`;
          }

          return `
            <div class="item">
              <div class="item-header">
                <div>
                  <p class="item-title">${escapeHtml(profile.name)}</p>
                  <p class="item-subtitle">${escapeHtml(profile.role)} | ${escapeHtml(profile.provider)} | ${escapeHtml(profile.model || "sem modelo")}</p>
                </div>
                <span class="badge ${latest?.status === "SUCCEEDED" ? "ok" : latest?.status === "FAILED" ? "danger" : latest?.status === "BLOCKED" ? "warn" : ""}">${escapeHtml(latest?.status || "sem invocation")}</span>
              </div>
              <p>${escapeHtml(profile.description)}</p>
              ${latest ? `<p class="muted">Ultima invocation: ${escapeHtml(latest.id)}</p>` : ""}
              <div class="button-row" style="margin-top: 0.75rem;">
                <button data-agent-invoke="${escapeHtml(profile.role)}">Preparar invocacao</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderTimeline(events: any[]): string {
  if (events.length === 0) {
    return `<div class="empty">Nenhum evento registrado ainda.</div>`;
  }

  return `
    <div class="checklist" style="margin-top: 0.75rem;">
      ${events.map((event: any) => {
        const icon = event.status === "OK" ? "✓" : event.status === "ERROR" ? "✗" : event.status === "WARN" ? "⚠" : "ℹ";
        const timestamp = event.timestamp ? new Date(event.timestamp).toLocaleString("pt-BR") : "N/A";
        return `
          <div class="check">
            <span class="dot done">${icon}</span>
            <div>
              <strong>${escapeHtml(event.title)}</strong>
              <p class="muted">${escapeHtml(event.description)}</p>
              <p class="muted" style="font-size: 0.85rem;">
                ${timestamp}
                ${event.artifactPath ? ` • ${escapeHtml(event.artifactPath)}` : ""}
              </p>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderAttachAndDecision(detail: RunDetail): string {
  return `
    <div class="split" style="margin-top: 1rem;">
      <div class="list">
        ${renderStageAttachForm("supervisor", "Anexar saida do Codex Supervisor", "Anexar plano do Supervisor")}
        ${renderStageAttachForm("executor", "Anexar relatorio do Kiro Executor", "Anexar relatorio do Kiro")}
        ${renderStageAttachForm("reviewer", "Anexar revisao do Codex Reviewer", "Anexar revisao do Codex")}
      </div>
      <form class="card" id="decision-form">
        <h3>Human Review Gate</h3>
        <div class="field">
          <label>Decisao</label>
          <select name="status"><option>APPROVED</option><option>NEEDS_CHANGES</option><option>REJECTED</option><option>BLOCKED</option></select>
        </div>
        <div class="field"><label>Notas</label><textarea name="notes">${escapeHtml(detail.decision?.notes || "")}</textarea></div>
        <label class="check"><input type="checkbox" name="createFollowUpTask" /> Criar follow-up task</label>
        <button class="primary" type="submit">Registrar decisao humana</button>
      </form>
    </div>
  `;
}

function renderStageAttachForm(stage: "supervisor" | "executor" | "reviewer", title: string, buttonLabel: string): string {
  return `
    <form class="card attach-form" data-stage="${stage}" id="attach-${stage}">
      <h3>${escapeHtml(title)}</h3>
      <div class="field">
        <label>Conteudo</label>
        <textarea name="content" placeholder="Cole aqui a resposta manual..."></textarea>
      </div>
      <button class="primary" type="submit">${escapeHtml(buttonLabel)}</button>
    </form>
  `;
}

function renderActionLogs(): string {
  if (state.actionLogs.length === 0) {
    return "";
  }

  return `
    <div class="card" style="box-shadow: none; margin-top: 1rem;">
      <h3>Logs de acao da UI</h3>
      <div class="list">
        ${state.actionLogs.map((entry) => `
          <details class="item" ${entry.status === "ERROR" ? "open" : ""}>
            <summary><strong>${escapeHtml(entry.action)}</strong> | ${escapeHtml(entry.status)} | ${escapeHtml(entry.at)}</summary>
            <p>${escapeHtml(entry.message)}</p>
            ${entry.details ? `<pre>${escapeHtml(entry.details)}</pre>` : ""}
          </details>
        `).join("")}
      </div>
    </div>
  `;
}

function renderTaskItem(task: Task): string {
  return `
    <div class="item">
      <div class="item-header">
        <div>
          <p class="item-title">${escapeHtml(task.title)}</p>
          <p class="item-subtitle">${escapeHtml(task.id)}</p>
        </div>
        <span class="badge ${task.status === "BLOCKED" ? "danger" : task.status === "DONE" ? "ok" : ""}">${escapeHtml(task.status)}</span>
      </div>
      <p>${escapeHtml(task.description || "Sem descricao.")}</p>
      <div class="badge-row">
        <span class="badge">${escapeHtml(task.priority)}</span>
        ${task.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="button-row" style="margin-top: 0.75rem;">
        <button data-prepare-task="${task.id}">Preparar run</button>
      </div>
    </div>
  `;
}

function renderRunItem(run: Run): string {
  return `
    <button class="item ${run.id === state.selectedRunId ? "active" : ""}" data-run-id="${run.id}">
      <div class="item-header">
        <span class="item-title">${escapeHtml(run.id)}</span>
        <span class="badge">${escapeHtml(run.status)}</span>
      </div>
      <p class="item-subtitle">${escapeHtml(run.taskId || "sem task vinculada")}</p>
    </button>
  `;
}

function renderCompletedRunItem(run: Run): string {
  const createdDate = new Date(run.createdAt).toLocaleDateString("pt-BR");
  const finalizedDate = run.finalizedAt ? new Date(run.finalizedAt).toLocaleDateString("pt-BR") : "N/A";
  
  return `
    <button class="item ${run.id === state.selectedRunId ? "active" : ""}" data-run-id="${run.id}">
      <div class="item-header">
        <span class="item-title">${escapeHtml(run.goal.slice(0, 60))}${run.goal.length > 60 ? "..." : ""}</span>
        <span class="badge ok">${escapeHtml(run.status)}</span>
      </div>
      <p class="item-subtitle">${escapeHtml(run.taskId || "sem task vinculada")}</p>
      <div class="badge-row" style="margin-top: 0.25rem;">
        <span class="badge">Criada: ${createdDate}</span>
        <span class="badge">Finalizada: ${finalizedDate}</span>
        ${run.finalCommit ? `<span class="badge ok">Commit: ${escapeHtml(run.finalCommit.sha.slice(0, 7))}</span>` : ""}
      </div>
    </button>
  `;
}

function renderTaskMiniList(tasks: Task[]): string {
  return tasks.length > 0
    ? `<div class="list">${tasks.slice(0, 6).map((task) => `<div class="item"><strong>${escapeHtml(task.title)}</strong><p class="muted">${escapeHtml(task.id)} | ${escapeHtml(task.priority)} | ${escapeHtml(task.status)}</p></div>`).join("")}</div>`
    : `<div class="empty">Nenhuma prioridade alta aberta.</div>`;
}

function metricCard(title: string, value: string, note: string): string {
  return `<div class="card"><h3>${escapeHtml(title)}</h3><p class="item-title">${escapeHtml(value)}</p><p class="muted">${escapeHtml(note)}</p></div>`;
}

function actionButton(action: string, label: string): string {
  return `<button data-run-action="${action}">${label}</button>`;
}

function fileButton(fileName: string): string {
  return `<button data-run-file="${fileName}">${fileName}</button>`;
}

function bindForms(): void {
  document.querySelector<HTMLFormElement>("#ceo-form")?.addEventListener("submit", (event) => void submitCeo(event));
  document.querySelector<HTMLFormElement>("#task-form")?.addEventListener("submit", (event) => void submitTask(event));
  document.querySelector<HTMLFormElement>("#project-form")?.addEventListener("submit", (event) => void submitProject(event));
  document.querySelectorAll<HTMLFormElement>(".attach-form").forEach((form) => {
    form.addEventListener("submit", (event) => void submitAttach(event));
  });
  document.querySelector<HTMLFormElement>("#decision-form")?.addEventListener("submit", (event) => void submitDecision(event));
  document.querySelector<HTMLFormElement>("#attach-commit-form")?.addEventListener("submit", (event) => void submitAttachCommit(event));
}

async function handleClick(event: Event): Promise<void> {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLElement>("button");
  if (!button) return;

  const view = button.dataset.view as ViewName | undefined;
  if (view) {
    state.view = view;
    render();
    return;
  }

  if (button.dataset.projectId) {
    state.activeProjectId = button.dataset.projectId;
    state.selectedRunId = undefined;
    localStorage.setItem("maestro-active-project", state.activeProjectId);
    await runBusy(async () => refreshProjectData(), "Projeto selecionado.");
    return;
  }

  if (button.dataset.runId) {
    await runBusy(async () => loadRun(button.dataset.runId || ""), "Run aberta.");
    return;
  }

  if (button.dataset.prepareTask) {
    await prepareRunForTask(button.dataset.prepareTask);
    return;
  }

  if (button.dataset.runAction) {
    await executeRunAction(button.dataset.runAction);
    return;
  }

  if (button.dataset.agentInvoke) {
    await invokeAgent(button.dataset.agentInvoke);
    return;
  }

  if (button.dataset.focusAttach) {
    focusAttachForm(button.dataset.focusAttach);
    return;
  }

  if (button.dataset.runFile) {
    await openRunFile(button.dataset.runFile);
    return;
  }

  if (button.dataset.memoryAction) {
    await executeMemoryAction(button.dataset.memoryAction);
    return;
  }

  if (button.dataset.memoryFile) {
    await openMemoryFile(button.dataset.memoryFile);
    return;
  }

  if (button.dataset.command === "doctor") {
    await runBusy(async () => {
      const health = await api<Record<string, unknown>>("/api/health");
      showToast(`Doctor OK: ${health.projectCount} projetos, ${health.runCount} runs.`);
    });
    return;
  }

  if (button.dataset.command === "copy-open-file" && state.fileViewer) {
    await copyText(state.fileViewer.content);
    showToast("Conteudo copiado.");
    return;
  }

  if (button.dataset.command === "copy-workspace-path" && state.runDetail?.workspace) {
    await copyText(state.runDetail.workspace.workspacePath);
    showToast("Caminho do workspace copiado.");
    return;
  }

  if (button.dataset.command === "prepare-kiro") {
    await prepareKiroExecution();
    return;
  }

  if (button.dataset.command === "create-pilot-task") {
    await createPilotTask();
    return;
  }

  if (button.dataset.command === "load-timeline") {
    await loadTimeline();
    return;
  }
}

async function loadTimeline(): Promise<void> {
  if (!state.selectedRunId) {
    showToast("Nenhuma run selecionada.");
    return;
  }

  await runBusy(async () => {
    const response = await api<{ runId: string; events: any[] }>(`/api/runs/${state.selectedRunId}/timeline`);
    state.timeline = response.events;
    render();
  }, "Timeline carregada.");
}

async function submitCeo(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const message = String(form.get("message") || "").trim();
  if (!message) return showToast("Escreva um pedido para o CEO.");
  const firstLine = message.split(/\r?\n/u).find(Boolean) || "Pedido do CEO";
  await createTask({
    title: firstLine.slice(0, 90),
    description: message,
    priority: "MEDIUM",
    tags: "ceo-request"
  });
  state.view = "tasks";
}

async function submitTask(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  await createTask({
    title: String(form.get("title") || ""),
    description: String(form.get("description") || ""),
    priority: String(form.get("priority") || "MEDIUM"),
    tags: String(form.get("tags") || "")
  });
}

async function submitProject(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  await runBusy(async () => {
    const result = await api<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      body: {
        name: String(form.get("name") || ""),
        repoPath: String(form.get("repoPath") || ""),
        description: String(form.get("description") || ""),
        stack: String(form.get("stack") || "")
      }
    });
    state.activeProjectId = result.project.id;
    await refreshProjects();
  }, "Projeto salvo.");
}

async function submitAttach(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!state.selectedRunId) return;
  const formElement = event.currentTarget as HTMLFormElement;
  const form = new FormData(formElement);
  const stage = formElement.dataset.stage || "supervisor";
  await runBusy(async () => {
    const result = await api(`/api/runs/${state.selectedRunId}/attach`, {
      method: "POST",
      body: {
        stage,
        content: String(form.get("content") || "")
      }
    });
    pushActionLog(`ATTACH_${stage.toUpperCase()}`, "OK", "Output anexado pela UI.", result);
    formElement.reset();
    await refreshProjectData();
  }, "Output anexado.");
}

async function submitDecision(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!state.selectedRunId) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  await runBusy(async () => {
    await api(`/api/runs/${state.selectedRunId}/action`, {
      method: "POST",
      body: {
        action: "DECIDE",
        status: String(form.get("status") || "APPROVED"),
        notes: String(form.get("notes") || ""),
        createFollowUpTask: form.get("createFollowUpTask") === "on"
      }
    });
    await refreshProjectData();
  }, "Decisao humana registrada.");
}

async function submitAttachCommit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!state.selectedRunId) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const commitSha = String(form.get("commitSha") || "").trim();
  const commitMessage = String(form.get("commitMessage") || "").trim();
  
  if (!commitSha || !commitMessage) {
    return showToast("Preencha o SHA e a mensagem do commit.");
  }
  
  await runBusy(async () => {
    await api(`/api/runs/${state.selectedRunId}/attach-commit`, {
      method: "POST",
      body: {
        commit: commitSha,
        message: commitMessage
      }
    });
    await refreshProjectData();
  }, "Commit final registrado.");
}

async function createTask(input: { title: string; description: string; priority: string; tags: string }): Promise<void> {
  if (!state.activeProjectId) return;
  await runBusy(async () => {
    await api(`/api/projects/${state.activeProjectId}/tasks`, { method: "POST", body: input });
    await refreshProjectData();
  }, "Task criada. Proximo passo: preparar run.");
}

async function createPilotTask(): Promise<void> {
  if (!state.activeProjectId) return;
  await runBusy(async () => {
    await api("/api/pilot/start", {
      method: "POST",
      body: {
        projectId: state.activeProjectId,
        title: "Pilot task segura",
        description: "Task piloto criada pela UI para operar o fluxo Maestro.",
        tags: "pilot,ceo-request"
      }
    });
    await refreshProjectData();
  }, "Pilot task criada.");
}

async function prepareRunForTask(taskId: string): Promise<void> {
  if (!state.activeProjectId) return;
  await runBusy(async () => {
    const result = await api<{ run: Run }>(`/api/projects/${state.activeProjectId}/runs`, { method: "POST", body: { taskId } });
    state.selectedRunId = result.run.id;
    state.view = "runs";
    await refreshProjectData();
  }, "Run preparada.");
}

async function executeRunAction(action: string): Promise<void> {
  if (!state.selectedRunId) return;
  await runBusy(async () => {
    const result = await api(`/api/runs/${state.selectedRunId}/action`, { method: "POST", body: { action } });
    pushActionLog(action, "OK", "Acao executada pela API local.", result);
    await refreshProjectData();
  }, `${action} concluido.`);
}

async function invokeAgent(role: string): Promise<void> {
  if (!state.selectedRunId) return;
  await runBusy(async () => {
    const result = await api(`/api/runs/${state.selectedRunId}/agents/invoke`, {
      method: "POST",
      body: { role }
    });
    pushActionLog(`AGENT_${role}`, "OK", "Invocacao de agente preparada.", result);
    await refreshProjectData();
  }, `Invocacao preparada para ${role}.`);
}

async function prepareKiroExecution(): Promise<void> {
  if (!state.selectedRunId) return;

  await runBusy(async () => {
    if (!state.runDetail?.workspace) {
      const workspaceResult = await api(`/api/runs/${state.selectedRunId}/action`, {
        method: "POST",
        body: { action: "CREATE_WORKSPACE" }
      });
      pushActionLog("CREATE_WORKSPACE", "OK", "Workspace sandbox criado para a run.", workspaceResult);
    }

    const handoffResult = await api(`/api/runs/${state.selectedRunId}/action`, {
      method: "POST",
      body: { action: "GENERATE_HANDOFF" }
    });
    pushActionLog("GENERATE_HANDOFF", "OK", "Kiro Handoff gerado.", handoffResult);
    await refreshProjectData();
  }, "Execucao do Kiro preparada.");
}

async function executeMemoryAction(action: string): Promise<void> {
  if (!state.activeProjectId) return;
  await runBusy(async () => {
    await api(`/api/projects/${state.activeProjectId}/memory/action`, { method: "POST", body: { action } });
    await refreshProjectData();
  }, `${action} concluido.`);
}

async function openRunFile(fileName: string): Promise<void> {
  if (!state.selectedRunId) return;
  await runBusy(async () => {
    state.fileViewer = await api<{ fileName: string; content: string }>(`/api/runs/${state.selectedRunId}/files/${encodePath(fileName)}`);
  }, "Arquivo aberto.");
}

async function openMemoryFile(fileName: string): Promise<void> {
  if (!state.activeProjectId) return;
  await runBusy(async () => {
    state.memoryFile = await api<{ fileName: string; content: string }>(`/api/projects/${state.activeProjectId}/memory/files/${encodePath(fileName)}`);
  }, "Memoria aberta.");
}

async function runBusy(work: () => Promise<void>, message?: string): Promise<void> {
  state.busy = true;
  render();
  try {
    await work();
    if (message) showToast(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushActionLog("UI_ACTION", "ERROR", message, error);
    showToast(message);
  } finally {
    state.busy = false;
    render();
  }
}

function pushActionLog(action: string, status: "OK" | "ERROR", message: string, details?: unknown): void {
  state.actionLogs = [
    {
      action,
      status,
      message,
      details: details === undefined ? undefined : stringifyDetails(details),
      at: new Date().toLocaleTimeString()
    },
    ...state.actionLogs
  ].slice(0, 8);
}

function stringifyDetails(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hasSupervisorOutput(detail: RunDetail): boolean {
  return detail.files.some((file) => file.fileName === "07-supervisor-output.md" && file.exists);
}

function focusAttachForm(stage: string): void {
  const form = document.querySelector<HTMLFormElement>(`#attach-${stage}`);
  const textarea = form?.querySelector<HTMLTextAreaElement>("textarea");

  textarea?.focus();
  textarea?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

async function api<T>(pathName: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${pathName}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `API error ${response.status}`);
  }
  return payload as T;
}

function showToast(message: string): void {
  state.toast = message;
  window.setTimeout(() => {
    if (state.toast === message) {
      state.toast = undefined;
      render();
    }
  }, 3000);
}

function encodePath(fileName: string): string {
  return fileName.split("/").map(encodeURIComponent).join("/");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
