// Tests for the Phase 1 deterministic capability-test tool loop.
// Read-only, in-process, no network, no model calls.
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_TOOLS,
  createCapabilityChallenge,
  executeCapabilityTool,
} from "../../src/lib/playground/capabilityTools.js";

describe("CAPABILITY_TOOLS", () => {
  it("exposes exactly the two expected tools, in order", () => {
    expect(CAPABILITY_TOOLS).toHaveLength(2);
    expect(CAPABILITY_TOOLS.map((tool) => tool.function.name)).toEqual([
      "lookup_capability_fixture",
      "get_capability_status",
    ]);
    for (const tool of CAPABILITY_TOOLS) {
      expect(tool.type).toBe("function");
    }
  });

  it("declares strict object schemas with a required array", () => {
    for (const tool of CAPABILITY_TOOLS) {
      expect(tool.function.parameters.additionalProperties).toBe(false);
      expect(Array.isArray(tool.function.parameters.required)).toBe(true);
    }
  });
});

describe("createCapabilityChallenge", () => {
  it("issues a challenge id, a 12-char uppercase hex code, and a prompt", () => {
    const challenge = createCapabilityChallenge();

    expect(challenge.challengeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(challenge.verificationCode).toMatch(/^[0-9A-F]{12}$/);
    expect(typeof challenge.prompt).toBe("string");
    expect(challenge.prompt).toContain(challenge.challengeId);
    expect(challenge.prompt).not.toContain(challenge.verificationCode);
  });

  it("generates a different challenge id on each call", () => {
    const first = createCapabilityChallenge();
    const second = createCapabilityChallenge();
    expect(first.challengeId).not.toBe(second.challengeId);
  });
});

describe("executeCapabilityTool", () => {
  it("returns the verification code for the issued challenge id", () => {
    const challenge = createCapabilityChallenge();
    const result = executeCapabilityTool(
      "lookup_capability_fixture",
      JSON.stringify({ challenge_id: challenge.challengeId }),
      challenge,
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain(challenge.verificationCode);
  });

  it("does not leak the host HOME value", () => {
    const challenge = createCapabilityChallenge();
    const result = executeCapabilityTool(
      "lookup_capability_fixture",
      JSON.stringify({ challenge_id: challenge.challengeId }),
      challenge,
    );

    expect(result.ok).toBe(true);
    const home = process.env.HOME;
    if (home) {
      expect(result.content).not.toContain(home);
    }
  });

  it("rejects an unknown tool name", () => {
    const challenge = createCapabilityChallenge();
    const result = executeCapabilityTool("no_such_tool", "{}", challenge);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown_tool");
  });

  it("rejects malformed JSON", () => {
    const challenge = createCapabilityChallenge();
    const result = executeCapabilityTool("lookup_capability_fixture", "{", challenge);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_json");
  });

  it("rejects extra and missing argument keys", () => {
    const challenge = createCapabilityChallenge();

    const extra = executeCapabilityTool(
      "lookup_capability_fixture",
      JSON.stringify({ challenge_id: challenge.challengeId, extra: true }),
      challenge,
    );
    expect(extra.ok).toBe(false);
    expect(extra.error).toBe("invalid_arguments");

    const missing = executeCapabilityTool(
      "lookup_capability_fixture",
      JSON.stringify({}),
      challenge,
    );
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("invalid_arguments");
  });

  it("rejects a wrong-but-string challenge id", () => {
    const challenge = createCapabilityChallenge();
    const result = executeCapabilityTool(
      "lookup_capability_fixture",
      JSON.stringify({ challenge_id: "00000000-0000-0000-0000-000000000000" }),
      challenge,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("challenge_mismatch");
  });

  it("resolves the fixed capability status key only", () => {
    const challenge = createCapabilityChallenge();

    const ready = executeCapabilityTool(
      "get_capability_status",
      JSON.stringify({ key: "tool_loop" }),
      challenge,
    );
    expect(ready.ok).toBe(true);
    expect(ready.content).toContain("tool_loop");

    const other = executeCapabilityTool(
      "get_capability_status",
      JSON.stringify({ key: "other" }),
      challenge,
    );
    expect(other.ok).toBe(false);
  });

  it("never throws for a fuzz set of bad inputs", () => {
    const challenge = createCapabilityChallenge();
    const fuzzInputs = [
      undefined,
      null,
      42,
      "",
      "{",
      "}{",
      "[]",
      "[1,2,3]",
      '"just-a-string"',
      "null",
      "42",
      JSON.stringify({ challenge_id: [1, 2] }),
      JSON.stringify({ challenge_id: { nested: { deep: true } } }),
      JSON.stringify([{ challenge_id: challenge.challengeId }]),
    ];

    for (const input of fuzzInputs) {
      expect(() =>
        executeCapabilityTool("lookup_capability_fixture", input, challenge),
      ).not.toThrow();
      const result = executeCapabilityTool("lookup_capability_fixture", input, challenge);
      expect(result.ok).toBe(false);
      expect(typeof result.content).toBe("string");
    }
  });
});
