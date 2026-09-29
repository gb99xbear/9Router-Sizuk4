export const GROK_CLI_VERSION = "0.2.99";
export const GROK_CLI_MODEL = "grok-build";
export const GROK_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_USER_AGENT = `grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;

export function supportsGrokCliReasoningEffort(model) {
  // Supports reasoning effort for grok-4.5, grok-4.7, and their variants
  return /^grok-4\.(?:5|7)(?:$|-)/.test(String(model || ""));
}
