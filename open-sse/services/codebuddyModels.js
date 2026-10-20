// CodeBuddy model discovery: Tencent does not expose a live /models endpoint
// (probed every plausible path - all 404). The authoritative list is the
// official model-list doc page, which Tencent updates as they ship new models.
//
// resolveCodeBuddyModels() scrapes that page (cache via simple module flag),
// extracts the "Model (API Parameter)" tokens from the Language Models table,
// and merges with the local registry so unknown upstream additions appear
// without waiting for a 9router release. Failures fall back to the static
// registry (fail-open, same pattern as kiro/qoder/grok-cli).

import { getModelsByProviderId } from "../config/providerModels.js";

const DOC_URL = "https://intl.cloud.tencent.com/document/product/1300/78934";
const FETCH_TIMEOUT_MS = 20000;

let cache = { at: 0, models: null };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const NOISE = new Set([
  "html", "text", "json", "video", "image", "audio", "www", "https", "http",
  "preview", "token", "tokens", "model", "v1", "v2", "v3", "a", "anchor-element",
  "table-container", "table-inner", "tse-markdown-ul", "tse-ul-content",
  "tse-ul-symbol", "is-header", "instruction-following", "data-slate-node",
  "data-slate-leaf", "data-slate-string", "vec-model-list-section", "eepseek-v3.2",
]);

function extractModelTokens(html) {
  const start = html.indexOf("Language Models");
  const endIdx = html.indexOf("Vector Models");
  const region = start !== -1 && endIdx !== -1 ? html.slice(start, endIdx) : html;
  const tokens = {};
  const regex = /[a-z][a-z0-9]*[\-.][a-z0-9][a-z0-9.\-/]*/g;
  let m;
  while ((m = regex.exec(region)) !== null) {
    const tok = m[0].toLowerCase().trim();
    if (tok.length < 4) continue;
    // real model params carry a digit, a dash, a dot or a slash
    if (!(/\d/.test(tok) || tok.includes("-") || tok.includes(".") || tok.includes("/"))) continue;
    if (NOISE.has(tok)) continue;
    tokens[tok] = (tokens[tok] || 0) + 1;
  }
  return Object.keys(tokens).sort();
}

async function fetchDoc() {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(DOC_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) 9router-catalog-sync/1.0" },
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) throw new Error(`Tencent doc HTTP ${res.status}`);
    return await res.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toModelObjects(ids, staticModels) {
  const byId = new Map(staticModels.map((sm) => [sm.id, sm]));
  const out = [];
  for (const id of ids) {
    const known = byId.get(id);
    if (known) {
      out.push({ ...known, id, name: known.name || id });
    } else {
      out.push({ id, name: id });
    }
  }
  return out;
}

export async function resolveCodeBuddyModels({ providerId, log } = {}) {
  const staticModels = getModelsByProviderId(providerId) || [];

  // cache hit
  const now = Date.now();
  if (cache.models && now - cache.at < CACHE_TTL_MS) {
    return { models: toModelObjects(cache.models, staticModels), source: "cache" };
  }

  let ids = null;
  try {
    const html = await fetchDoc();
    ids = extractModelTokens(html);
    if (ids.length === 0) throw new Error("no model tokens parsed from doc");
  } catch (err) {
    const e = err && err.message ? err.message : String(err);
    if (log) {
      try {
        log?.write?.(`[CodeBuddy] doc scrape failed (${e}); using static registry.`);
      } catch {
        if (typeof log === "function") log(`[CodeBuddy] doc scrape failed (${e}); using static registry.`);
      }
    }
    return { models: staticModels, source: "static-fallback", warning: e };
  }

  cache = { at: now, models: ids };
  return { models: toModelObjects(ids, staticModels), source: "doc" };
}
