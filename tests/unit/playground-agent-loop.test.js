// Tests for the pure bounded capability tool-loop runner.
// Read-only, in-process, no network, no real model: `complete` is a vi.fn().
import { describe, expect, it, vi } from "vitest";
import { runCapabilityToolLoop } from "../../src/lib/playground/agentLoop.js";
import { CAPABILITY_TOOLS, createCapabilityChallenge } from "../../src/lib/playground/capabilityTools.js";

function toolCall(id, name, args) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function completionWithToolCalls(toolCalls) {
  return {
    choices: [
      {
        message: { role: "assistant", content: null, tool_calls: toolCalls },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function completionWithText(content) {
  return {
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

function baseMessages(challenge) {
  return [{ role: "user", content: challenge.prompt }];
}

describe("runCapabilityToolLoop", () => {
  it("PASS - valid lookup then a final answer carrying the verification code", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        completionWithToolCalls([
          toolCall("call_1", "lookup_capability_fixture", { challenge_id: challenge.challengeId }),
        ]),
      )
      .mockResolvedValueOnce(completionWithText(challenge.verificationCode));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "test-model",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("PASS");
    expect(result.answer).toBe(challenge.verificationCode);
    expect(complete).toHaveBeenCalledTimes(2);

    const secondBody = complete.mock.calls[1][0];
    const lastMessage = secondBody.messages[secondBody.messages.length - 1];
    expect(lastMessage).toMatchObject({ role: "tool", tool_call_id: "call_1" });

    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool",
          toolName: "lookup_capability_fixture",
          status: "ok",
        }),
      ]),
    );
  });

  it("sends the exact request-body contract to complete", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi.fn().mockResolvedValueOnce(completionWithText("no tool call, just answering"));

    await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "my-model",
      complete,
      challenge,
    });

    const body = complete.mock.calls[0][0];
    expect(body.model).toBe("my-model");
    expect(body.stream).toBe(false);
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual(CAPABILITY_TOOLS);
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("FAIL - the first completion has no structured tool_calls", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi.fn().mockResolvedValueOnce(completionWithText("I will not call tools."));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("FAIL");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("PARTIAL - a valid lookup but the final answer omits the verification code", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        completionWithToolCalls([
          toolCall("call_1", "lookup_capability_fixture", { challenge_id: challenge.challengeId }),
        ]),
      )
      .mockResolvedValueOnce(completionWithText("All done, ta."));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("PARTIAL");
    expect(result.answer).toBe("All done, ta.");
  });

  it("PARTIAL - a wrong challenge id records an error entry and never passes", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        completionWithToolCalls([
          toolCall("call_1", "lookup_capability_fixture", {
            challenge_id: "00000000-0000-0000-0000-000000000000",
          }),
        ]),
      )
      .mockResolvedValueOnce(completionWithText("ok"));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("PARTIAL");
    expect(result.trace.some((entry) => entry.status === "error")).toBe(true);
  });

  it("ERROR - maxRounds cap reached without a final answer", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi
      .fn()
      .mockResolvedValue(
        completionWithToolCalls([toolCall("call_status", "get_capability_status", { key: "tool_loop" })]),
      );

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
      maxRounds: 2,
    });

    expect(result.verdict).toBe("ERROR");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.trace.some((entry) => entry.detail === "max_rounds_reached")).toBe(true);
  });

  it("ERROR - complete rejects", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("ERROR");
    expect(
      result.trace.some(
        (entry) => entry.detail === "complete_failed" || entry.detail === "empty_completion",
      ),
    ).toBe(true);
  });

  it("ERROR - unusable completion shape", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi.fn().mockResolvedValue({});

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("ERROR");
  });

  it("ERROR - more tool calls than maxToolCallsPerRound", async () => {
    const challenge = createCapabilityChallenge();
    const five = Array.from({ length: 5 }, (_, index) =>
      toolCall(`call_${index}`, "get_capability_status", { key: "tool_loop" }),
    );
    const complete = vi.fn().mockResolvedValueOnce(completionWithToolCalls(five));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
      maxToolCallsPerRound: 4,
    });

    expect(result.verdict).toBe("ERROR");
    expect(result.trace.some((entry) => entry.detail === "tool_calls_limit_exceeded")).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("ERROR - timeout budget exhausted before any complete call", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi.fn().mockResolvedValue(completionWithText("x"));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
      timeoutMs: 0,
    });

    expect(result.verdict).toBe("ERROR");
    expect(result.trace.some((entry) => entry.detail === "timeout")).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it("ERROR - an empty tool_calls array is rejected", async () => {
    const challenge = createCapabilityChallenge();
    const complete = vi.fn().mockResolvedValueOnce(completionWithToolCalls([]));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("ERROR");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("PARTIAL - an empty verificationCode can never yield PASS", async () => {
    const challenge = { challengeId: "id-empty", verificationCode: "" };
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        completionWithToolCalls([
          toolCall("call_1", "lookup_capability_fixture", { challenge_id: "id-empty" }),
        ]),
      )
      .mockResolvedValueOnce(completionWithText("totally wrong text"));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).not.toBe("PASS");
    expect(result.verdict).toBe("PARTIAL");
  });

  it("PARTIAL - an empty verificationCode with an empty final answer", async () => {
    const challenge = { challengeId: "id-empty2", verificationCode: "" };
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        completionWithToolCalls([
          toolCall("call_1", "lookup_capability_fixture", { challenge_id: "id-empty2" }),
        ]),
      )
      .mockResolvedValueOnce(completionWithText(""));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("PARTIAL");
  });

  it("PARTIAL - an absent verificationCode key can never yield PASS", async () => {
    const challenge = { challengeId: "id-absent" };
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        completionWithToolCalls([
          toolCall("call_1", "lookup_capability_fixture", { challenge_id: "id-absent" }),
        ]),
      )
      .mockResolvedValueOnce(completionWithText("arbitrary text that is not a code"));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("PARTIAL");
  });

  it("PARTIAL - a null verificationCode can never yield PASS", async () => {
    const challenge = { challengeId: "id-null", verificationCode: null };
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        completionWithToolCalls([
          toolCall("call_1", "lookup_capability_fixture", { challenge_id: "id-null" }),
        ]),
      )
      .mockResolvedValueOnce(completionWithText("arbitrary text that is not a code"));

    const result = await runCapabilityToolLoop({
      messages: baseMessages(challenge),
      model: "m",
      complete,
      challenge,
    });

    expect(result.verdict).toBe("PARTIAL");
  });
});
