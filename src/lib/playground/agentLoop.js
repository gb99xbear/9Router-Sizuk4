import { CAPABILITY_TOOLS, executeCapabilityTool } from "./capabilityTools.js";

// Phase 1 pure capability tool-loop runner.
//
// Design constraints (from the task brief):
// - Pure module: no network, no filesystem, no process spawn, no env secrets,
//   and no imports beyond ./capabilityTools.js.
// - Model access is injected via the `complete` function; this module never
//   creates a client of its own.
// - Hard limits are enforced inside the runner: maxRounds (default 4),
//   maxToolCallsPerRound (default 4), and a total wall-clock timeoutMs budget
//   (default 20000). All three are checked without ever escaping the runner.
// - The runner never throws; it always resolves to { answer, verdict, trace }.

const DEFAULT_MAX_ROUNDS = 4;
const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 4;
const DEFAULT_TIMEOUT_MS = 20000;

const TERMINAL_DETAILS = {
  maxRounds: "max_rounds_reached",
  toolCallsLimit: "tool_calls_limit_exceeded",
  timeout: "timeout",
  emptyCompletion: "empty_completion",
  completeFailed: "complete_failed",
};

function positiveInt(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeInt(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export async function runCapabilityToolLoop(options = {}) {
  const {
    messages,
    model,
    complete,
    challenge,
    maxRounds = DEFAULT_MAX_ROUNDS,
    maxToolCallsPerRound = DEFAULT_MAX_TOOL_CALLS_PER_ROUND,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const trace = [];
  // The runner owns its own copy of the OpenAI-format history; the caller's
  // array is never mutated.
  const protocolMessages = Array.isArray(messages) ? messages.slice() : [];
  let answer = "";

  const verificationCode =
    challenge && typeof challenge.verificationCode === "string" ? challenge.verificationCode : "";

  let sawValidLookup = false;

  try {
    if (typeof complete !== "function") {
      trace.push({
        round: 0,
        type: "error",
        status: "error",
        detail: TERMINAL_DETAILS.completeFailed,
      });
      return { answer, verdict: "ERROR", trace };
    }

    const startedAt = Date.now();
    const roundCap = positiveInt(maxRounds, DEFAULT_MAX_ROUNDS);
    const callCap = nonNegativeInt(maxToolCallsPerRound, DEFAULT_MAX_TOOL_CALLS_PER_ROUND);

    let round = 0;
    for (round = 1; round <= roundCap; round += 1) {
      // 1. Enforce the total wall-clock budget BEFORE calling complete.
      if (Date.now() - startedAt >= timeoutMs) {
        trace.push({ round, type: "error", status: "error", detail: TERMINAL_DETAILS.timeout });
        return { answer, verdict: "ERROR", trace };
      }

      const roundStartedAt = Date.now();
      const body = {
        model,
        messages: protocolMessages.slice(),
        tools: CAPABILITY_TOOLS,
        tool_choice: "auto",
        stream: false,
      };

      let completion;
      try {
        completion = await complete(body);
      } catch {
        trace.push({
          round,
          type: "model",
          status: "error",
          detail: TERMINAL_DETAILS.completeFailed,
          durationMs: Date.now() - roundStartedAt,
        });
        trace.push({
          round,
          type: "error",
          status: "error",
          detail: TERMINAL_DETAILS.completeFailed,
        });
        return { answer, verdict: "ERROR", trace };
      }

      const choice =
        completion && Array.isArray(completion.choices) ? completion.choices[0] : undefined;
      const message = choice && typeof choice === "object" ? choice.message : undefined;
      if (!message || typeof message !== "object") {
        trace.push({
          round,
          type: "model",
          status: "error",
          detail: TERMINAL_DETAILS.emptyCompletion,
          durationMs: Date.now() - roundStartedAt,
        });
        trace.push({
          round,
          type: "error",
          status: "error",
          detail: TERMINAL_DETAILS.emptyCompletion,
        });
        return { answer, verdict: "ERROR", trace };
      }

      trace.push({
        round,
        type: "model",
        status: "ok",
        durationMs: Date.now() - roundStartedAt,
      });

      const toolCalls = message.tool_calls;

      // 3. Append the assistant message, carrying tool_calls when present.
      const assistantMessage = {
        role: typeof message.role === "string" ? message.role : "assistant",
        content: typeof message.content === "string" ? message.content : null,
      };
      if (Array.isArray(toolCalls)) {
        assistantMessage.tool_calls = toolCalls;
      }
      protocolMessages.push(assistantMessage);

      // 5. No (array) tool_calls -> this is the final answer; stop the loop.
      if (!Array.isArray(toolCalls)) {
        answer = typeof message.content === "string" ? message.content : "";
        if (round === 1) {
          // The very first completion answered in plain text without a tool.
          return { answer, verdict: "FAIL", trace };
        }
        if (sawValidLookup && verificationCode.length > 0 && answer.includes(verificationCode)) {
          return { answer, verdict: "PASS", trace };
        }
        return { answer, verdict: "PARTIAL", trace };
      }

      // 4. tool_calls present: guard the empty / over-limit cases first.
      if (toolCalls.length === 0) {
        trace.push({
          round,
          type: "error",
          status: "error",
          detail: TERMINAL_DETAILS.emptyCompletion,
        });
        return { answer, verdict: "ERROR", trace };
      }
      if (toolCalls.length > callCap) {
        trace.push({
          round,
          type: "error",
          status: "error",
          detail: TERMINAL_DETAILS.toolCallsLimit,
        });
        return { answer, verdict: "ERROR", trace };
      }

      for (const call of toolCalls) {
        const callStartedAt = Date.now();
        const fn =
          call && typeof call.function === "object" && call.function !== null
            ? call.function
            : {};
        const toolCallId = call && typeof call.id === "string" ? call.id : undefined;
        const toolName = typeof fn.name === "string" ? fn.name : undefined;
        const argumentsJson = typeof fn.arguments === "string" ? fn.arguments : "{}";

        let result;
        if (typeof toolCallId !== "string" || typeof toolName !== "string") {
          result = { ok: false, content: "", error: "malformed_tool_call" };
        } else {
          try {
            result = executeCapabilityTool(toolName, argumentsJson, challenge);
          } catch {
            result = { ok: false, content: "", error: "tool_execution_error" };
          }
        }

        const ok = !!(result && result.ok === true);
        const contentText = result && typeof result.content === "string" ? result.content : "";
        const errorText = result && typeof result.error === "string" ? result.error : "";
        const toolContent = ok ? contentText : contentText || errorText || "tool_error";

        // Append a tool message for every call, even on failure.
        protocolMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: toolContent,
        });

        const entry = {
          round,
          type: "tool",
          toolName,
          toolCallId,
          arguments: argumentsJson,
          result,
          status: ok ? "ok" : "error",
          durationMs: Date.now() - callStartedAt,
        };
        if (!ok) {
          entry.detail = errorText || "tool_error";
        }
        trace.push(entry);

        if (ok && toolName === "lookup_capability_fixture") {
          sawValidLookup = true;
        }
      }
    }

    // 6. Loop exhausted without ever producing a final answer.
    trace.push({
      round: roundCap,
      type: "error",
      status: "error",
      detail: TERMINAL_DETAILS.maxRounds,
    });
    return { answer, verdict: "ERROR", trace };
  } catch {
    trace.push({ round: 0, type: "error", status: "error", detail: TERMINAL_DETAILS.completeFailed });
    return { answer, verdict: "ERROR", trace };
  }
}

export default runCapabilityToolLoop;
