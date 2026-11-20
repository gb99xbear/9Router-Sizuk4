export default {
  id: "opencode-go",
  priority: 210,
  alias: "opencode-go",
  aliases: [
    "ocg",
  ],
  uiAlias: "ocg",
  display: {
    name: "OpenCode Go",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Go subscription: $5/mo (then  0/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    headers: {},
  },
  // Multi-endpoint: pick the transport matching the client sourceFormat to skip
  // translation. Guarded per-model by `supportedFormats` (see chatCore) because
  // opencode-go models differ in endpoint support.
  transports: [
    { format: "openai", baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://opencode.ai/zen/go/v1/messages", auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
    { format: "openai-responses", baseUrl: "https://opencode.ai/zen/go/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  models: [], hidden: true,
};
