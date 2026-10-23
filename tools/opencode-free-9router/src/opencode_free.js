/**
 * opencode_free.js
 * ---------------------------------------------------------------------------
 * Client for the OpenCode Zen "free tier" gateway (https://opencode.ai/zen).
 *
 * The free models are gated upstream by an attestation that only passes when
 * the request looks like it came from the official OpenCode client. This module
 * reproduces that fingerprint:
 *
 *   - User-Agent:        opencode/<version>            (version >= 1.17, see OPENCODE_VERSION)
 *   - x-opencode-client: desktop
 *   - x-opencode-session: ses_<12 hex><14 base62>      (stable per identity)
 *   - x-opencode-request: msg_<12 hex><14 base62>      (stable per turn)
 *   - Authorization:     Bearer public
 *   - stream: true                                     (non-streaming 403s)
 *   - tools:             bash, glob, grep, read         (fingerprint quartet)
 *
 * Without those a free model answers 403 FreeTierError: "OpenCode's free tier
 * can only be used from within OpenCode".
 *
 * Zero dependencies. Node >= 18 (global fetch + Web streams).
 */

import crypto from "node:crypto";

// Overridable so the adapter can be pointed at the egress rotator
// (which owns the per-IP daily cap problem) instead of opencode.ai directly.
export const ZEN_BASE = process.env.OPENCODE_ZEN_BASE || "https://opencode.ai/zen/v1";

/** Models served by /chat/completions and verified reachable. */
export const CHAT_MODELS = [
  "beam-free",
  "big-pickle",
  "cat-jam-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free",
  "space-bunny-free",
];

/**
 * Models served by the OpenAI Responses API (/responses).
 * Empty right now: the muse-spark contributor models are gone upstream
 * (deprecated / protocol unsupported). Kept as a list so adding one back is a
 * single line.
 */
export const RESPONSES_MODELS = [];

/**
 * Models the gateway still advertises in its catalog but that are not serving
 * requests right now. Kept for documentation and quick re-probing.
 */
export const DEGRADED_MODELS = [
  "exo-free",
  "fledge-alpha-free",
  "ling-3.0-flash-fin-free",
  "ling-3.1-flash-free",
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
  "step-5-preview-free",
];

/**
 * Models on a non-OpenAI protocol (SystemOne). Documented but not proxied
 * because the wire format differs; 9Router handles them natively.
 */
export const EXOTIC_MODELS = ["jev-1.13-free"];

export const ALL_MODELS = [...CHAT_MODELS, ...RESPONSES_MODELS, ...DEGRADED_MODELS];

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPENCODE_VERSION = "1.19.3";
export const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
export const REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

/** The tool names the upstream fingerprint check expects to see declared. */
const FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"];

function randomBase62(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += BASE62[bytes[i] % 62];
  return out;
}

function hexPrefix(prefix, timestamp, invert) {
  let value = BigInt(timestamp) * 0x1000n + 1n;
  if (invert) value = ~value & 0xffffffffffffn;
  let hex = "";
  for (let i = 0; i < 6; i++) {
    hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0");
  }
  return `${prefix}_${hex}`;
}

/** Mint a fresh, structurally valid OpenCode session id. */
export function newSessionId(timestamp = Date.now()) {
  return `${hexPrefix("ses", timestamp, true)}${randomBase62(14)}`;
}

/** Mint a fresh, structurally valid OpenCode request id. */
export function newRequestId(timestamp = Date.now()) {
  return `${hexPrefix("msg", timestamp, false)}${randomBase62(14)}`;
}

/**
 * Derive a stable session id from a downstream identity so free-tier quota is
 * accounted per conversation, not per request (the real CLI reuses one session).
 */
const stableSessions = new Map();
const MAX_STABLE = 1000;

export function stableSessionId(identity = "default") {
  const key = String(identity).slice(0, 128) || "default";
  const existing = stableSessions.get(key);
  if (existing) {
    stableSessions.delete(key);
    stableSessions.set(key, existing);
    return existing;
  }
  const session = newSessionId();
  if (stableSessions.size >= MAX_STABLE) {
    stableSessions.delete(stableSessions.keys().next().value);
  }
  stableSessions.set(key, session);
  return session;
}

