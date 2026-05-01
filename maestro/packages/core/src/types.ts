export type ProjectStatus = "idea" | "active" | "paused" | "archived" | "maintenance";

export type ProjectPriority = "low" | "medium" | "high" | "critical";

export type AgentRole =
  | "CEO"
  | "CTO"
  | "FULL_STACK_DEV"
  | "QA"
  | "MEMORY"
  | "CTO_SUPERVISOR"
  | "FULL_STACK_EXECUTOR"
  | "CODE_REVIEWER"
  | "QA_VALIDATOR";

export type AgentAdapterType = "CODEX_SUPERVISOR" | "KIRO_EXECUTOR" | "OPENCLAUDE_EXECUTOR" | "LOCAL_LLM" | "MANUAL";

export type AgentAdapterRole = "SUPERVISOR" | "EXECUTOR" | "REVIEWER" | "MEMORY_MANAGER";

export type AgentProvider = "manual" | "openclaude" | "codex_manual" | "kiro_openclaude" | "kiro_cli" | "grouter_kiro";

export type AgentRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED";

export type AgentInvocationStage =
  | "CEO_INTAKE"
  | "SUPERVISOR_PLAN"
  | "EXECUTOR_IMPLEMENT"
  | "REVIEWER_REVIEW"
  | "QA_VALIDATE";

export type TaskStatus = "TODO" | "READY" | "IN_PROGRESS" | "REVIEW_NEEDED" | "DONE" | "BLOCKED" | "CANCELLED";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type RunStatus =
  | "PREPARED"
  | "SUPERVISOR_PLANNED"
  | "EXECUTOR_READY"
  | "EXECUTOR_REPORTED"
  | "REVIEW_READY"
  | "REVIEWED"
  | "FINALIZED"
  | "BLOCKED";

export type HumanDecisionStatus = "APPROVED" | "NEEDS_CHANGES" | "REJECTED" | "BLOCKED";

export type WorkspaceStatus = "CREATED" | "DIRTY" | "CAPTURED" | "DISCARDED" | "MISSING";

export type PatchPromotionStatus =
  | "EXPORTED"
  | "CHECK_PASSED"
  | "CHECK_FAILED"
  | "APPROVED_FOR_APPLY"
  | "APPLIED"
  | "BLOCKED";

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  description: string;
  stack: string[];
  status: ProjectStatus;
  priority: ProjectPriority;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  relatedRunIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  blockedReason?: string;
}

export type Task = ProjectTask;

export interface HumanReviewDecision {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string;
  status: HumanDecisionStatus;
  notes: string;
  createFollowUpTask: boolean;
  followUpTaskId?: string;
  decidedAt: string;
}

export interface MemoryDocument {
  projectId: string;
  path: string;
  title: string;
  kind:
    | "overview"
    | "current-state"
    | "backlog"
    | "decisions"
    | "known-problems"
    | "next-actions"
    | "agent-log"
    | "imported-context";
  createdAt: string;
  updatedAt: string;
}

export interface AgentAdapterProfile {
  id: string;
  name: string;
  type: AgentAdapterType;
  role: AgentAdapterRole;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  model?: string;
  description: string;
  responsibilities: string[];
  allowedActions: string[];
  projectIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentInvocation {
  id: string;
  runId: string;
  projectId: string;
  agentProfileId: string;
  role: AgentRole;
  provider: AgentProvider;
  stage: AgentInvocationStage;
  inputPath: string;
  outputPath?: string;
  status: AgentRunStatus;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  errorMessage?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  assignedRole: AgentAdapterRole;
  adapterType: AgentAdapterType;
  inputDocuments: string[];
  outputDocuments: string[];
  requiresApproval: boolean;
}

export interface OrchestrationWorkflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  projectId: string;
  taskId?: string;
  goal: string;
  status: RunStatus;
  path: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  finalCommit?: FinalCommit;
}

export interface FinalCommit {
  sha: string;
  message: string;
  recordedAt: string;
}

