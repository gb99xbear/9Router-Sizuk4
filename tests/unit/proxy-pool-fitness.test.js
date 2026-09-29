import { describe, it, expect, beforeEach } from "vitest";
import {
  markPoolUnfit,
  clearPoolUnfit,
  clearAllPoolUnfit,
  isPoolFit,
  fitPoolIds,
  poolFitnessSnapshot,
  pruneExpired,
  resetPoolFitness,
} from "open-sse/services/proxyPoolFitness.js";
import { pickProxyPoolId } from "../../src/lib/network/connectionProxy.js";

describe("proxy pool fitness registry", () => {
  beforeEach(() => resetPoolFitness());

  it("marks a pool unfit for a scope and prunes on expiry", () => {
    markPoolUnfit("p1", "freebuff::gpt-5.6-luna", Date.now() + 60_000, "limited_ip");
    expect(isPoolFit("p1", "freebuff::gpt-5.6-luna")).toBe(false);
    expect(isPoolFit("p1", "freebuff::other-model")).toBe(true);
    expect(isPoolFit("p2", "freebuff::gpt-5.6-luna")).toBe(true);

    markPoolUnfit("p1", "freebuff::gpt-5.6-luna", Date.now() - 1000); // expired
    expect(isPoolFit("p1", "freebuff::gpt-5.6-luna")).toBe(true); // pruned on read
  });

  it("provider-wide mark (provider::*) covers any model lookup", () => {
    markPoolUnfit("p1", "opencode::*", Date.now() + 60_000, "manual");
    expect(isPoolFit("p1", "opencode::sonnet-4.6")).toBe(false);
    expect(isPoolFit("p1", "freebuff::gpt-5.6-luna")).toBe(true);
  });

  it("fitPoolIds filters unfit pools; snapshot drops expired marks", () => {
    markPoolUnfit("p1", "fb::m1", Date.now() + 60_000);
    markPoolUnfit("p1", "fb::m2", Date.now() - 1000); // expired
    expect(fitPoolIds(["p1", "p2"], "fb::m1")).toEqual(["p2"]);

    const snap = poolFitnessSnapshot();
    expect(snap.p1["fb::m1"]).toBeDefined();
    expect(snap.p1["fb::m2"]).toBeUndefined();
  });

  it("does not reuse a pool when every smart candidate is unfit", () => {
    markPoolUnfit("p1", "freebuff::openai/gpt-5.6-luna", Date.now() + 60_000, "limited_ip");
    markPoolUnfit("p2", "freebuff::openai/gpt-5.6-luna", Date.now() + 60_000, "limited_ip");

    expect(pickProxyPoolId(
      ["p1", "p2"],
      "smart",
      "freebuff",
      { scope: "freebuff::openai/gpt-5.6-luna" },
    )).toBeNull();
  });

  it("preserves fail-open smart fallback for non-Freebuff providers", () => {
    markPoolUnfit("p1", "opencode::sonnet-4.6", Date.now() + 60_000, "ip-limit");
    markPoolUnfit("p2", "opencode::sonnet-4.6", Date.now() + 60_000, "ip-limit");

    expect(pickProxyPoolId(
      ["p1", "p2"],
      "smart",
      "opencode",
      { scope: "opencode::sonnet-4.6" },
    )).toBe("p1");
  });

  it("clear per scope, clear-all per provider, clear-all global, pruneExpired", () => {
    markPoolUnfit("p1", "freebuff::m1", Date.now() + 60_000);
    markPoolUnfit("p1", "kiro::m3", Date.now() + 60_000);

    clearPoolUnfit("p1", "freebuff::m1");
    expect(isPoolFit("p1", "freebuff::m1")).toBe(true);

    clearAllPoolUnfit("kiro");
    expect(poolFitnessSnapshot().p1).toBeUndefined();

    markPoolUnfit("p2", "x::y", Date.now() - 1000);
    expect(pruneExpired()).toBe(1);
    expect(poolFitnessSnapshot()).toEqual({});
  });
});