/** Derive a deterministic request id from session + last user turn. */
export function deriveRequestId(sessionId, body) {
  const text = lastUserText(body);
  if (!text) return newRequestId();
  const digest = crypto
    .createHash("sha256")
    .update(`opencode-req\0${sessionId || ""}\0${text}`)
    .digest();
  let hex = digest.subarray(0, 6).toString("hex");
  let rest = "";
  for (let i = 6; i < 20; i++) rest += BASE62[digest[i] % 62];
  const id = `msg_${hex}${rest}`;
  return REQUEST_RE.test(id) ? id : newRequestId();
}

function lastUserText(body) {
  const arr = Array.isArray(body?.messages)
    ? body.messages
    : Array.isArray(body?.input)
      ? body.input
      : null;
  if (!arr) return typeof body?.input === "string" ? body.input.slice(-600) : "";
  for (let i = arr.length - 1; i >= 0; i--) {
    const msg = arr[i];
    if (!msg || (msg.role && msg.role !== "user")) continue;
    const content = msg.content;
    if (typeof content === "string" && content.trim()) return content.trim().slice(-600);
    if (Array.isArray(content)) {
      const text = content
        .map((p) => (typeof p === "string" ? p : p?.text || p?.input_text || ""))
        .join(" ")
        .trim();
      if (text) return text.slice(-600);
    }
  }
  return "";
}

function toolName(tool) {
  if (!tool || typeof tool !== "object") return "";
  const fn = tool.function && typeof tool.function === "object" ? tool.function : null;
  return (typeof tool.name === "string" ? tool.name : fn?.name || "").trim();
}

function ensureFingerprintTools(body, responsesShape) {
  const present = new Set(Array.isArray(body.tools) ? body.tools.map(toolName) : []);
  if (!Array.isArray(body.tools)) body.tools = [];
  for (const name of FINGERPRINT_TOOLS) {
    if (present.has(name)) continue;
    body.tools.push(
      responsesShape
        ? {
            type: "function",
            name,
            description: `OpenCode built-in ${name} tool`,
            parameters: { type: "object", properties: {} },
          }
        : {
            type: "function",
            function: {
              name,
              description: `OpenCode built-in ${name} tool`,
              parameters: { type: "object", properties: {} },
            },
          },
    );
    present.add(name);
  }
}

function hasValidVersion(ua) {
  const m = String(ua || "").match(/opencode\/(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return false;
  const major = +m[1];
  const minor = +m[2];
  return major > 1 || (major === 1 && minor >= 17);
}

export function isResponsesModel(model) {
  const base = String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
  return RESPONSES_MODELS.includes(base);
}

/** Build the attested headers for one upstream call. */
export function buildHeaders({
  model,
  body,
  downstreamUa = "",
  downstreamClient = "",
  project = "global",
  stream = true,
  session: sessionOverride = "",
} = {}) {
  // Per-request session rotation (oc-unlimited): a canonical ses_ supplied by
  // the caller is honoured, otherwise every request mints a NEW session so it
  // draws a fresh free-tier quota instead of reusing one exhausted bucket.
  const providedSession = String(sessionOverride || "").trim();
  const session = SESSION_RE.test(providedSession)
    ? providedSession
    : newSessionId();
  const requestId = deriveRequestId(session, body);
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer public",
    "User-Agent": hasValidVersion(downstreamUa) ? downstreamUa : `opencode/${OPENCODE_VERSION}`,
    "x-opencode-client": downstreamClient || "desktop",
    "x-opencode-session": session,
    "x-opencode-request": requestId,
    "x-opencode-project": project,
    Accept: stream ? "text/event-stream" : "*/*",
  };
}

/**
 * Normalise an OpenAI Chat Completions body for the free gateway.
 * Returns a serialisable body with the fingerprint applied.
 */
export function prepareChatBody(model, body) {
  const out = { ...body, model, stream: true };
  if (!Array.isArray(out.messages)) out.messages = [];
  ensureFingerprintTools(out, false);
  return out;
}

/**
 * Normalise a Chat Completions body into the OpenAI Responses shape used by
 * the muse-spark contributor models.
 */
export function prepareResponsesBody(model, body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const input = messages.map((m) => ({
    type: "message",
    role: m.role,
    content: [
      {
        type: m.role === "assistant" ? "output_text" : "input_text",
        text: typeof m.content === "string" ? m.content : extractText(m.content),
      },
    ],
  }));
  if (input.length === 0) {
    input.push({ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] });
  }
  const out = {
    model,
    input,
    stream: true,
    store: false,
    max_output_tokens: body.max_tokens ?? body.max_completion_tokens ?? 4096,
  };
  if (body.reasoning_effort) out.reasoning = { effort: body.reasoning_effort, summary: "auto" };
  ensureFingerprintTools(out, true);
  return out;
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text || p?.input_text || "")).join(" ");
  }
  return "";
}

