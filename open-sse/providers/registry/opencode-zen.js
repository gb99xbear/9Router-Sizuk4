export default {
  id: "opencode-zen",
  priority: 205,
  alias: "ocz",
  aliases: [
    "opencode-zen",
  ],
  uiAlias: "ocz",
  display: {
    name: "OpenCode Zen",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OZ",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Zen PAYG: pay-as-you-go, key from https://opencode.ai/auth. Same models as Zen: paid + free tiers on the fast lane.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    headers: {},
    usage: {
      url: "https://opencode.ai/zen/v1/usage",
    },
  },
  // Multi-endpoint: pick the transport matching the client sourceFormat to skip
  // translation. Mirrors opencode-go, pointed at /zen/v1 (see https://opencode.ai/docs/zen/).
  transports: [
    { format: "openai", baseUrl: "https://opencode.ai/zen/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://opencode.ai/zen/v1/messages", auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
    { format: "openai-responses", baseUrl: "https://opencode.ai/zen/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  // supportedFormats follow the endpoint table in https://opencode.ai/docs/zen/
  // (live /zen/v1/models, 2026-09-18: 71 ids).
  models: [], hidden: true,
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "https://opencode.ai/zen/v1/systemone",
    headers: {
      "x-opencode-client": "desktop",
      "User-Agent": "opencode/1.18.31",
    },
  },
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
