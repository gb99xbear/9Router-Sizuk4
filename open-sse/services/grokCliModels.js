import {
  GROK_CLI_BASE_URL,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_MODEL,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../config/grokCli.js";
import { refreshProviderCredentials } from "./oauthCredentialManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const MODELS_URL = `${GROK_CLI_BASE_URL}/models`;

const REASONING_EFFORT_VARIANTS = ["high", "medium", "low"];

const STATIC_FALLBACK_MODELS = [
  { id: GROK_CLI_MODEL, name: "Grok Build", contextLength: 500000, maxOutputTokens: 64000 },
  { id: "grok-4.7", name: "Grok 4.7" },
  { id: "grok-4.7-high", name: "Grok 4.7 (High)", upstreamModelId: "grok-4.7" },
  { id: "grok-4.7-medium", name: "Grok 4.7 (Medium)", upstreamModelId: "grok-4.7" },
  { id: "grok-4.7-low", name: "Grok 4.7 (Low)", upstreamModelId: "grok-4.7" },
  { id: "grok-4.5", name: "Grok 4.5" },
  { id: "grok-4.5-high", name: "Grok 4.5 (High)", upstreamModelId: "grok-4.5" },
  { id: "grok-4.5-medium", name: "Grok 4.5 (Medium)", upstreamModelId: "grok-4.5" },
  { id: "grok-4.5-low", name: "Grok 4.5 (Low)", upstreamModelId: "grok-4.5" },
];

function modelEntries(data) {
  const value = Array.isArray(data) ? data : data?.data ?? data?.models ?? data?.results ?? [];
  if (Array.isArray(value)) return value.map((item) => [null, item]);
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

export function parseGrokCliModels(data) {
  const seen = new Set();
  const models = [];

  for (const [key, raw] of modelEntries(data)) {
    const item = typeof raw === "string" ? { id: raw } : raw;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = String(
      item.id ?? item.model_id ?? item.modelId ?? item.model ?? item.slug ?? key ?? item.name ?? "",
    ).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const model = {
      ...item,
      id,
      name: item.display_name ?? item.displayName ?? item.name ?? id,
    };
    const contextLength = Number(
      item.context_length ?? item.contextLength ?? item.context_window ?? item.contextWindow,
    );
    const maxOutputTokens = Number(item.max_output_tokens ?? item.maxOutputTokens);
    if (Number.isFinite(contextLength) && contextLength > 0) model.contextLength = contextLength;
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      model.maxOutputTokens = maxOutputTokens;
    }
    if (id === GROK_CLI_MODEL) {
      model.contextLength ||= 500000;
      model.maxOutputTokens ||= 64000;
    }
    models.push(model);

    // Expand reasoning variants for discovered grok models (e.g. grok-4.7, grok-4.5)
    if (/^grok-4\.(?:5|7)$/.test(id)) {
      for (const effort of REASONING_EFFORT_VARIANTS) {
        const variantId = `${id}-${effort}`;
        if (!seen.has(variantId)) {
          seen.add(variantId);
          const effortLabel = effort.charAt(0).toUpperCase() + effort.slice(1);
          models.push({
            id: variantId,
            name: `${model.name} (${effortLabel})`,
            upstreamModelId: id,
            contextLength: model.contextLength,
            maxOutputTokens: model.maxOutputTokens,
          });
        }
      }
    }
  }

  // Merge static known working variants (grok-4.7, grok-4.5 and their reasoning variants)
  for (const staticModel of STATIC_FALLBACK_MODELS) {
    if (!seen.has(staticModel.id)) {
      seen.add(staticModel.id);
      models.push({ ...staticModel });
    }
  }

  return models;
}

function buildHeaders(accessToken, providerSpecificData = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-mode": "headless",
  };
  const email = providerSpecificData?.email;
  const userId = providerSpecificData?.userId || providerSpecificData?.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

export async function resolveGrokCliModels(credentials, options = {}) {
  const {
    fetchFn = proxyAwareFetch,
    log = console,
    proxyOptions = null,
    onCredentialsRefreshed,
  } = options;
  let accessToken = credentials?.accessToken;
  if (!accessToken) return { models: [], warning: "Grok CLI access token is missing." };

  const request = (token) => fetchFn(
    MODELS_URL,
    {
      method: "GET",
      headers: buildHeaders(token, credentials?.providerSpecificData),
    },
    proxyOptions,
  );

  try {
    let response = await request(accessToken);
    if ((response.status === 401 || response.status === 403) && credentials?.refreshToken) {
      const refreshed = await refreshProviderCredentials(
        "grok-cli",
        credentials,
        log,
        proxyOptions,
      );
      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken;
        try {
          await onCredentialsRefreshed?.(refreshed);
        } catch (error) {
          log?.warn?.("Grok CLI credential persistence failed", error);
        }
        response = await request(accessToken);
      }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        models: parseGrokCliModels([]),
        warning: `Grok CLI model discovery failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }

    const models = parseGrokCliModels(await response.json());
    return models.length
      ? { models }
      : { models: parseGrokCliModels([]), warning: "Grok CLI returned no selectable models." };
  } catch (error) {
    return { models: parseGrokCliModels([]), warning: `Grok CLI model discovery failed: ${error.message}` };
  }
}
