/**
 * Executor Recovery
 * 
 * Classifies executor failures and provides recovery strategies.
 * Inspired by Paperclip's approach to treating execution as a recoverable process.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentInvocation } from "@maestro/core";

export type ExecutorFailureKind =
  | "TOOL_MODE_ATTEMPT"
  | "PATCH_FORMAT_INVALID"
  | "PATCH_SAFETY_FAILED"
  | "PATCH_REPAIR_FAILED"
  | "PATCH_APPLY_CHECK_FAILED"
  | "PATCH_APPLIED_BUILD_FAILED"
  | "MISSING_EXECUTOR_CONTEXT"
  | "PROVIDER_TRANSIENT"
  | "UNKNOWN";

export type RecoveryStrategy =
  | "RETRY_WITH_CONTEXT"
  | "FULL_FILE_REPLACEMENT"
  | "REDUCE_SCOPE"
  | "RETRY_SAME"
  | "NONE";

export interface ExecutorFailureClassification {
  kind: ExecutorFailureKind;
  recoverable: boolean;
  recommendedStrategy: RecoveryStrategy;
  reason: string;
  maxAttempts: number;
}

export interface RecoveryMetadata {
  failureKind: ExecutorFailureKind;
  recoverable: boolean;
  recommendedRecovery: RecoveryStrategy;
  attempt: number;
  maxAttempts: number;
  previousInvocationId: string;
  reason: string;
}

/**
 * Classify executor failure and determine recovery strategy
 */
export function classifyExecutorFailure(
  invocation: AgentInvocation
): ExecutorFailureClassification {
  const errorMessage = invocation.errorMessage || "";
  
  // Tool mode attempt
  if (
    errorMessage.includes("EXECUTOR_ATTEMPTED_TOOL_MODE") ||
    errorMessage.includes("Let me read") ||
    errorMessage.includes("let me read")
  ) {
    return {
      kind: "TOOL_MODE_ATTEMPT",
      recoverable: true,
      recommendedStrategy: "RETRY_WITH_CONTEXT",
      reason: "Executor attempted to read files instead of using context pack",
      maxAttempts: 1
    };
  }
  
  // Patch format invalid (corrupt patch)
  if (
    errorMessage.includes("corrupt patch") ||
    errorMessage.includes("Patch extraction failed")
  ) {
    return {
      kind: "PATCH_FORMAT_INVALID",
      recoverable: true,
      recommendedStrategy: "FULL_FILE_REPLACEMENT",
      reason: "Unified diff is structurally invalid",
      maxAttempts: 1
    };
  }
  
  // Patch safety validation failed
  if (errorMessage.includes("Patch safety validation failed")) {
    return {
      kind: "PATCH_SAFETY_FAILED",
      recoverable: true,
      recommendedStrategy: "FULL_FILE_REPLACEMENT",
      reason: "Patch contains suspicious content - full-file replacement allows validation",
      maxAttempts: 1
    };
  }
  
  // Patch repair failed
  if (
    errorMessage.includes("Patch repair failed") ||
    errorMessage.includes("Repaired patch still")
  ) {
    return {
      kind: "PATCH_REPAIR_FAILED",
      recoverable: true,
      recommendedStrategy: "FULL_FILE_REPLACEMENT",
      reason: "Repair attempt could not fix the patch",
      maxAttempts: 1
    };
  }
  
  // Patch apply check failed (but not corrupt)
  if (
    errorMessage.includes("Patch apply check failed") &&
    !errorMessage.includes("corrupt")
  ) {
    return {
      kind: "PATCH_APPLY_CHECK_FAILED",
      recoverable: true,
      recommendedStrategy: "REDUCE_SCOPE",
      reason: "Patch has conflicts or context mismatch",
      maxAttempts: 1
    };
  }
  
  // Build failed after patch applied
  if (errorMessage.includes("build failed") || errorMessage.includes("BUILD_FAILED")) {
    return {
      kind: "PATCH_APPLIED_BUILD_FAILED",
      recoverable: true,
      recommendedStrategy: "REDUCE_SCOPE",
      reason: "Patch applied but broke the build",
      maxAttempts: 1
    };
  }
  
  // Missing context
  if (errorMessage.includes("EMPTY_AGENT_PROMPT") || errorMessage.includes("No context")) {
    return {
      kind: "MISSING_EXECUTOR_CONTEXT",
      recoverable: false,
      recommendedStrategy: "NONE",
      reason: "Cannot invoke executor without context",
      maxAttempts: 0
    };
  }
  
  // Provider transient errors
  if (
    errorMessage.includes("Input must be provided") ||
    errorMessage.includes("timeout") ||
    errorMessage.includes("empty output") ||
    errorMessage.includes("connection")
  ) {
    return {
      kind: "PROVIDER_TRANSIENT",
      recoverable: true,
      recommendedStrategy: "RETRY_SAME",
      reason: "Transient provider error",
      maxAttempts: 2
    };
  }
  
  // Unknown
  return {
    kind: "UNKNOWN",
    recoverable: false,
    recommendedStrategy: "NONE",
    reason: "Unknown failure type",
    maxAttempts: 0
  };
}

/**
 * Save recovery metadata to invocation directory
 */
export async function saveRecoveryMetadata(
  invocationDir: string,
  metadata: RecoveryMetadata
): Promise<void> {
  const metadataPath = path.join(invocationDir, "00-recovery-metadata.json");
  await fs.writeFile(
    metadataPath,
    JSON.stringify(metadata, null, 2),
    "utf8"
  );
}

/**
 * Load recovery metadata from previous invocation
 */
export async function loadRecoveryMetadata(
  invocationDir: string
): Promise<RecoveryMetadata | null> {
  const metadataPath = path.join(invocationDir, "00-recovery-metadata.json");
  try {
    const content = await fs.readFile(metadataPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Count recovery attempts for a run/role
 */
export async function countRecoveryAttempts(
  runPath: string,
  role: string
): Promise<number> {
  const agentsDir = path.join(runPath, "agents");
  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    let count = 0;
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.includes(role.toLowerCase().replace(/_/g, "-"))) {
        const metadata = await loadRecoveryMetadata(path.join(agentsDir, entry.name));
        if (metadata) {
          count = Math.max(count, metadata.attempt);
        }
      }
    }
    
    return count;
  } catch {
    return 0;
  }
}
