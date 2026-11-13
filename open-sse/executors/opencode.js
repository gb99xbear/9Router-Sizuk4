import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import crypto from "crypto";
import { resolveSessionId } from "../utils/sessionManager.js";

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function unstableRandomBase62(len) {
  let result = "";
  for (let i = 0; i < len; i++) {
    result += BASE62_CHARS[Math.floor(Math.random() * 62)];
  }
  return result;
}

let lastTimestamp = 0;
let sessionCounter = 0;

function generateSessionId() {
  const now = Date.now();
  if (now !== lastTimestamp) {
    lastTimestamp = now;
    sessionCounter = 0;
  }
  sessionCounter++;
  const counter = sessionCounter;

  const current = BigInt(now) * 0x1000n + BigInt(counter & 0xfff);
  const value = ~current;
  const timeBuf = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    timeBuf[i] = Number((value >> BigInt(40 - 8 * i)) & 0xffn);
  }
  return "ses_" + timeBuf.toString("hex") + unstableRandomBase62(14);
}

function generateRequestId() {
  const now = Date.now();
  const current = BigInt(now) * 0x1000n + 1n;
  const timeBuf = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    timeBuf[i] = Number((current >> BigInt(40 - 8 * i)) & 0xffn);
  }
  return "msg_" + timeBuf.toString("hex") + unstableRandomBase62(14);
}

function hasValidOpenCodeVersion(ua) {
  const match = String(ua || "").match(/opencode\/([0-9]+)\.([0-9]+)/i);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return major > 1 || (major === 1 && minor >= 17);
}

function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function normalizeOpencodeReasoning(model, body) {
  if (body?.reasoning_effort === "auto") delete body.reasoning_effort;
}

const OPENCODE_FAST_FAIL_MS = 1000;

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model, body, stream = false) {
    const cleanModel = baseModelId(model);
    body = { ...body, model: cleanModel, stream };
    delete body.max_completion_tokens;
    normalizeOpencodeReasoning(model, body);
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    // Halakan terus ke sidecar Bun port 8789 yang ada proksi FloppyData residential
    return "http://127.0.0.1:8090/v1/chat/completions";
  }

  buildHeaders(credentials, stream = true, url = null, model = null) {
    const lower = {};
    if (credentials?.rawHeaders) {
      for (const [k, v] of Object.entries(credentials.rawHeaders)) {
        lower[k.toLowerCase()] = v;
      }
    }

    const downstreamUa = lower["user-agent"] || "";
    const ua = hasValidOpenCodeVersion(downstreamUa)
      ? downstreamUa
      : "opencode/1.19.4 darwin/arm64";

    // Jana session segar bagi setiap request untuk elak had quota berkongsi
    const session = generateSessionId();

    const headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer local-test-key",
      "User-Agent": ua,
      "x-opencode-client": "desktop",
      "x-opencode-session": session,
      "x-opencode-request": generateRequestId(),
      "x-opencode-project": "global",
      "Accept": stream ? "text/event-stream" : "*/*",
    };

    return headers;
  }

  parseError(response, bodyText) {
    const status = response?.status || 0;
    const text = String(bodyText || "");
    return {
      status,
      message: text,
      resetsAtMs: OPENCODE_FAST_FAIL_MS
    };
  }
}
