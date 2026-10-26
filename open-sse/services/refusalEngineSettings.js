/**
 * Checks whether Zero-Refusal should be applied for a given model and settings configuration.
 *
 * @param {string} modelId
 * @param {Object} [settings]
 * @returns {boolean}
 */
export function shouldApplyZeroRefusal(modelId, settings) {
  if (!settings || settings.zeroRefusalEnabled !== true) {
    return false;
  }
  if (!modelId || typeof modelId !== "string") {
    return false;
  }
  const targetModels = settings.zeroRefusalTargetModels;
  if (!Array.isArray(targetModels)) {
    return false;
  }
  return targetModels.includes(modelId);
}
