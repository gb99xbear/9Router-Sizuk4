import { describe, it, expect } from "vitest";
import { deltaHasClientContent, isNoRetryFinish } from "../../open-sse/services/emptyFailover.js";

describe("deltaHasClientContent", () => {
  it("counts a non-empty content string", () => {
    expect(deltaHasClientContent({ content: "hi" })).toBe(true);
  });
  it("counts a non-empty content array", () => {
    expect(deltaHasClientContent({ content: [{ type: "text", text: "hi" }] })).toBe(true);
  });
  it("counts tool_calls", () => {
    expect(deltaHasClientContent({ tool_calls: [{ id: "1" }] })).toBe(true);
  });
  it("does NOT count a bare role frame", () => {
    expect(deltaHasClientContent({ role: "assistant" })).toBe(false);
  });
  it("does NOT count reasoning only", () => {
    expect(deltaHasClientContent({ reasoning_content: "thinking..." })).toBe(false);
  });
  it("returns false for null/undefined", () => {
    expect(deltaHasClientContent(null)).toBe(false);
    expect(deltaHasClientContent(undefined)).toBe(false);
  });
});

describe("isNoRetryFinish", () => {
  it("flags content_filter", () => {
    expect(isNoRetryFinish("content_filter")).toBe(true);
  });
  it("flags safety", () => {
    expect(isNoRetryFinish("SAFETY")).toBe(true);
  });
  it("does not flag stop", () => {
    expect(isNoRetryFinish("stop")).toBe(false);
  });
  it("does not flag null", () => {
    expect(isNoRetryFinish(null)).toBe(false);
  });
});

import { inspectSSELine, scanSSEBuffer } from "../../open-sse/services/emptyFailover.js";

describe("inspectSSELine", () => {
  it("detects content in an OpenAI chunk", () => {
    const r = inspectSSELine('data: {"choices":[{"delta":{"content":"hi"}}]}');
    expect(r.content).toBe(true);
  });
  it("ignores a role-only frame", () => {
    const r = inspectSSELine('data: {"choices":[{"delta":{"role":"assistant"}}]}');
    expect(r.content).toBe(false);
  });
  it("captures finish_reason", () => {
    const r = inspectSSELine('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}');
    expect(r.finishReason).toBe("stop");
  });
  it("ignores the [DONE] sentinel", () => {
    const r = inspectSSELine("data: [DONE]");
    expect(r.content).toBe(false);
    expect(r.finishReason).toBe(null);
  });
});

describe("scanSSEBuffer", () => {
  it("latches sawContent and keeps the trailing fragment pending", () => {
    const st = scanSSEBuffer('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: {"choi');
    expect(st.sawContent).toBe(true);
    expect(st.pending.startsWith('data: {"choi')).toBe(true);
  });
  it("reports no content when only role frames arrive", () => {
    const st = scanSSEBuffer('data: {"choices":[{"delta":{"role":"assistant"}}]}\n');
    expect(st.sawContent).toBe(false);
  });
});

import { peekStreamForContent, reconstructStream } from "../../open-sse/services/emptyFailover.js";

function streamOf(chunks) {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
      c.close();
    },
  });
}

describe("peekStreamForContent", () => {
  it("reports content when a content frame arrives", async () => {
    const body = streamOf(['data: {"choices":[{"delta":{"content":"hi"}}]}\n']);
    const r = await peekStreamForContent(body);
    expect(r.outcome).toBe("content");
    expect(r.timedOut).toBe(false);
  });
  it("reports empty when the stream closes with no content", async () => {
    const body = streamOf(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n', "data: [DONE]\n"]);
    const r = await peekStreamForContent(body);
    expect(r.outcome).toBe("empty");
  });
});

describe("reconstructStream", () => {
  it("replays the head then the remaining reader output", async () => {
    const enc = new TextEncoder();
    const head = [enc.encode("AAAA")];
    const src = streamOf(["BBBB"]);
    const reader = src.getReader();
    const rebuilt = reconstructStream(head, reader);
    const text = await new Response(rebuilt).text();
    expect(text).toBe("AAAABBBB");
  });
});

describe("unknown wire shapes pass through (fail-open)", () => {
  it("reports content for a non-OpenAI data stream that closes", async () => {
    const body = streamOf(['data: {"event":"message","content":"hi"}\n', "data: [DONE]\n"]);
    const r = await peekStreamForContent(body);
    expect(r.outcome).toBe("content");
  });
  it("reports content for garbage bytes that are not SSE at all", async () => {
    const body = streamOf(["not-sse garbage\nmore garbage\n"]);
    const r = await peekStreamForContent(body);
    expect(r.outcome).toBe("content");
  });
  it("still reports empty for an OpenAI stream with only a finish frame", async () => {
    const body = streamOf(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n', "data: [DONE]\n"]);
    const r = await peekStreamForContent(body);
    expect(r.outcome).toBe("empty");
    expect(r.finishReason).toBe("stop");
  });
});

describe("inspectSSELine openai flag", () => {
  it("flags choices frames", () => {
    expect(inspectSSELine('data: {"choices":[{"delta":{"role":"assistant"}}]}').openai).toBe(true);
  });
  it("does not flag non-OpenAI payloads", () => {
    expect(inspectSSELine('data: {"event":"message"}').openai).toBe(false);
    expect(inspectSSELine("data: [DONE]").openai).toBe(false);
  });
});
