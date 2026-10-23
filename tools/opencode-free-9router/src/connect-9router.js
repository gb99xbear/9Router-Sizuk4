#!/usr/bin/env node
/**
 * connect-9router.js
 * ---------------------------------------------------------------------------
 * Registers the OpenCode free adapter inside 9Router as a custom
 * OpenAI-compatible provider node, then attaches an API-key connection so its
 * models go live in the router.
 *
 * Verified flow against 9Router v0.5.x:
 *   1. POST /api/provider-nodes  { name, prefix, baseUrl, type, apiType }
 *   2. POST /api/providers       { provider, name, apiKey, baseUrl }
 *   → models appear as  <prefix>/<model-id>  in /v1/models
 *
 * Auth: 9Router protects these routes with a device CLI token
 * (`x-9r-cli-token`). This script reuses 9Router's own API client when it can
 * find an installed copy; otherwise it expects a token via env.
 *
 * Zero dependencies.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { workingModels } from "./opencode_free.js";

const require = createRequire(import.meta.url);

const ROUTER = process.env.ROUTER_URL || "http://127.0.0.1:20128";
const ADAPTER = process.env.ADAPTER_URL || "http://127.0.0.1:8790/v1";
const ADAPTER_KEY = process.env.ADAPTER_API_KEY || "sk-opencode-free";
const NAME = process.env.PROVIDER_NAME || "OpenCode Free";
const PREFIX = process.env.PROVIDER_PREFIX || "ocfree";

/** Try to locate 9Router's own installed API client. */
function findRouterClient() {
  const candidates = [
    process.env.NINEROUTER_CLIENT,
    "/usr/local/lib/node_modules/9router/src/cli/api/client.js",
    "/usr/lib/node_modules/9router/src/cli/api/client.js",
    path.join(os.homedir(), ".npm-global/lib/node_modules/9router/src/cli/api/client.js"),
    "/opt/homebrew/lib/node_modules/9router/src/cli/api/client.js",
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Fallback: raw HTTP with an explicit CLI token. */
async function rawRequest(method, pathname, body) {
  const token = process.env.NINEROUTER_CLI_TOKEN;
  if (!token) {
    throw new Error(
      "no 9router client found and NINEROUTER_CLI_TOKEN is not set; run `npm i -g 9router` or export the token",
    );
  }
  const res = await fetch(`${ROUTER}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", "x-9r-cli-token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function makeClient() {
  const clientPath = findRouterClient();
  if (clientPath) {
    const api = require(clientPath);
    return {
      kind: `9router client (${clientPath})`,
      async listNodes() {
        const r = await api.getProviderNodes();
        return r.data?.nodes || [];
      },
      createNode: (body) => api.createProviderNode(body),
      createConnection: (body) => api.createApiKeyProvider(body),
      listProviders: () => api.getProviders(),
    };
  }
  return {
    kind: "raw HTTP (NINEROUTER_CLI_TOKEN)",
    async listNodes() {
      const r = await rawRequest("GET", "/api/provider-nodes");
      return r.data?.nodes || r.nodes || [];
    },
    createNode: (body) => rawRequest("POST", "/api/provider-nodes", body),
    createConnection: (body) => rawRequest("POST", "/api/providers", body),
    listProviders: () => rawRequest("GET", "/api/providers"),
  };
}

async function checkAdapter() {
  try {
    const res = await fetch(`${ADAPTER.replace(/\/v1$/, "")}/health`);
    if (!res.ok) throw new Error(String(res.status));
  } catch (err) {
    console.error(`!! adapter not reachable at ${ADAPTER} (${err.message})`);
    console.error("   start it first:  node src/adapter.js");
    process.exit(1);
  }
}

async function main() {
  console.log(`9Router : ${ROUTER}`);
  console.log(`adapter : ${ADAPTER}`);
  await checkAdapter();

  const client = makeClient();
  console.log(`api     : ${client.kind}`);

  // 1. provider node (idempotent: reuse if a node with this name exists)
  const nodes = await client.listNodes();
  let node = nodes.find((n) => n.name === NAME);
  if (node) {
    console.log(`provider node "${NAME}" already exists (${node.id})`);
  } else {
    const body = {
      name: NAME,
      prefix: PREFIX,
      baseUrl: ADAPTER,
      type: "openai-compatible",
      apiType: "chat",
    };
    const res = await client.createNode(body);
    node = res.node || res.data?.node || res.data || res;
    console.log(`provider node "${NAME}" created (${node.id || "?"})`);
  }

  // 2. api-key connection so the node is active
  const providers = await client.listProviders();
  const connections = providers.data?.connections || providers.connections || [];
  const hasConn = connections.some(
    (c) => c.provider === node.id || c.providerId === node.id,
  );
  if (hasConn || process.env.SKIP_CONNECTION === "1") {
    console.log("api-key connection already present (or skipped)");
  } else {
    const res = await client.createConnection({
      provider: node.id,
      name: "default",
      apiKey: ADAPTER_KEY,
      baseUrl: ADAPTER,
    });
    console.log("api-key connection created");
    if (!res.success) console.warn("  warning:", res.error || JSON.stringify(res));
  }

  console.log(
    `\nDone. Models are live in 9Router as:\n  ${workingModels()
      .map((m) => `${PREFIX}/${m}`)
      .join("\n  ")}`,
  );
  console.log("\nCreate a router API key (Dashboard → API Keys) and call /v1 with it.");
}

main().catch((err) => {
  console.error("connect failed:", err.message);
  process.exit(1);
});
