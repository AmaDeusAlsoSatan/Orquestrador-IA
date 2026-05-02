import type {
  AgentInvocation,
  AgentInvocationStage,
  AgentProfile,
  AgentProvider,
  AgentRole,
  AgentRunStatus
} from "@maestro/core";
import { runCapturedCommand } from "@maestro/providers";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface AgentProviderAdapter {
  provider: AgentProvider;
  invoke(input: AgentInvocationInput): Promise<AgentInvocationResult>;
}

export interface AgentInvocationInput {
  invocationId: string;
  runId: string;
  projectId: string;
  role: AgentRole;
  stage: AgentInvocation["stage"];
  prompt: string;
  cwd?: string;
  workspacePath?: string;
  metadata?: Record<string, unknown>;
  homeDir?: string;
}

export interface AgentInvocationResult {
  status: Extract<AgentRunStatus, "SUCCEEDED" | "FAILED" | "BLOCKED">;
  output?: string;
  outputText?: string;
  outputPath?: string;
  blockedReason?: string;
  errorMessage?: string;
}

export interface OpenClaudeAdapterConfig {
  executablePath?: string;
  workingDirectory?: string;
  profileName?: string;
  model?: string;
  timeoutMs?: number;
}

export interface AgentModelMapEntry {
  provider: AgentProvider;
  model: string;
}

export type AgentModelMap = Partial<Record<AgentRole, AgentModelMapEntry>>;

export const DEFAULT_AGENT_MODEL_MAP: AgentModelMap = {
  CEO: {
    provider: "kiro_openclaude",
    model: "best-reasoning-free"
  },
  CTO_SUPERVISOR: {
    provider: "kiro_openclaude",
    model: "best-reasoning-free"
  },
  FULL_STACK_EXECUTOR: {
    provider: "kiro_openclaude",
    model: "best-coding-free"
  },
  CODE_REVIEWER: {
    provider: "kiro_openclaude",
    model: "best-review-free"
  },
  QA_VALIDATOR: {
    provider: "manual",
    model: "local-validation"
  }
};

