import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/db/repos/settingsRepo.js", async (orig) => {
  const actual = await orig();
  return actual;
});

describe("settings snapshot cache", () => {
  it("exposes a cached getter and an invalidator", async () => {
    const mod = await import("../../src/lib/db/repos/settingsRepo.js");
    expect(typeof mod.getSettingsCached).toBe("function");
    expect(typeof mod.invalidateSettingsCache).toBe("function");
  });

  it("returns the same object twice within the TTL", async () => {
    const mod = await import("../../src/lib/db/repos/settingsRepo.js");
    const a = await mod.getSettingsCached();
    const b = await mod.getSettingsCached();
    expect(a).toBe(b);
  });

  it("re-reads after invalidation", async () => {
    const mod = await import("../../src/lib/db/repos/settingsRepo.js");
    const a = await mod.getSettingsCached();
    mod.invalidateSettingsCache();
    const b = await mod.getSettingsCached();
    expect(b).not.toBe(a);
  });
});
