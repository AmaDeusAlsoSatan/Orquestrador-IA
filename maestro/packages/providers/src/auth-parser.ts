/**
 * Parser for device code authorization output
 * 
 * Supports multiple formats:
 * - AWS SSO format: "YOUR CODE XXXX-XXXX" with URL
 * - Standard OAuth format: "user_code=XXXX" with "verification_uri=..."
 * - JSON format: {"user_code": "...", "verification_uri": "..."}
 */

export interface DeviceCodeAuthInfo {
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  deviceCode?: string;
  expiresIn?: number;
  interval?: number;
}

/**
 * Parse device code authorization output from various formats
 */
export function parseDeviceCodeAuthOutput(output: string): DeviceCodeAuthInfo {
  const result: DeviceCodeAuthInfo = {};

  // Try JSON format first
  try {
    const json = JSON.parse(output);
    if (json.user_code || json.userCode) {
      result.userCode = json.user_code || json.userCode;
    }
    if (json.verification_uri || json.verificationUri) {
      result.verificationUri = json.verification_uri || json.verificationUri;
    }
    if (json.verification_uri_complete || json.verificationUriComplete) {
      result.verificationUriComplete = json.verification_uri_complete || json.verificationUriComplete;
    }
    if (json.device_code || json.deviceCode) {
      result.deviceCode = json.device_code || json.deviceCode;
    }
    if (json.expires_in || json.expiresIn) {
      result.expiresIn = json.expires_in || json.expiresIn;
    }
    if (json.interval) {
      result.interval = json.interval;
    }
    return result;
  } catch {
    // Not JSON, continue with text parsing
  }

  // AWS SSO format: "YOUR CODE XXXX-XXXX"
  const awsCodeMatch = output.match(/YOUR\s+CODE[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/i);
  if (awsCodeMatch) {
    result.userCode = awsCodeMatch[1];
  }

  // Standard format: "user_code=XXXX" or "User code: XXXX"
  const userCodeMatch = output.match(/user[_\s]code[:\s=]+([A-Z0-9-]+)/i);
  if (userCodeMatch && !result.userCode) {
    result.userCode = userCodeMatch[1];
  }

  // Device code: "device_code=XXXX"
  const deviceCodeMatch = output.match(/device[_\s]code[:\s=]+([A-Za-z0-9_-]+)/i);
  if (deviceCodeMatch) {
    result.deviceCode = deviceCodeMatch[1];
  }

  // AWS SSO URL format
  const awsUrlMatch = output.match(/(https:\/\/view\.awsapps\.com\/start\/#\/device\?user_code=[A-Z0-9-]+)/i);
  if (awsUrlMatch) {
    result.verificationUriComplete = awsUrlMatch[1];
    // Extract base URL
    result.verificationUri = "https://view.awsapps.com/start";
  }

  // Standard verification URI
  const verificationUriMatch = output.match(/verification[_\s]uri[:\s=]+(https?:\/\/[^\s]+)/i);
  if (verificationUriMatch && !result.verificationUri) {
    result.verificationUri = verificationUriMatch[1];
  }

  // Complete verification URI
  const verificationUriCompleteMatch = output.match(/verification[_\s]uri[_\s]complete[:\s=]+(https?:\/\/[^\s]+)/i);
  if (verificationUriCompleteMatch) {
    result.verificationUriComplete = verificationUriCompleteMatch[1];
  }

  // Expires in (seconds)
  const expiresInMatch = output.match(/expires[_\s]in[:\s=]+(\d+)/i);
  if (expiresInMatch) {
    result.expiresIn = parseInt(expiresInMatch[1], 10);
  }

  // Polling interval (seconds)
  const intervalMatch = output.match(/interval[:\s=]+(\d+)/i);
  if (intervalMatch) {
    result.interval = parseInt(intervalMatch[1], 10);
  }

  return result;
}

/**
 * Check if device code auth info is complete enough to display to user
 */
export function isDeviceCodeAuthComplete(info: DeviceCodeAuthInfo): boolean {
  return !!(info.userCode && (info.verificationUri || info.verificationUriComplete));
}

/**
 * Format device code auth info for display
 */
export function formatDeviceCodeAuthInfo(info: DeviceCodeAuthInfo): string {
  const lines: string[] = [];

  if (info.userCode) {
    lines.push(`Your code: ${info.userCode}`);
  }

  if (info.verificationUriComplete) {
    lines.push(`Authorization URL: ${info.verificationUriComplete}`);
  } else if (info.verificationUri) {
    lines.push(`Authorization URL: ${info.verificationUri}`);
  }

  if (info.expiresIn) {
    const minutes = Math.floor(info.expiresIn / 60);
    lines.push(`Expires in: ${minutes} minutes`);
  }

  return lines.join("\n");
}
