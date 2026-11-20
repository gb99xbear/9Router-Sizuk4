import { describe, it, expect } from "vitest";
import { mergeWithDefaults, updateSettings, getSettings } from "../../src/lib/db/repos/settingsRepo.js";
import { shouldApplyZeroRefusal } from "../../open-sse/services/refusalEngineSettings.js";

describe("Zero-Refusal Settings & Helper", () => {
  it("defaults have zeroRefusalEnabled, zeroRefusalTargetModels, and zeroRefusalMaxReframes", () => {
    const settings = mergeWithDefaults({});
    expect(settings.zeroRefusalEnabled).toBe(false);
    expect(settings.zeroRefusalTargetModels).toEqual([
      "glm-5.3",
      "glm-5.3-flash",
      "deepseek-v4.1-flash",
      "mimo-v2.6-flash",
      "kimi-k3",
    ]);
    expect(settings.zeroRefusalMaxReframes).toBe(4);
  });

  it("preserves custom settings when provided", () => {
    const custom = {
      zeroRefusalEnabled: true,
      zeroRefusalTargetModels: ["custom-model"],
      zeroRefusalMaxReframes: 2,
    };
    const settings = mergeWithDefaults(custom);
    expect(settings.zeroRefusalEnabled).toBe(true);
    expect(settings.zeroRefusalTargetModels).toEqual(["custom-model"]);
    expect(settings.zeroRefusalMaxReframes).toBe(2);
  });

  it("can persist zero-refusal settings to database via updateSettings", async () => {
    const original = await getSettings();
    try {
      const updated = await updateSettings({
        zeroRefusalEnabled: true,
        zeroRefusalTargetModels: ["model-x", "model-y"],
        zeroRefusalMaxReframes: 7,
      });
      expect(updated.zeroRefusalEnabled).toBe(true);
      expect(updated.zeroRefusalTargetModels).toEqual(["model-x", "model-y"]);
      expect(updated.zeroRefusalMaxReframes).toBe(7);

      const refreshed = await getSettings();
      expect(refreshed.zeroRefusalEnabled).toBe(true);
      expect(refreshed.zeroRefusalTargetModels).toEqual(["model-x", "model-y"]);
      expect(refreshed.zeroRefusalMaxReframes).toBe(7);
    } finally {
      // Restore previous state
      await updateSettings({
        zeroRefusalEnabled: original.zeroRefusalEnabled,
        zeroRefusalTargetModels: original.zeroRefusalTargetModels,
        zeroRefusalMaxReframes: original.zeroRefusalMaxReframes,
      });
    }
  });

  describe("shouldApplyZeroRefusal", () => {
    it("returns false if zeroRefusalEnabled is false or unset", () => {
      const settingsDisabled = {
        zeroRefusalEnabled: false,
        zeroRefusalTargetModels: ["glm-5.3"],
      };
      expect(shouldApplyZeroRefusal("glm-5.3", settingsDisabled)).toBe(false);

      const settingsEmpty = {};
      expect(shouldApplyZeroRefusal("glm-5.3", settingsEmpty)).toBe(false);

      expect(shouldApplyZeroRefusal("glm-5.3", null)).toBe(false);
      expect(shouldApplyZeroRefusal("glm-5.3", undefined)).toBe(false);
    });

    it("returns false if modelId is not in zeroRefusalTargetModels", () => {
      const settings = {
        zeroRefusalEnabled: true,
        zeroRefusalTargetModels: ["glm-5.3", "glm-5.3-flash"],
      };
      expect(shouldApplyZeroRefusal("claude-3-5-sonnet", settings)).toBe(false);
      expect(shouldApplyZeroRefusal("", settings)).toBe(false);
      expect(shouldApplyZeroRefusal(null, settings)).toBe(false);
    });

    it("returns true if zeroRefusalEnabled is true and modelId is in target models", () => {
      const settings = {
        zeroRefusalEnabled: true,
        zeroRefusalTargetModels: ["glm-5.3", "glm-5.3-flash", "kimi-k3"],
      };
      expect(shouldApplyZeroRefusal("glm-5.3", settings)).toBe(true);
      expect(shouldApplyZeroRefusal("glm-5.3-flash", settings)).toBe(true);
      expect(shouldApplyZeroRefusal("kimi-k3", settings)).toBe(true);
    });
  });
});
