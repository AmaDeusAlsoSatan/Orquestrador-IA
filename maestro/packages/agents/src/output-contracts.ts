import type { AgentRole } from "@maestro/core";

/**
 * Agent Output Contract Validation
 * 
 * Validates that agent outputs meet minimum quality standards for their role.
 * Prevents accepting technically successful responses that don't deliver the expected artifact.
 */

export interface OutputContractResult {
  valid: boolean;
  reason?: string;
  missingElements?: string[];
}

/**
 * Validate CTO_SUPERVISOR output
 * 
 * Required elements:
 * - Plan section (## Plano or ## Technical Plan)
 * - At least 2 of: Files, Risks, Acceptance Criteria, Executor Instructions, Steps
 */
function validateSupervisorOutput(output: string): OutputContractResult {
  const lowerOutput = output.toLowerCase();
  
  // Check for plan section
  const hasPlan = 
    lowerOutput.includes("## plano") ||
    lowerOutput.includes("## technical plan") ||
    lowerOutput.includes("## plan");
  
  if (!hasPlan) {
    return {
      valid: false,
      reason: "Missing plan section (## Plano or ## Technical Plan)",
      missingElements: ["Plan section"]
    };
  }
  
  // Check for required elements
  const elements = {
    files: lowerOutput.includes("arquivo") || lowerOutput.includes("file"),
    risks: lowerOutput.includes("risco") || lowerOutput.includes("risk"),
    criteria: lowerOutput.includes("critério") || lowerOutput.includes("criteria") || lowerOutput.includes("aceite"),
    executor: lowerOutput.includes("executor") || lowerOutput.includes("execução"),
    steps: lowerOutput.includes("passo") || lowerOutput.includes("step") || lowerOutput.includes("etapa")
  };
  
  const presentElements = Object.entries(elements).filter(([_, present]) => present);
  
  if (presentElements.length < 2) {
    const missingElements = Object.entries(elements)
      .filter(([_, present]) => !present)
      .map(([name]) => name);
    
    return {
      valid: false,
      reason: `Insufficient plan detail (found ${presentElements.length}/5 elements, need at least 2)`,
      missingElements
    };
  }
  
  // Check for incomplete responses (agent saying it will do something instead of doing it)
  const incompletePatterns = [
    "let me read",
    "let me start",
    "i will read",
    "i will start",
    "vou ler",
    "vou começar"
  ];
  
  const hasIncompletePattern = incompletePatterns.some(pattern => 
    lowerOutput.includes(pattern)
  );
  
  if (hasIncompletePattern && output.length < 500) {
    return {
      valid: false,
      reason: "Output appears incomplete (agent stating intent to read files instead of delivering plan)",
      missingElements: ["Complete plan"]
    };
  }
  
  return { valid: true };
}

/**
 * Validate FULL_STACK_EXECUTOR output
 * 
 * Required elements:
 * - Implementation section (## Implementação or ## Execution)
 * - Completion signal: Files changed, Validation, Result, or Done
 */
function validateExecutorOutput(output: string): OutputContractResult {
  const lowerOutput = output.toLowerCase();
  
  // Check for implementation section
  const hasImplementation = 
    lowerOutput.includes("## implementação") ||
    lowerOutput.includes("## implementation") ||
    lowerOutput.includes("## execution") ||
    lowerOutput.includes("## execução");
  
  if (!hasImplementation) {
    return {
      valid: false,
      reason: "Missing implementation section (## Implementação or ## Execution)",
      missingElements: ["Implementation section"]
    };
  }
  
  // Check for completion signals
  const completionSignals = {
    filesChanged: lowerOutput.includes("arquivo") && (lowerOutput.includes("alterado") || lowerOutput.includes("modificado") || lowerOutput.includes("changed")),
    validation: lowerOutput.includes("validação") || lowerOutput.includes("validation") || lowerOutput.includes("verificação"),
    result: lowerOutput.includes("resultado") || lowerOutput.includes("result"),
    done: lowerOutput.includes("concluído") || lowerOutput.includes("done") || lowerOutput.includes("completed")
  };
  
  const hasCompletionSignal = Object.values(completionSignals).some(signal => signal);
  
  if (!hasCompletionSignal) {
    return {
      valid: false,
      reason: "Missing completion signal (files changed, validation, result, or done)",
      missingElements: ["Completion signal"]
    };
  }
  
  return { valid: true };
}

/**
 * Validate CODE_REVIEWER output
 * 
 * Required elements:
 * - Review section (## Revisão or ## Review)
 * - Verdict: APPROVED, NEEDS_CHANGES, REJECTED, or BLOCKED
 */
function validateReviewerOutput(output: string): OutputContractResult {
  const lowerOutput = output.toLowerCase();
  
  // Check for review section
  const hasReview = 
    lowerOutput.includes("## revisão") ||
    lowerOutput.includes("## review") ||
    lowerOutput.includes("## análise");
  
  if (!hasReview) {
    return {
      valid: false,
      reason: "Missing review section (## Revisão or ## Review)",
      missingElements: ["Review section"]
    };
  }
  
  // Check for verdict
  const verdicts = {
    approved: lowerOutput.includes("approved") || lowerOutput.includes("aprovado"),
    needsChanges: lowerOutput.includes("needs_changes") || lowerOutput.includes("needs changes") || lowerOutput.includes("precisa de mudanças"),
    rejected: lowerOutput.includes("rejected") || lowerOutput.includes("rejeitado"),
    blocked: lowerOutput.includes("blocked") || lowerOutput.includes("bloqueado")
  };
  
  const hasVerdict = Object.values(verdicts).some(verdict => verdict);
  
  if (!hasVerdict) {
    return {
      valid: false,
      reason: "Missing verdict (APPROVED, NEEDS_CHANGES, REJECTED, or BLOCKED)",
      missingElements: ["Verdict"]
    };
  }
  
  return { valid: true };
}

/**
 * Validate agent output based on role
 * 
 * @param role - Agent role
 * @param output - Agent output text
 * @returns Validation result
 */
export function validateAgentOutput(role: AgentRole, output: string): OutputContractResult {
  if (!output || output.trim().length === 0) {
    return {
      valid: false,
      reason: "Empty output",
      missingElements: ["Any content"]
    };
  }
  
  switch (role) {
    case "CTO_SUPERVISOR":
      return validateSupervisorOutput(output);
    
    case "FULL_STACK_EXECUTOR":
      return validateExecutorOutput(output);
    
    case "CODE_REVIEWER":
      return validateReviewerOutput(output);
    
    case "CEO":
    case "QA_VALIDATOR":
    case "MEMORY":
      // These roles don't have strict contracts yet
      return { valid: true };
    
    default:
      // Unknown role - accept for now
      return { valid: true };
  }
}
