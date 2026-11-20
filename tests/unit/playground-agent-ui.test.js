// Unit tests for the Playground capability-test UI helpers (Task 5).
//
// Why the source is loaded with `?raw` instead of a plain `import`:
// PlaygroundClient.js is a React client component and this repo has no React
// test renderer installed, so the brief's approach is to test the pure helper
// exports instead. A plain import is not possible here because Vitest/Vite
// refuses to transform JSX inside a `.js` file ("If you are using JSX, make
// sure to name the file with the .jsx or .tsx extension") and the vitest config
// must not be touched. So the real module source is pulled in verbatim with
// Vite's `?raw` loader, the module-level helper block (everything above the
// component) is evaluated in isolation, and the helper names are asserted to
// exist as real `export function` declarations in that same source.
import { describe, it, expect } from "vitest";
import clientSource from "../../src/app/(dashboard)/dashboard/playground/PlaygroundClient.js?raw";

const SUFFIX = " ... (dipotong)";
const HELPERS = ["verdictColor", "truncateForDisplay", "buildAgentRequest"];

function loadClientHelpers(source) {
  const cut = source.indexOf("export default function PlaygroundClient");
  if (cut === -1) throw new Error("PlaygroundClient default export is missing");
  const head = source.slice(0, cut);
  for (const name of HELPERS) {
    if (!head.includes(`export function ${name}`)) {
      throw new Error(`missing export: ${name}`);
    }
  }
  const body = head
    .replace(/^\s*"use client";?/, "")
    .replace(/^\s*import .*$/gm, "")
    .replace(/export function /g, "function ");
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { ${HELPERS.join(", ")} };`)();
}

const {
  verdictColor,
  truncateForDisplay,
  buildAgentRequest,
} = loadClientHelpers(clientSource);

describe("PlaygroundClient source contract", () => {
  it("still exports a default client component", () => {
    expect(clientSource).toContain('"use client";');
    expect(clientSource).toContain("export default function PlaygroundClient() {");
  });

  it("leaves the legacy Guna Tools checkbox untouched", () => {
    expect(clientSource).toContain("Guna Tools (JSON array)");
    expect(clientSource).toContain('fetch("/v1/chat/completions"');
  });

  it("adds the Agent Tools toggle, helper line and run button copy", () => {
    expect(clientSource).toContain("Agent Tools (uji keupayaan tool, read-only)");
    expect(clientSource).toContain(
      "Hantar 2 tool ujian deterministik. Tiada akses fail, shell, rangkaian atau kredensial.",
    );
    expect(clientSource).toContain("Jalankan Capability Test");
  });

  it("posts the capability test to the agent route without streaming", () => {
    expect(clientSource).toContain('fetch("/api/playground/agent"');
    expect(clientSource).toContain("capabilityTest: true");
  });
});

describe("verdictColor", () => {
  it("maps every known verdict to its exact class string", () => {
    expect(verdictColor("PASS")).toBe("text-green-500");
    expect(verdictColor("PARTIAL")).toBe("text-amber-500");
    expect(verdictColor("FAIL")).toBe("text-red-500");
    expect(verdictColor("ERROR")).toBe("text-red-500");
  });

  it("falls back to a neutral class for an unknown verdict", () => {
    expect(verdictColor("WHATEVER")).toBe("text-text-muted");
    expect(verdictColor("")).toBe("text-text-muted");
    expect(verdictColor(null)).toBe("text-text-muted");
    expect(verdictColor(undefined)).toBe("text-text-muted");
    expect(verdictColor(42)).toBe("text-text-muted");
  });

  it("never leaks inherited Object properties as a colour", () => {
    expect(verdictColor("constructor")).toBe("text-text-muted");
    expect(verdictColor("__proto__")).toBe("text-text-muted");
    expect(verdictColor("toString")).toBe("text-text-muted");
  });

  it("always returns a string", () => {
    for (const verdict of ["PASS", "PARTIAL", "FAIL", "ERROR", "nope", null]) {
      expect(typeof verdictColor(verdict)).toBe("string");
    }
  });
});

describe("truncateForDisplay", () => {
  it("passes a short string through untouched", () => {
    expect(truncateForDisplay("hello")).toEqual({ text: "hello", truncated: false });
  });

  it("does not truncate at 1999 or 2000 characters", () => {
    const at1999 = "a".repeat(1999);
    const at2000 = "a".repeat(2000);
    expect(truncateForDisplay(at1999)).toEqual({ text: at1999, truncated: false });
    expect(truncateForDisplay(at2000)).toEqual({ text: at2000, truncated: false });
  });

  it("truncates at 2001 characters, keeping exactly 2000 plus the suffix", () => {
    const out = truncateForDisplay("a".repeat(2001));
    expect(out.truncated).toBe(true);
    expect(out.text).toBe("a".repeat(2000) + SUFFIX);
    expect(out.text.startsWith("a".repeat(2000))).toBe(true);
    expect(out.text.length).toBe(2000 + SUFFIX.length);
    expect(out.text.endsWith(SUFFIX)).toBe(true);
  });

  it("honours a custom limit", () => {
    expect(truncateForDisplay("abcdef", 3)).toEqual({ text: "abc" + SUFFIX, truncated: true });
    expect(truncateForDisplay("abc", 3)).toEqual({ text: "abc", truncated: false });
  });

  it("stringifies non-string values", () => {
    expect(truncateForDisplay(1234)).toEqual({ text: "1234", truncated: false });
    expect(truncateForDisplay(true)).toEqual({ text: "true", truncated: false });
    expect(truncateForDisplay({ a: 1 })).toEqual({ text: "[object Object]", truncated: false });
  });

  it("survives null, undefined, Symbol, circular objects and BigInt", () => {
    expect(() => truncateForDisplay(null)).not.toThrow();
    expect(truncateForDisplay(null)).toEqual({ text: "null", truncated: false });
    expect(truncateForDisplay(undefined)).toEqual({ text: "undefined", truncated: false });
    expect(truncateForDisplay(Symbol("probe"))).toEqual({ text: "Symbol(probe)", truncated: false });
    expect(truncateForDisplay(10n)).toEqual({ text: "10", truncated: false });

    const circular = { name: "loop" };
    circular.self = circular;
    expect(() => truncateForDisplay(circular)).not.toThrow();
    expect(truncateForDisplay(circular)).toEqual({ text: "[object Object]", truncated: false });
  });

  it("still truncates a long non-string value", () => {
    const out = truncateForDisplay(BigInt("1".repeat(2001)));
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(2000 + SUFFIX.length);
  });
});

describe("buildAgentRequest", () => {
  it("builds the exact capability-test POST body", () => {
    const messages = [{ role: "user", content: "hi" }];
    const body = buildAgentRequest({ model: "kr/x", messages });
    expect(body).toEqual({ model: "kr/x", messages, capabilityTest: true });
    expect(Object.keys(body).sort()).toEqual(["capabilityTest", "messages", "model"]);
    expect(body.messages).toBe(messages);
  });

  it("throws when the model is falsy", () => {
    expect(() => buildAgentRequest({ model: "", messages: [] })).toThrow("model is required");
    expect(() => buildAgentRequest({ model: null, messages: [] })).toThrow("model is required");
    expect(() => buildAgentRequest({ model: undefined })).toThrow("model is required");
    expect(() => buildAgentRequest({})).toThrow("model is required");
    expect(() => buildAgentRequest()).toThrow("model is required");
  });
});
