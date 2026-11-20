// Import directly from file to avoid pulling in server-side dependencies via index.js
export {
  PROVIDER_MODELS,
  getProviderModels,
  getDefaultModel,
  isValidModel as isValidModelCore,
  findModelName,
  getModelTargetFormat,
  getModelStrip,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
  getModelUpstreamId,
  getModelQuotaFamily
} from "open-sse/config/providerModels.js";

import { AI_PROVIDERS, isOpenAICompatibleProvider } from "./providers.js";
import { PROVIDER_MODELS as MODELS } from "open-sse/config/providerModels.js";

// Providers that accept any model (passthrough)
const PASSTHROUGH_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.passthroughModels)
    .map(([key]) => key)
);

// Wrap isValidModel with passthrough providers
export function isValidModel(aliasOrId, modelId) {
  if (isOpenAICompatibleProvider(aliasOrId)) return true;
  if (PASSTHROUGH_PROVIDERS.has(aliasOrId)) return true;
  const models = MODELS[aliasOrId];
  if (!models) return false;
  return models.some(m => m.id === modelId);
}

// Legacy AI_MODELS for backward compatibility
export const AI_MODELS = [
  { provider: "kiro", model: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { provider: "kiro", model: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  { provider: "kiro", model: "deepseek-3.2", name: "DeepSeek 3.2" },
  { provider: "kiro", model: "qwen3-coder-next", name: "Qwen3 Coder Next" },
  { provider: "kiro", model: "glm-5", name: "GLM 5" },
  { provider: "kiro", model: "minimax-m2.5", name: "MiniMax M2.5" },
  ...Object.entries(MODELS).flatMap(([alias, models]) =>
    models.map(m => ({ provider: alias, model: m.id, name: m.name }))
  )
];

export const getModelKind = (m, fallback = null) => m?.kind || m?.type || fallback;

// Capacity metadata for UI badges — icon + label + color per capability.
export const CAPACITY_META = {
  vision: { icon: "visibility", label: "Vision", desc: "Supports image input", color: "text-blue-500" },
  // search: temporarily hidden (feature not wired yet)
  reasoning: { icon: "neurology", label: "Reasoning", desc: "Supports reasoning / thinking", color: "text-amber-500" },
};
