export default {
  id: "mistral",
  priority: 80,
  alias: "mistral",
  display: {
    name: "Mistral",
    icon: "air",
    color: "#FF7000",
    textIcon: "MI",
    website: "https://mistral.ai",
    notice: {
      apiKeyUrl: "https://console.mistral.ai/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    validateUrl: "https://api.mistral.ai/v1/models",
    quirks: {
      dropClientMetadata: true,
    },
  },
  // List only ids that answer on a free-tier key. mistral-large-latest and
  // mistral-medium-latest return 403 tier_not_allowed / 429, and 9Router pins
  // the connection to the last tested model, which flips every key to
  // isActive=0. Keep the working families listed here.
  models: [
    { id: "codestral-latest", name: "Codestral" },
    { id: "codestral-2508", name: "Codestral 2508" },
    { id: "mistral-code-latest", name: "Mistral Code" },
    { id: "mistral-code-fim-latest", name: "Mistral Code FIM" },
    { id: "ministral-8b-latest", name: "Ministral 8B" },
    { id: "ministral-8b-2512", name: "Ministral 8B 2512" },
    { id: "ministral-3b-latest", name: "Ministral 3B" },
    { id: "ministral-3b-2512", name: "Ministral 3B 2512" },
    { id: "ministral-14b-latest", name: "Ministral 14B" },
    { id: "ministral-14b-2512", name: "Ministral 14B 2512" },
    { id: "open-mistral-nemo", name: "Mistral Nemo" },
    { id: "voxtral-small-latest", name: "Voxtral Small" },
    { id: "voxtral-small-2507", name: "Voxtral Small 2507" },
  ],
  serviceKinds: ["llm","imageToText","embedding"],
  embeddingConfig: { baseUrl: "https://api.mistral.ai/v1/embeddings", authType: "apikey", authHeader: "bearer" },
};
