export default {
  id: "deepseek-web",
  priority: 215,
  alias: "deepseek-web",
  aliases: [
    "ds-web",
    "dsw"
  ],
  uiAlias: "ds-web",
  display: {
    name: "DeepSeek Web",
    icon: "bolt",
    color: "#4D6BFE",
    textIcon: "DSW",
    website: "https://chat.deepseek.com",
    notice: {
      text: "Paste your userToken from chat.deepseek.com. Tokens auto-refresh every 50 minutes.",
      apiKeyUrl: "https://chat.deepseek.com"
    }
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your userToken or accessToken from chat.deepseek.com",
  transport: {
    baseUrl: "https://chat.deepseek.com/api/v0/chat/completion",
    format: "deepseek-web",
    authType: "cookie"
  },
  models: [
    { id: "deepseek-chat", name: "DeepSeek Chat (V3.2 Web Free)" },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1 Thinking Web Free)" },
    { id: "deepseek-web-search", name: "DeepSeek Web + Online Search" }
  ]
};
