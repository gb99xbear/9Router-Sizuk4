// Tests for the server-only Playground capability-test agent route.
//
// The chat pipeline, the translator registry, and next/server's NextResponse
// are stubbed; the capability tools and the bounded loop runner under test are
// the real, already-tested modules.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CAPABILITY_TOOLS } from "../../src/lib/playground/capabilityTools.js";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  initTranslators: vi.fn(),
}));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: mocks.initTranslators }));
vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "content-type": "application/json" },
      });
    },
  },
}));

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeRequest(body, headers = {}) {
  return new Request("http://localhost/api/playground/agent", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function loadPOST() {
  const mod = await import("../../src/app/api/playground/agent/route.js");
  return mod.POST;
}

// A stub that accepts the challenge id echoed in the last message, calls the
// lookup tool, then echoes back the verification code returned by the tool.
function compliantModel({ seen = [], bodies = [], auths = [] } = {}) {
  return async (req) => {
    seen.push(new URL(req.url).pathname);
    auths.push(req.headers.get("authorization"));
    const body = await req.json();
    bodies.push(body);
    const toolResult = body.messages.find((m) => m.role === "tool");
    if (!toolResult) {
      const ids = String(body.messages.at(-1).content).match(UUID_RE) || [];
      const challengeId = ids[ids.length - 1];
      return jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "lookup_capability_fixture",
                    arguments: JSON.stringify({ challenge_id: challengeId }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    }
    const { verification_code } = JSON.parse(toolResult.content);
    return jsonResponse({
      choices: [{ message: { role: "assistant", content: verification_code }, finish_reason: "stop" }],
    });
  };
}

describe("POST /api/playground/agent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.initTranslators.mockResolvedValue(undefined);
  });

  it("rejects a missing model", async () => {
    const POST = await loadPOST();
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "model is required" });
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  it("rejects messages that are not an array", async () => {
    const POST = await loadPOST();
    const res = await POST(makeRequest({ model: "kr/x", messages: "bad", capabilityTest: true }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "messages must be an array" });
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  it("rejects an invalid message entry", async () => {
    const POST = await loadPOST();
    const res = await POST(
      makeRequest({
        model: "kr/x",
        messages: [{ role: "nope", content: "x" }],
        capabilityTest: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid message entry" });
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  it("requires capabilityTest === true", async () => {
    const POST = await loadPOST();
    const res = await POST(makeRequest({ model: "kr/x", messages: [], capabilityTest: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "capabilityTest must be true" });
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  it("runs the loop and returns PASS for a compliant model", async () => {
    const seen = [];
    const bodies = [];
    const auths = [];
    mocks.handleChat.mockImplementation(compliantModel({ seen, bodies, auths }));

    const POST = await loadPOST();
    const res = await POST(
      makeRequest({
        model: "kr/x",
        messages: [{ role: "user", content: "hi" }],
        capabilityTest: true,
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verdict).toBe("PASS");
    expect(json.answer).toBeTruthy();
    expect(json.challengeId).toEqual(expect.any(String));
    expect(Array.isArray(json.trace)).toBe(true);

    expect(mocks.handleChat).toHaveBeenCalledTimes(2);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.stream).toBe(false);
      expect(body.tool_choice).toBe("auto");
      expect(body.tools).toEqual(CAPABILITY_TOOLS);
    }
    // No inbound Authorization header -> none is synthesized.
    expect(auths).toEqual([null, null]);
    // The synthesized request targets the OpenAI-format endpoint.
    expect(seen).toEqual(["/v1/chat/completions", "/v1/chat/completions"]);
  });

  it("forwards the caller authorization header to every upstream call", async () => {
    const auths = [];
    mocks.handleChat.mockImplementation(compliantModel({ auths }));

    const POST = await loadPOST();
    const res = await POST(
      makeRequest(
        { model: "kr/x", messages: [], capabilityTest: true },
        { authorization: "Bearer test-key-123" },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verdict: "PASS" });
    expect(mocks.handleChat).toHaveBeenCalledTimes(2);
    expect(auths).toEqual(["Bearer test-key-123", "Bearer test-key-123"]);
  });

  it("maps a 429 upstream failure to 502 without leaking the caller key", async () => {
    mocks.handleChat.mockResolvedValue(new Response("nope", { status: 429 }));

    const POST = await loadPOST();
    const res = await POST(
      makeRequest(
        { model: "kr/x", messages: [], capabilityTest: true },
        { authorization: "Bearer test-key-123" },
      ),
    );

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.verdict).toBe("ERROR");
    const text = JSON.stringify(json);
    expect(text).not.toContain("test-key-123");
    expect(text).not.toContain("at ");
  });

  it("maps an unexpected pipeline error to 502 and never echoes the internal message", async () => {
    mocks.handleChat.mockRejectedValue(new Error("boom at /home/ubuntu/secret/path"));

    const POST = await loadPOST();
    const res = await POST(makeRequest({ model: "kr/x", messages: [], capabilityTest: true }));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.verdict).toBe("ERROR");
    expect(json.error).toBe("runner_failed");
    const text = JSON.stringify(json);
    expect(text).not.toContain("/home/ubuntu");
    expect(text).not.toContain("boom");
  });
});
