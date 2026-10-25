import { describe, it, expect } from "vitest";
import { resolveModelPromptEntry } from "../../open-sse/rtk/modelPrompt.js";

describe("resolveModelPromptEntry", () => {
  it("returns chat mode when the entry carries turns", () => {
    const map = { "thk/m": { turns: [{ role: "user", content: "hi" }] } };
    const r = resolveModelPromptEntry({ provider: "p", model: "m", clientModel: "thk/m", map, globalText: "G" });
    expect(r.mode).toBe("chat");
    expect(r.turns).toHaveLength(1);
  });

  it("falls back to single mode for a plain string entry", () => {
    const map = { "thk/m": "PROMPT" };
    const r = resolveModelPromptEntry({ provider: "p", model: "m", clientModel: "thk/m", map, globalText: "G" });
    expect(r.mode).toBe("single");
    expect(r.text).toBe("PROMPT");
  });

  it("falls back to the global text when nothing matches", () => {
    const r = resolveModelPromptEntry({ provider: "p", model: "m", clientModel: "x/y", map: {}, globalText: "GLOBAL" });
    expect(r.mode).toBe("single");
    expect(r.text).toBe("GLOBAL");
  });
});
