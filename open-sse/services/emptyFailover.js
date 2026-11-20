// Detect a streamed completion that finished without ever producing usable
// content, so the combo loop can fall through to the next candidate instead
// of returning a 200 that carries nothing.
//
// The signal is STRUCTURAL, not an enum: "the stream ended and no content
// frame was ever released". That covers MALFORMED_FUNCTION_CALL, any future
// provider abort reason, and a stream that simply dies.

import { OPENAI_FINISH } from "../translator/schema/finishReasons.js";

// Finish reasons where an empty answer is legitimate and would recur on every
// candidate (safety / recitation / blocklist / prohibited content).
const NO_RETRY_EMPTY_FINISH = new Set([
  "content_filter",
  "safety",
  "recitation",
  "blocklist",
  "prohibited_content",
  "prohibited",
]);

// A chunk counts as content only if it carries assistant output the caller can
// consume: a non-empty content string/array, a real tool call, or output_text.
// A bare {role:"assistant"} frame does NOT count (it is emitted on the first
// frame regardless of content), and neither does reasoning.
export function deltaHasClientContent(delta) {
  if (!delta || typeof delta !== "object") return false;
  const c = delta.content;
  if (typeof c === "string" && c.length > 0) return true;
  if (Array.isArray(c) && c.length > 0) return true;
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
  if (typeof delta.output_text === "string" && delta.output_text.length > 0) return true;
  return false;
}

// True when a finished, content-less stream should NOT be retried because the
// emptiness is legitimate and would recur on every candidate.
export function isNoRetryFinish(finishReason) {
  if (!finishReason) return false;
  return NO_RETRY_EMPTY_FINISH.has(String(finishReason).toLowerCase());
}

// Parse one complete SSE line and report whether it carries content and/or a
// finish reason. Non-data lines and the [DONE] sentinel carry nothing.
export function inspectSSELine(line) {
  const trimmed = String(line || "").trimStart();
  if (!trimmed.startsWith("data:")) return { content: false, finishReason: null, openai: false };
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return { content: false, finishReason: null, openai: false };
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { content: false, finishReason: null, openai: false };
  }
  let content = false;
  let finishReason = null;
  const openai = Array.isArray(parsed.choices);
  for (const choice of parsed.choices || []) {
    if (deltaHasClientContent(choice.delta || choice.message || {})) content = true;
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  return { content, finishReason, openai };
}

// Scan the COMPLETE lines of a decoded SSE buffer and update the running
// decision. The trailing fragment (a line still being received) is returned in
// `state.pending` for the caller to prepend to the next chunk. `sawContent`
// latches true.
export function scanSSEBuffer(text, state = { sawContent: false, finishReason: null }) {
  const lines = String(text || "").split("\n");
  state.pending = lines.pop();
  for (const line of lines) {
    const info = inspectSSELine(line);
    if (info.content) state.sawContent = true;
    if (info.openai) state.sawOpenAI = true;
    if (info.finishReason) state.finishReason = info.finishReason;
  }
  return state;
}

// "empty" only when the stream demonstrably speaks OpenAI SSE (a choices[]
// frame was seen) yet never carried client content. Unknown wire shapes
// (kiro eventstream, NDJSON, protobuf...) pass through untouched — fail-open
// on formats this scanner cannot judge.
function decideOutcome(state) {
  if (state.sawContent) return "content";
  return state.sawOpenAI ? "empty" : "content";
}

import { EMPTY_PEEK_DEADLINE_MS } from "../config/runtimeConfig.js";

// Peek a streaming Response body: read frames until the first content frame
// (-> "content"), the stream ends (-> "empty"), or the deadline elapses
// (-> "content", fail-open: never hold a possibly-valid slow stream). Returns
// the buffered head bytes, the live reader, and any still-pending read() so the
// caller can resume without abandoning a chunk.
export async function peekStreamForContent(body, { deadlineMs = EMPTY_PEEK_DEADLINE_MS } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const headChunks = [];
  const state = { sawContent: false, sawOpenAI: false, finishReason: null };
  let textBuf = "";

  const validDeadline =
    Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : EMPTY_PEEK_DEADLINE_MS;
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve("__deadline__"), validDeadline);
  });
  const settle = (ret) => {
    if (timer) { clearTimeout(timer); timer = null; }
    return ret;
  };

  let pendingRead = null;
  while (true) {
    if (!pendingRead) pendingRead = reader.read();
    let res;
    try {
      res = await Promise.race([pendingRead, deadline]);
    } catch (err) {
      pendingRead = null;
      return settle({
        outcome: decideOutcome(state),
        timedOut: false, head: headChunks, reader, pendingRead: null,
        finishReason: state.finishReason, error: err,
      });
    }
    if (res === "__deadline__") {
      return settle({
        outcome: "content", timedOut: true, head: headChunks, reader,
        pendingRead, finishReason: state.finishReason,
      });
    }
    const { done, value } = res;
    pendingRead = null;
    if (done) {
      if (textBuf) scanSSEBuffer(textBuf + "\n", state);
      return settle({
        outcome: decideOutcome(state),
        timedOut: false, head: headChunks, reader, pendingRead: null,
        finishReason: state.finishReason,
      });
    }
    headChunks.push(value);
    textBuf += decoder.decode(value, { stream: true });
    scanSSEBuffer(textBuf, state);
    textBuf = state.pending;
    if (state.sawContent) {
      return settle({
        outcome: "content", timedOut: false, head: headChunks, reader,
        pendingRead: null, finishReason: state.finishReason,
      });
    }
  }
}

// Rebuild a ReadableStream that replays the buffered head bytes, then the
// handed-off in-flight read (if the peek ended on a deadline), then whatever
// remains from the reader. Sequential — only one outstanding read at a time.
export function reconstructStream(head, reader, pendingRead = null) {
  let pending = pendingRead;
  return new ReadableStream({
    start(controller) {
      for (const chunk of head) controller.enqueue(chunk);
    },
    async pull(controller) {
      let result;
      if (pending) { result = await pending; pending = null; }
      else { result = await reader.read(); }
      const { done, value } = result;
      if (done) { controller.close(); return; }
      controller.enqueue(value);
    },
    cancel(reason) {
      try { reader.cancel(reason); } catch { /* already closed */ }
    },
  });
}
