// Tests for the Phase 1 deterministic capability-test tool loop.
// Read-only, in-process, no network, no model calls.
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_TOOLS,
  createCapabilityChallenge,
  executeCapabilityTool,
  truncateContent,
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

// Fix-round coverage for review findings I1 (cap unreachable/untested) and
// I2 (cap not byte-accurate for multibyte input).
describe("truncateContent", () => {
  it("passes through an ASCII string just under the 12288-byte cap unchanged (I1)", () => {
    const input = "a".repeat(12287);
    expect(Buffer.byteLength(input, "utf8")).toBe(12287);
    expect(truncateContent(input)).toBe(input);
  });

  it("passes through an ASCII string exactly at the 12288-byte cap unchanged (I1)", () => {
    const input = "a".repeat(12288);
    expect(Buffer.byteLength(input, "utf8")).toBe(12288);
    expect(truncateContent(input)).toBe(input);
  });

  it("truncates an over-cap ASCII string to exactly 12288 bytes (I1)", () => {
    const result = truncateContent("a".repeat(20000));
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(12288);
    expect(result.length).toBe(12288);
  });

  it("cuts a 4-byte-character boundary byte-accurately with no U+FFFD (I2)", () => {
    // 4000 x U+1F600, 4 UTF-8 bytes each = 16000 bytes.
    const input = "\u{1F600}".repeat(4000);
    expect(Buffer.byteLength(input, "utf8")).toBe(16000);

    const result = truncateContent(input);

    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(12288);
    // 12288 bytes / 4 bytes per character = 3072 characters retained.
    // Character count is measured in code points: `.length` counts UTF-16 code
    // units, and astral characters occupy 2 of them (3072 chars = 6144 units).
    expect([...result].length).toBe(3072);
    expect(result.length).toBe(6144);
    expect(result.includes("\uFFFD")).toBe(false);
  });

  it("never emits U+FFFD when the boundary splits a 3-byte character (I2)", () => {
    // 12286 ASCII bytes + one 3-byte '€' = 12289 bytes, exactly one over the cap.
    const input = "a".repeat(12286) + "\u20AC";
    expect(Buffer.byteLength(input, "utf8")).toBe(12289);

    const result = truncateContent(input);

    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(12288);
    expect(result.includes("\uFFFD")).toBe(false);
  });

  it("accepts non-string input without throwing and always returns a string (I1)", () => {
    for (const input of [null, 42, undefined]) {
      expect(() => truncateContent(input)).not.toThrow();
      expect(typeof truncateContent(input)).toBe("string");
    }
    expect(truncateContent(null)).toBe("null");
    expect(truncateContent(42)).toBe("42");
    expect(truncateContent(undefined)).toBe("undefined");
  });

  it("caps every tool result content at 12288 bytes (I1)", () => {
    const challenge = createCapabilityChallenge();
    const result = executeCapabilityTool(
      "lookup_capability_fixture",
      JSON.stringify({ challenge_id: challenge.challengeId }),
      challenge,
    );

    expect(result.ok).toBe(true);
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(12288);
  });
});
