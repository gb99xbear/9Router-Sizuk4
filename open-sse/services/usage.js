/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getGitHubUsage } from "./usage/github.js";
import { getGeminiUsage, getAntigravityUsage } from "./usage/google.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage, consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex.js";

export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits };
import { getKiroUsage } from "./usage/kiro.js";
import { getMiniMaxUsage } from "./usage/minimax.js";
import { getCodeBuddyCnUsage, getCodeBuddyIntlUsage } from "./usage/codebuddy-cn.js";
import { getGrokCliUsage } from "./usage/grok-cli.js";
import { getKimiUsage } from "./usage/kimi.js";
import { getDeepseekUsage } from "./usage/deepseek.js";
import { getFreebuffUsage } from "./usage/freebuff.js";
import { getGroqUsage } from "./usage/groq.js";
import { getZedUsage } from "./usage/zed.js";
import { resolveQoderCredentials } from "./qoderModels.js";
import { getGlmUsage } from "./usage/glm.js";
import {
  getIflowUsage,
  getOllamaUsage,
  getVercelAiGatewayUsage,
  getQoderUsage,
} from "./usage/misc.js";

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
// provider → usage handler (ctx carries every arg each handler needs)
const USAGE_HANDLERS = {
  github: (c) => getGitHubUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  "gemini-cli": (c) => getGeminiUsage(c.accessToken, c.providerDataWithProjectId, c.proxyOptions),
  antigravity: async (c) => {
    // Quota comes from the local ag-adapter (it holds the real CLI fingerprint
    // and the account pool), so 9Router never opens a second identity against
    // Google for Antigravity quota. The provider id stays "antigravity" so the
    // dashboard's existing antigravity quota parser renders the card.
    const email = c.providerSpecificData?.email;
    const base = c.providerSpecificData?.adapterUrl || "http://127.0.0.1:8792";
    const url = `${base}/v1/quota${email ? `?email=${encodeURIComponent(email)}` : ""}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${c.apiKey || ""}` },
        cache: "no-store",
      });
      if (!res.ok) return { message: `ag-adapter quota HTTP ${res.status}` };
      return await res.json();
    } catch (e) {
      return { message: `ag-adapter unreachable: ${e.message}` };
    }
  },
  claude: (c) => getClaudeUsage(c.accessToken, c.proxyOptions, { force: c.force }),
  codex: (c) => getCodexUsage(c.accessToken, c.proxyOptions),
  kiro: (c) => getKiroUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  qoder: async (c) => {
    // PAT (pt-...) connections must be exchanged to a job token before the
    // quota endpoint accepts them.
    const resolved = await resolveQoderCredentials(c, c.proxyOptions).catch(() => null);
    return getQoderUsage(resolved?.accessToken || c.accessToken, c.proxyOptions);
  },
  iflow: (c) => getIflowUsage(c.accessToken),
  ollama: (c) => getOllamaUsage(c.apiKey, c.providerSpecificData, c.proxyOptions),
  glm: (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "glm-cn": (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  minimax: (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "minimax-cn": (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "vercel-ai-gateway": (c) => getVercelAiGatewayUsage(c.apiKey, c.proxyOptions),
  "codebuddy-cn": (c) => getCodeBuddyCnUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  "codebuddy-intl": (c) => getCodeBuddyIntlUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  "grok-cli": (c) => getGrokCliUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  kimi: (c) => getKimiUsage(c.accessToken, c.apiKey, c.proxyOptions, c.providerSpecificData),
  deepseek: (c) => getDeepseekUsage(c.apiKey, c.proxyOptions),
  freebuff: (c) => getFreebuffUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  groq: (c) => getGroqUsage(c.apiKey, c.proxyOptions),
  zed: (c) => getZedUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
};

export async function getUsageForProvider(connection, proxyOptions = null, options = {}) {
  const { provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({
    provider,
    accessToken,
    apiKey,
    providerSpecificData,
    providerDataWithProjectId,
    proxyOptions,
    force: options.force === true,
  });
}