/** Pick the upstream URL for a model. */
export function endpointFor(model) {
  if (isResponsesModel(model)) return `${ZEN_BASE}/responses`;
  return `${ZEN_BASE}/chat/completions`;
}

/** List models by asking the gateway (no attestation needed for this route). */
export async function listModels({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${ZEN_BASE}/models`, {
    headers: { Authorization: "Bearer public" },
  });
  if (!res.ok) throw new Error(`zen /models -> HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((m) => m.id);
}

/** Return the locally-known working free model ids. */
export function workingModels() {
  return [...CHAT_MODELS, ...RESPONSES_MODELS];
}

/**
 * One non-streaming completion against a free model. Streams upstream (required)
 * and aggregates the SSE into a normal Chat Completion object.
 *
 * @returns {Promise<object>} an OpenAI-shaped chat completion
 */
// A drained free-tier bucket answers 429 for the session that drew it. Every
// attempt below mints its OWN session (see buildHeaders), so an immediate local
// retry lands on a fresh bucket instead of handing a 429 up to the router's
// account ladder (global 30s floor, grows to minutes) which would pin the only
// OpenCode connection for the whole cooldown window.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [200, 500, 1000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function complete(model, body, opts = {}) {
  const { fetchImpl = fetch, timeoutMs = 120_000 } = opts;
  const responses = isResponsesModel(model);
  const prepared = responses ? prepareResponsesBody(model, body) : prepareChatBody(model, body);

  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    const headers = buildHeaders({
      model,
      body,
      downstreamUa: opts.downstreamUa,
      downstreamClient: opts.downstreamClient,
      project: opts.project,
      stream: true,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(endpointFor(model), {
        method: "POST",
        headers,
        body: JSON.stringify(prepared),
        signal: controller.signal,
      });
    } catch (netErr) {
      clearTimeout(timer);
      lastError = netErr;
      if (attempt < RETRY_DELAYS_MS.length) continue;
      throw netErr;
    }
    clearTimeout(timer);

    if (res.ok) {
      return responses ? aggregateResponses(model, res) : aggregateChat(model, res);
    }

    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text).error?.message || text;
    } catch {
      /* keep raw */
    }
    const err = new Error(`opencode free: HTTP ${res.status} ${detail}`.trim());
    err.status = res.status;
    lastError = err;

    // Anything that is not a transient/bucket error is final (e.g. FreeTierError).
    if (!RETRY_STATUSES.has(res.status)) throw err;
  }

  throw lastError || new Error("opencode free: request failed");
}

async function aggregateChat(model, res) {
  const text = await res.text();
  let content = "";
  let reasoning = "";
  let finish = "stop";
  let usage = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta || {};
    content += delta.content || "";
    reasoning += delta.reasoning || delta.reasoning_content || "";
  }
  return {
    id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: content || reasoning || "" },
        finish_reason: finish,
      },
    ],
    usage: usage || undefined,
  };
}

async function aggregateResponses(model, res) {
  const text = await res.text();
  let content = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let ev;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }
    if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
      content += ev.delta;
    } else if (ev.type === "response.completed" && ev.response?.output) {
      for (const item of ev.response.output) {
        for (const part of item.content || []) {
          if (part.type === "output_text" && part.text) content ||= part.text;
        }
      }
    }
  }
  return {
    id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: "assistant", content: content || "" }, finish_reason: "stop" },
    ],
  };
}
