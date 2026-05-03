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
 * - Implementation section (## Implementação or ## Implementation)
 * - Patch section (## Patch) with unified diff
 * - Result: PATCH_PROPOSED
 */
function validateExecutorOutput(output: string): OutputContractResult {
  const lowerOutput = output.toLowerCase();
  
  // Check for tool-mode attempts (executor trying to read files instead of using provided context)
  const toolModePatterns = [
    "let me read",
    "i'll read",
    "i will read",
    "i need to inspect",
    "i will check the files",
    "let me check",
    "vou ler",
    "vou verificar",
    "preciso ler",
    "preciso verificar"
  ];
  
  const hasToolModeAttempt = toolModePatterns.some(pattern => 
    lowerOutput.includes(pattern)
  );
  
  if (hasToolModeAttempt && output.length < 1000) {
    return {
      valid: false,
      reason: "EXECUTOR_ATTEMPTED_TOOL_MODE: Patch-Based Executor must not request to read files. All required file context is provided in the Executor Context Pack. If context is insufficient, return BLOCKED with list of missing files.",
      missingElements: ["Patch using provided context"]
    };
  }
  
  // Check for implementation section
  const hasImplementation = 
    lowerOutput.includes("## implementação") ||
    lowerOutput.includes("## implementation") ||
    lowerOutput.includes("## execução");
  
  if (!hasImplementation) {
    return {
      valid: false,
      reason: "Missing implementation section (## Implementação or ## Implementation)",
      missingElements: ["Implementation section"]
    };
  }
  
  // Check for patch section
  const hasPatchSection = 
    lowerOutput.includes("## patch");
  
  if (!hasPatchSection) {
    return {
      valid: false,
      reason: "Missing patch section (## Patch)",
      missingElements: ["Patch section"]
    };
  }
  
  // Check for unified diff markers
  const hasUnifiedDiff = 
    output.includes("diff --git") ||
    (output.includes("---") && output.includes("+++") && output.includes("@@"));
  
  if (!hasUnifiedDiff) {
    return {
      valid: false,
      reason: "Missing unified diff patch (must contain 'diff --git' or unified diff markers)",
      missingElements: ["Unified diff"]
    };
  }
  
  // Check for result
  const hasResult = 
    lowerOutput.includes("patch_proposed") ||
    lowerOutput.includes("resultado") ||
    lowerOutput.includes("result");
  
  if (!hasResult) {
    return {
      valid: false,
      reason: "Missing result section (## Resultado with PATCH_PROPOSED)",
      missingElements: ["Result section"]
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
