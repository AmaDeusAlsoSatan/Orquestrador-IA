export interface OpenClaudeProviderConfig {
  executablePath: string;
  workingDirectory: string;
  profileName: string;
  defaultModel: string;
  timeoutMs: number;
  env: Record<string, string>;
  notes?: string;
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
