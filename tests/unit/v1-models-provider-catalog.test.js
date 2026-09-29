import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getSettings: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/shared/constants/models", () => ({
  PROVIDER_MODELS: {
    demo: [{ id: "static-extra" }, { id: "selected-a" }, { id: "selected-b" }],
  },
  PROVIDER_ID_TO_ALIAS: { demo: "demo" },
  getModelKind: () => "llm",
}));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: { demo: {} },
  getProviderAlias: (provider) => provider,
  isAnthropicCompatibleProvider: () => false,
  isOpenAICompatibleProvider: () => false,
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn() }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: vi.fn() }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn() }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn() }));
vi.mock("open-sse/services/grokCliModels.js", () => ({ resolveGrokCliModels: vi.fn() }));
vi.mock("open-sse/services/cursorModels.js", () => ({ resolveCursorModels: vi.fn() }));
vi.mock("open-sse/shared/zedAuth.js", () => ({ resolveZedModels: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));
vi.mock("open-sse/providers/capabilities.js", () => ({ capabilitiesFromServiceKind: () => null, getCapabilitiesForModel: () => ({}) }));

const { buildModelsList, clearModelsCatalogCache } = await import("../../src/app/api/v1/models/route.js");

function connection(id, isActive = true) {
  return { id, provider: "demo", isActive, providerSpecificData: {} };
}
function settings(modelIds, enabled = true) {
  return {
    catalogWhitelistEnabled: false,
    providerCatalogs: { demo: { enabled, modelIds } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  if (clearModelsCatalogCache) clearModelsCatalogCache();
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({ catalogWhitelistEnabled: false, providerCatalogs: {} });
});

describe("provider-published catalog", () => {
  it("emits only selected IDs when the provider catalog is published", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("demo-a")]);
    mocks.getSettings.mockResolvedValue(settings(["selected-a"]));

    const models = await buildModelsList(["llm"]);

    expect(models.map((model) => model.id)).toEqual(["demo/selected-a"]);
  });

  it("emits zero provider models when the published catalog is intentionally empty", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("demo-a")]);
    mocks.getSettings.mockResolvedValue(settings([]));

    const models = await buildModelsList(["llm"]);

    expect(models.map((model) => model.id)).toEqual([]);
  });

  it("does not broadcast static fallback after every provider connection is off", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("demo-a", false)]);

    const models = await buildModelsList(["llm"]);

    expect(models.map((model) => model.id)).toEqual([]);
  });

  it("keeps legacy broadcast until a provider catalog is explicitly enabled", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("demo-a")]);

    const models = await buildModelsList(["llm"]);

    expect(models.map((model) => model.id)).toEqual([
      "demo/static-extra",
      "demo/selected-a",
      "demo/selected-b",
    ]);
  });
});
