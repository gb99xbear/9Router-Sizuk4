export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  forceStream: true,
  transport: {
    baseUrl: "http://127.0.0.1:8090/v1",
    headers: {
      "x-opencode-client": "desktop",
      "Authorization": "Bearer local-test-key",
    },
    forceStream: true,
    noAuth: true,
  },
  models: [
    "mimo-v2.6-flash-free",
    "big-pickle",
    "beam-free"
  ],
  serviceKinds: ["llm"],
  passthroughModels: true,
  stallTimeoutMs: 300000,
};