export function createDefaultAgentProfiles(now = new Date().toISOString()): AgentProfile[] {
  return [
    {
      id: "ceo",
      name: "CEO",
      role: "CEO",
      provider: "manual",
      model: "human-intake",
      description: "Transforma pedidos humanos em objetivos, tasks e runs rastreaveis.",
      responsibilities: [
        "Entender o pedido humano",
        "Criar ou organizar tasks",
        "Priorizar o proximo passo do projeto",
        "Encaminhar a run para os agentes corretos"
      ],
      allowedActions: ["CREATE_TASK", "PREPARE_RUN", "REQUEST_HUMAN_APPROVAL"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "cto-supervisor",
      name: "CTO Supervisor",
      role: "CTO_SUPERVISOR",
      provider: "codex_manual",
      model: "manual-codex-review",
      description: "Le contexto, planeja a implementacao, define arquivos, riscos e criterios de aceite.",
      responsibilities: [
        "Ler o context pack",
        "Gerar plano tecnico",
        "Definir limites de escopo",
        "Gerar instrucoes objetivas para o executor"
      ],
      allowedActions: ["READ_CONTEXT", "WRITE_SUPERVISOR_PLAN"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "full-stack-executor",
      name: "Full Stack Executor",
      role: "FULL_STACK_EXECUTOR",
      provider: "manual",
      model: "manual-executor",
      description: "Executa a tarefa no workspace sandbox seguindo o plano aprovado.",
      responsibilities: [
        "Trabalhar somente no workspace sandbox",
        "Seguir o plano do supervisor",
        "Evitar escopo extra",
        "Gerar relatorio final de execucao"
      ],
      allowedActions: ["EDIT_WORKSPACE", "WRITE_EXECUTOR_REPORT"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "code-reviewer",
      name: "Code Reviewer",
      role: "CODE_REVIEWER",
      provider: "codex_manual",
      model: "manual-codex-review",
      description: "Revisa o relatorio do executor junto com o diff real capturado pelo Maestro.",
      responsibilities: [
        "Comparar diff real com plano aprovado",
        "Verificar regressao e escopo extra",
        "Aprovar, reprovar ou pedir ajustes",
        "Gerar resumo para o Vault"
      ],
      allowedActions: ["READ_DIFF", "WRITE_REVIEW_VERDICT"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "qa-validator",
      name: "QA Validator",
      role: "QA_VALIDATOR",
      provider: "manual",
      model: "local-validation",
      description: "Roda validacoes locais e interpreta resultados antes da decisao humana.",
      responsibilities: [
        "Executar validacoes configuradas",
        "Registrar falhas de ambiente separadas de falhas de codigo",
        "Sugerir validacoes adicionais quando necessario"
      ],
      allowedActions: ["RUN_VALIDATION", "READ_VALIDATION_REPORT"],
      createdAt: now,
      updatedAt: now
    }
  ];
}

export function getAdapterForProvider(provider: AgentProvider, config: OpenClaudeAdapterConfig = {}): AgentProviderAdapter {
  if (provider === "manual" || provider === "codex_manual") {
    return createManualAdapter(provider);
  }

  if (provider === "openclaude" || provider === "kiro_openclaude" || provider === "openclaude_grouter") {
    return createOpenClaudeAdapter(provider, config);
  }

  return createManualAdapter("manual");
}

export function resolveStageForRole(role: AgentRole): AgentInvocationStage {
  switch (role) {
    case "CEO":
      return "CEO_INTAKE";
    case "CTO":
    case "CTO_SUPERVISOR":
      return "SUPERVISOR_PLAN";
    case "FULL_STACK_DEV":
    case "FULL_STACK_EXECUTOR":
      return "EXECUTOR_IMPLEMENT";
    case "QA":
    case "QA_VALIDATOR":
      return "QA_VALIDATE";
    case "CODE_REVIEWER":
      return "REVIEWER_REVIEW";
    case "MEMORY":
      return "CEO_INTAKE";
  }
}

function createManualAdapter(provider: AgentProvider): AgentProviderAdapter {
  return {
    provider,
    async invoke(input) {
      const blockedReason = "Awaiting manual output";
      return {
        status: "BLOCKED",
        blockedReason,
        outputText: [
          "# Manual Agent Invocation",
          "",
          `Invocation: ${input.invocationId}`,
          `Role: ${input.role}`,
          `Stage: ${input.stage}`,
          "",
          "Status: BLOCKED",
          `Reason: ${blockedReason}`,
          "",
          "This provider does not call an external model automatically.",
          "Copy `01-input-prompt.md` to the intended agent/tool and attach the output back to Maestro."
        ].join("\n")
      };
    }
  };
}

function createOpenClaudeAdapter(provider: AgentProvider, config: OpenClaudeAdapterConfig): AgentProviderAdapter {
  return {
    provider,
    async invoke(input) {
      return invokeOpenClaude(input, config, provider);
    }
  };
}

export async function invokeOpenClaude(
  input: AgentInvocationInput,
  config: OpenClaudeAdapterConfig,
  provider: AgentProvider = "openclaude"
): Promise<AgentInvocationResult> {
  // For openclaude_grouter, execute real invocation (loads its own config)
  if (provider === "openclaude_grouter") {
    try {
      // Load openclaude-grouter config
      const homeDir = input.homeDir || process.cwd();
      const configPath = path.join(homeDir, "data", "config", "openclaude-grouter.json");
      
      let grouterConfig: any;
      try {
        const configContent = await fs.readFile(configPath, "utf8");
        grouterConfig = JSON.parse(configContent);
      } catch (error) {
        return {
          status: "BLOCKED",
          blockedReason: "Config not found",
          errorMessage: `openclaude-grouter config not found at ${configPath}. Run: maestro provider doctor --provider openclaude_grouter`
        };
      }

      if (!grouterConfig.executablePath) {
        return {
          status: "BLOCKED",
          blockedReason: "Executable not configured",
          errorMessage: "openclaude-grouter executablePath not configured"
        };
      }

      // Build args (prompt goes via stdin, but provider/model must be in args)
      const args = grouterConfig.executableArgs ? [...grouterConfig.executableArgs] : [];
      args.push("-p", "--provider", "openai", "--model", grouterConfig.model);

      // Execute OpenClaude with stdin
      const result = await runCapturedCommand(grouterConfig.executablePath, args, {
        cwd: grouterConfig.workingDirectory || homeDir,
        env: { ...process.env, ...grouterConfig.env },
        timeoutMs: grouterConfig.timeoutMs || 300000,
        stdinContent: input.prompt,
        allowStackBufferOverrunWithStdout: true
      });

      if (result.timedOut) {
        return {
          status: "FAILED",
          errorMessage: `OpenClaude timed out after ${grouterConfig.timeoutMs || 300000}ms`
        };
      }

      if (result.exitCode !== 0) {
        return {
          status: "FAILED",
          errorMessage: `OpenClaude exited with code ${result.exitCode}: ${result.stderr || result.errorMessage || "unknown error"}`
        };
      }

      const output = result.stdout.trim();
      if (!output) {
        return {
          status: "FAILED",
          errorMessage: "OpenClaude returned empty output"
        };
      }

      return {
        status: "SUCCEEDED",
        outputText: output
      };
    } catch (error) {
      return {
        status: "FAILED",
        errorMessage: `OpenClaude execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // For other OpenClaude providers, check if configured
  const configured = Boolean(config.executablePath && config.workingDirectory);

  if (!configured) {
    const blockedReason = "Provider not configured";
    return {
      status: "BLOCKED",
      blockedReason,
      errorMessage: [
        `${provider} adapter not configured.`,
        "Maestro intentionally does not reuse any global OpenClaude installation.",
        "Configure an isolated OpenClaude executable/profile for Maestro before enabling automatic dispatch."
      ].join(" ")
    };
  }

  // For other providers, still blocked
  return {
    status: "BLOCKED",
    blockedReason: "Automatic execution disabled",
    errorMessage: [
      `${provider} adapter stub reached for invocation ${input.invocationId}.`,
      "Automatic OpenClaude execution is not enabled in this phase."
    ].join(" ")
  };
}
