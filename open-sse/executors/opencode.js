import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { isMuseSparkModel } from "../providers/models/helpers.js";

// Official OpenCode fingerprint User-Agent required by upstream (PR #4105)
const DEFAULT_OPENCODE_UA = "opencode/1.18.31";
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const OPENCODE_SESSION_REGEX = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const OPENCODE_REQUEST_REGEX = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const OPENCODE_UA_REGEX = /opencode\/(\d+)\.(\d+)(?:\.(\d+))?/i;

let lastTimestamp = 0;
let sessionCounter = 0;

function unstableRandomBase62(n) {
  const bytes = crypto.randomBytes(n);
  let str = "";
  for (let i = 0; i < n; i++) {
    str += BASE62_CHARS[bytes[i] % 62];
  }
  return str;
}

// Generate canonical 30-char descending OpenCode session ID: ses_ + 12 hex + 14 Base62
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

// Generate canonical 30-char OpenCode request ID: msg_ + 12 hex + 14 Base62
function generateRequestId() {
  const now = Date.now();
  const current = BigInt(now) * 0x1000n + 1n;
  const timeBuf = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    timeBuf[i] = Number((current >> BigInt(40 - 8 * i)) & 0xffn);
  }
  return "msg_" + timeBuf.toString("hex") + unstableRandomBase62(14);
}

function translateOpenCodeSessionId(sessionId, clientTool = "generic") {
  const trimmed = String(sessionId || "").trim();
  if (OPENCODE_SESSION_REGEX.test(trimmed)) {
    return trimmed;
  }
  const tool = clientTool || "generic";
  const hash = crypto.createHash("sha256");
  hash.update(`opencode\0${tool}\0${trimmed}`);
  const digest = hash.digest();
  const timeHex = digest.subarray(0, 6).toString("hex");
  let sb = "";
  for (let i = 6; i < 20; i++) {
    sb += BASE62_CHARS[digest[i] % 62];
  }
  return "ses_" + timeHex + sb;
}

function hasValidOpenCodeVersion(ua) {
  const match = String(ua || "").match(OPENCODE_UA_REGEX);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return major > 1 || (major === 1 && minor >= 17);
}

// Models served by /zen/v1/responses
const RESPONSES_MODELS = new Set([
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);

function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  const base = baseModelId(model);
  return RESPONSES_MODELS.has(base) || isMuseSparkModel(base);
}

function resolveOpencodeSession(body, credentials) {
  const headers = credentials?.rawHeaders || {};
  return resolveSessionId({
    headers,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode",
    generate: generateSessionId,
  });
}

function normalizeOpencodeReasoning(model, body) {
  const current = body.reasoning;
  const currentReasoning = current && typeof current === "object" && !Array.isArray(current)
    ? current
    : null;
  const requestedEffort = typeof body.reasoning_effort === "string"
    ? body.reasoning_effort
    : currentReasoning?.effort;
  if (typeof requestedEffort !== "string") return;

  const cleanModel = baseModelId(model || body.model);
  const supportedLevels = getThinkingLevels("opencode", cleanModel);
  let effort = requestedEffort.toLowerCase().trim();
  if ((effort === "max" || effort === "ultra") && supportedLevels?.length && !supportedLevels.includes(effort)) {
    if (effort === "ultra" && supportedLevels.includes("max")) effort = "max";
    else if (supportedLevels.includes("xhigh")) effort = "xhigh";
  }

  body.reasoning = { ...currentReasoning, effort };
  if (!body.reasoning.summary) body.reasoning.summary = "auto";
  delete body.reasoning_effort;
}

const IP_LIMIT_BODY = /limit|rate|quota|exhausted|capacity|too many|retry|FreeTierError/i;

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
    this._currentSessionId = null;
  }

  transformRequest(model, body, stream, credentials) {
    this._currentSessionId = resolveOpencodeSession(body, credentials);
    if (isResponsesModel(model)) {
      if (body.max_output_tokens === undefined) {
        if (body.max_completion_tokens !== undefined) body.max_output_tokens = body.max_completion_tokens;
        else if (body.max_tokens !== undefined) body.max_output_tokens = body.max_tokens;
      }
      delete body.max_tokens;
      delete body.max_completion_tokens;
      normalizeOpencodeReasoning(model, body);
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    const cleanModel = baseModelId(model);
    if (cleanModel === "union-alpha") {
      return `${base}/zen/v1/messages`;
    }
    return isResponsesModel(model)
      ? `${base}/zen/v1/responses`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true, url = null, model = null) {
    const raw = credentials?.rawHeaders || {};
    const lower = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;

    const downstreamUa = lower["user-agent"] || "";
    const ua = hasValidOpenCodeVersion(downstreamUa) ? downstreamUa : DEFAULT_OPENCODE_UA;

    let session = this._currentSessionId || lower["x-opencode-session"];
    if (session) {
      session = translateOpenCodeSessionId(session);
    } else {
      session = generateSessionId();
    }

    const headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
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
    if ((status === 429 || status === 403) && IP_LIMIT_BODY.test(text)) {
      return {
        status,
        message: text.slice(0, 300) || `OpenCode free limit (${status})`,
        poolScoped: { reason: "ip-limit" },
      };
    }
    return null;
  }
}
