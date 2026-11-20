import { NextResponse } from "next/server";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { createCapabilityChallenge } from "@/lib/playground/capabilityTools.js";
import { runCapabilityToolLoop } from "@/lib/playground/agentLoop.js";

// Server-only, opt-in, read-only capability-test agent route.
//
// The route wires the already-tested pure modules (`capabilityTools.js` and
// `agentLoop.js`) to the existing chat pipeline. It adds no auth of its own:
// the site middleware `src/dashboardGuard.js` is deny-by-default for `/api/*`,
// so a request that reaches this handler is already dashboard-authenticated.
//
// `capabilityTools.js` uses `node:crypto`, so this cannot run on the edge.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Copied verbatim from src/app/api/v1/chat/completions/route.js: initialise the
// translator registry once per process.
let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

const VALID_ROLES = new Set(["system", "user", "assistant"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validationError(message) {
  return NextResponse.json({ error: message }, { status: 400 });
}

// A typed error carrying only the upstream HTTP status. No upstream body,
// message, or header is ever attached, so nothing sensitive can propagate.
function upstreamError(status) {
  const error = new Error("upstream_error");
  error.status = typeof status === "number" ? status : 0;
  return error;
}

// Thin wrapper around the existing chat pipeline. The Playground's optional
// API-key field is forwarded verbatim as the Authorization header because
// handleChat enforces settings.requireApiKey internally.
async function callChatPipeline(body, callerAuth) {
  const synthesized = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(callerAuth ? { authorization: callerAuth } : {}),
    },
    body: JSON.stringify(body),
  });

  const res = await handleChat(synthesized);
  if (!res || !res.ok) {
    throw upstreamError(res ? res.status : 0);
  }
  return await res.json();
}

function errorBody(error, status) {
  // Fixed, self-authored strings only. No upstream-derived string is ever
  // placed in the body, so the 300-character cap is satisfied trivially and
  // no stack trace, header value, env value, or caller key can leak.
  return NextResponse.json({ error, verdict: "ERROR", trace: [] }, { status });
}

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  if (!payload || !isNonEmptyString(payload.model)) {
    return validationError("model is required");
  }
  if (!Array.isArray(payload.messages)) {
    return validationError("messages must be an array");
  }
  for (const entry of payload.messages) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof entry.role !== "string" ||
      !VALID_ROLES.has(entry.role)
    ) {
      return validationError("invalid message entry");
    }
  }
  if (payload.capabilityTest !== true) {
    return validationError("capabilityTest must be true");
  }

  const { model, messages: clientMessages } = payload;
  const callerAuth = request.headers.get("authorization") || null;

  await ensureInitialized();

  const challenge = createCapabilityChallenge();
  // Preserve the client's own context; append the challenge instruction last.
  const requestMessages = [...clientMessages, { role: "user", content: challenge.prompt }];

  // The loop runner swallows `complete` failures and resolves with
  // verdict "ERROR", so the upstream status is captured here to drive the
  // HTTP mapping afterwards.
  let upstreamFailure = false;
  let upstreamStatus = null;

  const complete = async (body) => {
    try {
      return await callChatPipeline(body, callerAuth);
    } catch (error) {
      if (!upstreamFailure) {
        upstreamFailure = true;
        upstreamStatus = typeof error?.status === "number" ? error.status : null;
      }
      throw error;
    }
  };

  let result;
  try {
    result = await runCapabilityToolLoop({
      messages: requestMessages,
      model,
      complete,
      challenge,
    });
  } catch {
    return errorBody("runner_failed", 502);
  }

  if (upstreamFailure) {
    if (upstreamStatus === 401) {
      return errorBody("api_key_required", 401);
    }
    if (upstreamStatus === 429 || (typeof upstreamStatus === "number" && upstreamStatus >= 500)) {
      return errorBody("upstream_unavailable", 502);
    }
    return errorBody("runner_failed", 502);
  }

  return NextResponse.json({
    answer: result.answer,
    verdict: result.verdict,
    trace: result.trace,
    challengeId: challenge.challengeId,
  });
}
