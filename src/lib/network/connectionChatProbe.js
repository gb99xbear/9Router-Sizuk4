import { getProviderConnectionById } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

function normalizedBaseUrl(value) {
  const baseUrl = String(value || "").trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("Connection has no base URL");
  return baseUrl;
}

function normalizedModel(value) {
  const model = String(value || "").trim();
  if (!model) throw new Error("Model is required");
  return model;
}

export async function probeConnectionChat(connectionId, model) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) throw new Error("Connection not found");
  if (!connection.isActive) throw new Error("Connection is inactive");
  if (!connection.apiKey) throw new Error("Connection has no API key");

  const upstreamModel = normalizedModel(model);
  const baseUrl = normalizedBaseUrl(connection.providerSpecificData?.baseUrl);
  const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {}, connection.id);
  const proxyOptions = {
    connectionProxyEnabled: proxy.connectionProxyEnabled === true,
    connectionProxyUrl: proxy.connectionProxyUrl || "",
    connectionNoProxy: proxy.connectionNoProxy || "",
    proxyPoolId: proxy.proxyPoolId || null,
    strictProxy: proxy.strictProxy === true,
    vercelRelayUrl: proxy.vercelRelayUrl || "",
  };

  const response = await proxyAwareFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: upstreamModel,
      messages: [{ role: "user", content: "Reply OK only" }],
      max_tokens: 16,
      stream: false,
    }),
  }, proxyOptions);

  return {
    valid: response.ok,
    status: response.status,
    connectionId: connection.id,
    model: upstreamModel,
    proxyPoolId: proxyOptions.proxyPoolId,
    strictProxy: proxyOptions.strictProxy,
  };
}
