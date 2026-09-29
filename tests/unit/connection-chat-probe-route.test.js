import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  probeConnectionChat: vi.fn(),
}));

vi.mock("@/lib/network/connectionChatProbe", () => ({
  probeConnectionChat: mocks.probeConnectionChat,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

describe("connection chat probe route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("probes only the requested connection and model", async () => {
    mocks.probeConnectionChat.mockResolvedValue({
      valid: true,
      status: 200,
      connectionId: "connection-1",
      model: "mimo-v2.5:free",
      proxyPoolId: "pool-1",
      strictProxy: true,
    });
    const { POST } = await import("../../src/app/api/internal/connection-probe/[id]/route.js");
    const request = new Request("http://localhost/api/internal/connection-probe/connection-1", {
      method: "POST",
      body: JSON.stringify({ model: "mimo-v2.5:free" }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "connection-1" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ valid: true, connectionId: "connection-1", strictProxy: true });
    expect(mocks.probeConnectionChat).toHaveBeenCalledWith("connection-1", "mimo-v2.5:free");
  });

  it("rejects an empty model before probing", async () => {
    const { POST } = await import("../../src/app/api/internal/connection-probe/[id]/route.js");
    const request = new Request("http://localhost/api/internal/connection-probe/connection-1", {
      method: "POST",
      body: JSON.stringify({ model: " " }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "connection-1" }) });

    expect(response.status).toBe(400);
    expect(mocks.probeConnectionChat).not.toHaveBeenCalled();
  });

  it("does not reveal the upstream proxy target in an error", async () => {
    mocks.probeConnectionChat.mockRejectedValue(new Error("proxy https://secret.invalid failed"));
    const { POST } = await import("../../src/app/api/internal/connection-probe/[id]/route.js");
    const request = new Request("http://localhost/api/internal/connection-probe/connection-1", {
      method: "POST",
      body: JSON.stringify({ model: "mimo-v2.5:free" }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "connection-1" }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Connection probe failed" });
  });
});
