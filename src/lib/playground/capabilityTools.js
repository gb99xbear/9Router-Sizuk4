import crypto from "node:crypto";

// Phase 1 deterministic capability-test tools.
//
// Design constraints (from the task brief):
// - EXACTLY two in-process, read-only tools.
// - No filesystem, no network, no shell, no process spawn, no env/secret access.
// - Result content is JSON.stringify(...) capped at 12288 bytes (byte-accurate).
// - Node built-in `crypto` only; no new npm dependencies.

const MAX_CONTENT_BYTES = 12288;

const LOOKUP_TOOL = {
  type: "function",
  function: {
    name: "lookup_capability_fixture",
    description: "Return the verification code for the supplied capability-test challenge ID.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { challenge_id: { type: "string" } },
      required: ["challenge_id"],
    },
  },
};

const STATUS_TOOL = {
  type: "function",
  function: {
    name: "get_capability_status",
    description: "Return the status of a named fixed capability-test check.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { key: { type: "string", enum: ["tool_loop"] } },
      required: ["key"],
    },
  },
};

export const CAPABILITY_TOOLS = [LOOKUP_TOOL, STATUS_TOOL];

const LOOKUP_NOTE = "Deterministic capability-test fixture. Read-only and self-contained.";

export function createCapabilityChallenge() {
  const challengeId = crypto.randomUUID();
  const verificationCode = crypto.randomBytes(6).toString("hex").toUpperCase();
  const prompt =
    'Capability check: call the tool "lookup_capability_fixture" exactly once with ' +
    `{"challenge_id":"${challengeId}"}, then reply with the exact "verification_code" ` +
    "value returned by that tool. Do not guess; use only the tool result.";
  return { challengeId, verificationCode, prompt };
}

// Byte-accurate cap. Trims whole code units until the UTF-8 encoding fits within
// `limit`, so the result is never longer than the cap and never contains a
// replacement character from a split multibyte sequence. Terminates in at most
// 4 iterations because one code unit is at most 4 UTF-8 bytes.
export function truncateContent(value, limit = MAX_CONTENT_BYTES) {
  const str = typeof value === "string" ? value : String(value);
  if (Buffer.byteLength(str, "utf8") <= limit) {
    return str;
  }
  let cut = str.slice(0, limit);
  while (Buffer.byteLength(cut, "utf8") > limit) {
    cut = cut.slice(0, -1);
  }
  return cut;
}

function okResult(payload) {
  return { ok: true, content: truncateContent(JSON.stringify(payload)) };
}

function errorResult(error) {
  return { ok: false, content: "", error };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(object, keys) {
  const ownKeys = Object.keys(object);
  if (ownKeys.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(object, key));
}

function handleLookup(args, challenge) {
  if (!hasExactKeys(args, ["challenge_id"])) {
    return errorResult("invalid_arguments");
  }
  const challengeId = args.challenge_id;
  if (typeof challengeId !== "string") {
    return errorResult("invalid_arguments");
  }
  const expectedId = isPlainObject(challenge) ? challenge.challengeId : undefined;
  if (challengeId !== expectedId) {
    return errorResult("challenge_mismatch");
  }
  return okResult({
    challenge_id: challengeId,
    verification_code: challenge.verificationCode,
    note: LOOKUP_NOTE,
  });
}

function handleStatus(args) {
  if (!hasExactKeys(args, ["key"]) || args.key !== "tool_loop") {
    return errorResult("invalid_arguments");
  }
  return okResult({ key: "tool_loop", status: "ready", tool_count: 2 });
}

export function executeCapabilityTool(name, argumentsJson, challenge) {
  try {
    if (name !== "lookup_capability_fixture" && name !== "get_capability_status") {
      return errorResult("unknown_tool");
    }

    let args;
    try {
      args = JSON.parse(argumentsJson);
    } catch {
      return errorResult("invalid_json");
    }

    if (!isPlainObject(args)) {
      return errorResult("invalid_arguments");
    }

    if (name === "lookup_capability_fixture") {
      return handleLookup(args, challenge);
    }
    return handleStatus(args);
  } catch {
    return { ok: false, content: "", error: "internal_error" };
  }
}
