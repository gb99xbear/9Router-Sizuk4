import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

describe("probeConnectionChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "connection-1",
      provider: "openai-compatible-chat-tokenharbor-node",
      authType: "apikey",
      apiKey: "test-key",
      isActive: true,
      providerSpecificData: { baseUrl: "https://upstream.invalid/v1", proxyPoolId: "pool-1" },
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      proxyPoolId: "pool-1",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.invalid",
      connectionNoProxy: "",
      strictProxy: true,
    });
    mocks.proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
  });

  it("probes the exact active connection through its strict proxy", async () => {
    const { probeConnectionChat } = await import("../../src/lib/network/connectionChatProbe.js");

    const result = await probeConnectionChat("connection-1", "mimo-v2.5:free");

    expect(result).toEqual({
      valid: true,
      status: 200,
      connectionId: "connection-1",
      model: "mimo-v2.5:free",
      proxyPoolId: "pool-1",
      strictProxy: true,
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://upstream.invalid/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy.invalid",
        strictProxy: true,
        proxyPoolId: "pool-1",
      }),
    );
  });

  it("rejects an inactive connection before any upstream request", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "connection-1", isActive: false });
    const { probeConnectionChat } = await import("../../src/lib/network/connectionChatProbe.js");

    await expect(probeConnectionChat("connection-1", "mimo-v2.5:free")).rejects.toThrow("Connection is inactive");
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });
});
