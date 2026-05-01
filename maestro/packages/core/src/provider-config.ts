export interface OpenClaudeProviderConfig {
  executablePath: string;
  executableArgs?: string[];
  workingDirectory: string;
  profileName: string;
  defaultModel: string;
  timeoutMs: number;
  env: Record<string, string>;
  notes?: string;
}

export type ProviderAuthStatus =
  | "NOT_CONFIGURED"
  | "NOT_AUTHORIZED"
  | "AUTHORIZING"
  | "AUTHORIZED"
  | "FAILED"
  | "EXPIRED";

export type ProviderAuthFlowType =
  | "device_code"
  | "manual_interactive"
  | "api_key"
  | "unknown";

export interface ProviderAuthSession {
  id: string;
  provider: "kiro_openclaude" | "openclaude" | "anthropic";
  flowType: ProviderAuthFlowType;
  status: ProviderAuthStatus;
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  startedAt: string;
  expiresAt?: string;
  completedAt?: string;
  errorMessage?: string;
  rawOutputPath?: string;
}

export interface ProviderDoctorResult {
  provider: string;
  status: "READY" | "BLOCKED" | "ERROR";
  checks: ProviderCheck[];
  summary: string;
}

export interface ProviderCheck {
  id: string;
  label: string;
  status: "OK" | "WARN" | "ERROR" | "SKIP";
  message: string;
  details?: string;
}

export interface ProviderDiscoveryResult {
  provider: string;
  timestamp: string;
  status: "SUCCESS" | "FAILED";
  helpOutput?: string;
  versionOutput?: string;
  error?: string;
  reportPath?: string;
}
