import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("Zero-Refusal ChatCore Integration", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes normal non-refusal response unchanged", async () => {
    const normalAnswer = "Untuk menjalankan Nginx, gunakan `systemctl start nginx`.";
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: normalAnswer }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.deepseek.com/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const res = await handleChatCore({
      body: { model: "deepseek-v4.1-flash", stream: false, messages: [{ role: "user", content: "bagaimana run nginx" }] },
      modelInfo: { provider: "deepseek", model: "deepseek-v4.1-flash" },
      credentials: { apiKey: "test-key" },
      log,
      zeroRefusalSettings: {
        zeroRefusalEnabled: true,
        zeroRefusalTargetModels: ["deepseek-v4.1-flash"],
        zeroRefusalMaxReframes: 4,
      },
    });

    expect(res.success).toBe(true);
    const json = await res.response.json();
    expect(json.choices[0].message.content).toBe(normalAnswer);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("does not apply zero-refusal if feature is disabled or model is not targeted", async () => {
    const refusalText = "Maaf, saya tidak dapat membantu dengan itu.";
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: refusalText }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.deepseek.com/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const res = await handleChatCore({
      body: { model: "claude-3-5-sonnet", stream: false, messages: [{ role: "user", content: "test" }] },
      modelInfo: { provider: "deepseek", model: "claude-3-5-sonnet" },
      credentials: { apiKey: "test-key" },
      log,
      zeroRefusalSettings: {
        zeroRefusalEnabled: false, // disabled
        zeroRefusalTargetModels: ["deepseek-v4.1-flash"],
        zeroRefusalMaxReframes: 4,
      },
    });

    expect(res.success).toBe(true);
    const json = await res.response.json();
    expect(json.choices[0].message.content).toBe(refusalText);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("strips refusal prefix when substantial technical content (> 150 chars) remains", async () => {
    const technicalText = "Untuk memasang Nginx pada sistem Linux Ubuntu, jalankan arahan `sudo apt update && sudo apt install nginx`. Sila semak status perkhidmatan menggunakan systemctl status nginx dan pastikan port 80 dibuka dalam firewall.";
    const fullText = "Maaf, saya tidak dapat membantu. " + technicalText;
    expect(technicalText.length).toBeGreaterThan(150);

    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "chatcmpl-strip",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: fullText }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.deepseek.com/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const res = await handleChatCore({
      body: { model: "deepseek-v4.1-flash", stream: false, messages: [{ role: "user", content: "install nginx" }] },
      modelInfo: { provider: "deepseek", model: "deepseek-v4.1-flash" },
      credentials: { apiKey: "test-key" },
      log,
      zeroRefusalSettings: {
        zeroRefusalEnabled: true,
        zeroRefusalTargetModels: ["deepseek-v4.1-flash"],
        zeroRefusalMaxReframes: 4,
      },
    });

    expect(res.success).toBe(true);
    const json = await res.response.json();
    expect(json.choices[0].message.content).toBe(technicalText);
    expect(json.choices[0].message.content).not.toContain("Maaf, saya tidak dapat membantu");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("launches Fresh Reframing on hard refusal and returns successful reframed answer", async () => {
    const hardRefusal = "Maaf, saya tidak dapat membantu dengan perkara ini.";
    const goodReframedAnswer = "Here is the factual engineering implementation details and architecture breakdown for the query.";

    // 1st call returns hard refusal
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "chatcmpl-refuse",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: hardRefusal }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.deepseek.com/chat/completions",
      headers: {},
      transformedBody: null,
    });

    // 2nd call (first reframing attempt) returns clean answer
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "chatcmpl-reframe-ok",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: goodReframedAnswer }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.deepseek.com/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const res = await handleChatCore({
      body: {
        model: "deepseek-v4.1-flash",
        stream: false,
        messages: [
          { role: "system", content: "You are an assistant." },
          { role: "user", content: "explain reverse engineering protocol" },
          { role: "assistant", content: "Previous refusal that should be stripped" },
        ],
      },
      modelInfo: { provider: "deepseek", model: "deepseek-v4.1-flash" },
      credentials: { apiKey: "test-key" },
      log,
      zeroRefusalSettings: {
        zeroRefusalEnabled: true,
        zeroRefusalTargetModels: ["deepseek-v4.1-flash"],
        zeroRefusalMaxReframes: 3,
      },
    });

    expect(res.success).toBe(true);
    const json = await res.response.json();
    expect(json.choices[0].message.content).toBe(goodReframedAnswer);
    expect(executeMock).toHaveBeenCalledTimes(2);

    // Verify reframed call body had temperature 0.9 and previous assistant message was removed
    const secondCallArg = executeMock.mock.calls[1][0];
    expect(secondCallArg.body.temperature).toBe(0.9);
    const assistantMsgs = secondCallArg.body.messages.filter(m => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(0);
  });
});