export type RunTimelineEventType =
  | "RUN_CREATED"
  | "SUPERVISOR_ATTACHED"
  | "WORKSPACE_CREATED"
  | "HANDOFF_CREATED"
  | "EXECUTOR_ATTACHED"
  | "DIFF_CAPTURED"
  | "REVIEW_PACKAGE_CREATED"
  | "REVIEWER_ATTACHED"
  | "HUMAN_DECISION"
  | "PATCH_EXPORTED"
  | "PATCH_CHECKED"
  | "PATCH_PLANNED"
  | "PATCH_DRY_RUN"
  | "PATCH_APPLIED"
  | "VALIDATION_WORKSPACE"
  | "VALIDATION_ORIGINAL"
  | "FINALIZED"
  | "FINAL_COMMIT_RECORDED";

export interface RunTimelineEvent {
  id: string;
  runId: string;
  type: RunTimelineEventType;
  title: string;
  description: string;
  status?: "OK" | "WARN" | "ERROR" | "INFO";
  timestamp?: string;
  artifactPath?: string;
}

export interface RunWorkspace {
  id: string;
  runId: string;
  projectId: string;
  sourceRepoPath: string;
  workspacePath: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  baselineCommit?: string;
}

export interface PatchPromotion {
  id: string;
  runId: string;
  projectId: string;
  workspaceId?: string;
  sourceWorkspacePath: string;
  targetRepoPath: string;
  patchPath: string;
  status: PatchPromotionStatus;
  createdAt: string;
  updatedAt: string;
  checkOutput?: string;
  appliedAt?: string;
}

export type ValidationTarget = "WORKSPACE" | "ORIGINAL_REPO";

export type ValidationStatus = "NOT_RUN" | "PASSED" | "FAILED" | "BLOCKED";

export interface ValidationCommand {
  id: string;
  label: string;
  command: string;
  args: string[];
  cwdTarget: ValidationTarget;
  timeoutMs: number;
  required: boolean;
}

export interface ProjectValidationProfile {
  projectId: string;
  packageManager?: "pnpm" | "npm" | "yarn" | "bun";
  commands: ValidationCommand[];
  createdAt: string;
  updatedAt: string;
}

export interface ValidationRun {
  id: string;
  runId: string;
  projectId: string;
  target: ValidationTarget;
  status: ValidationStatus;
  commandResults: ValidationCommandResult[];
  createdAt: string;
  updatedAt: string;
}

export interface ValidationCommandResult {
  commandId: string;
  label: string;
  commandLine: string;
  resolvedCommand?: string;
  exitCode: number | null;
  status: ValidationStatus;
  stdoutPath: string;
  stderrPath: string;
  durationMs: number;
}

export interface ProviderProfile {
  id: string;
  name: string;
  kind: "openai-compatible" | "local" | "headless" | "mock";
  baseUrl?: string;
  defaultModel?: string;
  enabled: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaestroState {
  version: 1;
  createdAt: string;
  updatedAt: string;
  projects: Project[];
  tasks: ProjectTask[];
  decisions: HumanReviewDecision[];
  providerProfiles: ProviderProfile[];
  agentProfiles: AgentProfile[];
  agentInvocations: AgentInvocation[];
  agentAdapterProfiles: AgentAdapterProfile[];
  orchestrationWorkflows: OrchestrationWorkflow[];
  runs: RunRecord[];
  workspaces: RunWorkspace[];
  promotions: PatchPromotion[];
  validationProfiles: ProjectValidationProfile[];
  validationRuns: ValidationRun[];
  providerAuthSessions: import("./provider-config").ProviderAuthSession[];
  grouterConnections: import("./provider-config").GrouterConnectionRef[];
}

export interface ProjectInput {
  id?: string;
  name: string;
  repoPath?: string;
  description?: string;
  stack?: string[];
  status?: ProjectStatus;
  priority?: ProjectPriority;
}
