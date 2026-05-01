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

export interface OpenClaudeGrouterProviderConfig {
  executablePath: string;
  executableArgs?: string[];
  workingDirectory: string;
  mode: "print";
  provider: "openai";
  baseUrl: string;
  apiKey: string;
  model?: string;
  linkedConnectionId: string;
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
  provider: "kiro_cli" | "kiro_openclaude" | "openclaude" | "anthropic";
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
  email?: string;
  displayName?: string;
  authType?: string;
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

export interface GrouterProviderConfig {
  executablePath: string;
  routerUrl: string;
  dashboardUrl: string;
  provider: string;
  model?: string;
  openClaudeProfile: string;
  dataHome: string;
  allowGlobalStorageReadOnly: boolean;
  linkedConnectionIds: string[];
  strictConnectionAllowlist: boolean;
  notes?: string;
}

export interface GrouterConnectionRef {
  id: string;
  provider: string;
  emailMasked?: string;
  label?: string;
  status?: string;
  modelHints?: string[];
  linkedAt: string;
  allowedRoles?: string[];
}

export interface KiroCliProviderConfig {
  executablePath: string;
  timeoutMs: number;
  trustAllTools: boolean;
  defaultAgent?: string;
  defaultModel?: string;
  allowExistingGlobalAuth: boolean;
  expectedEmail?: string;
  isolationMode: "unknown" | "global" | "isolated";
  notes?: string;
}
