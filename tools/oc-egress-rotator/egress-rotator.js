// Egress-rotating forwarding proxy for OpenCode's free tier.
//
// OpenCode's "Free usage limit reached" (FreeUsageLimitError) is a PER-IP daily
// cap: the same attested request succeeds from one egress and 429s from another
// at the same moment. This proxy keeps a list of egresses (the host's own IP
// plus one or more WARP tunnels), sends each request through the first one that
// is not cooling, and on 429 parks that egress for the upstream's retry-after
// while failing the request over to the next egress.
//
// The adapter keeps doing attestation; this only decides where packets leave.
import http from "node:http";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const PORT = Number(process.env.LISTEN_PORT || 9090);
const HOST = process.env.LISTEN_HOST || "127.0.0.1";
const UPSTREAM = process.env.UPSTREAM || "https://opencode.ai";
const DEFAULT_COOLDOWN_MS = Number(process.env.DEFAULT_COOLDOWN_MS || 5 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 4);

// EGRESSES: comma-separated "name" (direct) or "name=proxyUrl".
const RAW_EGRESSES = process.env.EGRESSES || "direct";

const egresses = RAW_EGRESSES.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      return { name: entry, proxyUrl: null, dispatcher: null, coolingUntil: 0, hits: 0, errors: 0 };
    }
    const name = entry.slice(0, eq).trim();
    const proxyUrl = entry.slice(eq + 1).trim();
    return { name, proxyUrl, dispatcher: new ProxyAgent(proxyUrl), coolingUntil: 0, hits: 0, errors: 0 };
  });

const HOP_BY_HOP = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length", "accept-encoding",
]);

const LIMIT_BODY = /limit|rate|quota|exhausted|capacity|too many|FreeTierError/i;

function pickEgress(attempt) {
  const now = Date.now();
  const ready = egresses.filter((e) => e.coolingUntil <= now);
  const pool = ready.length ? ready : egresses;
  // rotate across the caller's attempts so a retry lands on a different egress
  return pool[(attempt + Math.floor(now / 1000)) % pool.length];
}

function cooldownFor(res, bodyText) {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 23 * 60 * 60 * 1000);
  }
  if (LIMIT_BODY.test(bodyText)) return DEFAULT_COOLDOWN_MS;
  return 0;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function forwardHeaders(req) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/__egress" || req.url === "/egress-status") {
    const now = Date.now();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      upstream: UPSTREAM,
      egresses: egresses.map((e) => ({
        name: e.name,
        proxy: e.proxyUrl,
        hits: e.hits,
        errors: e.errors,
        cooling_for_s: Math.max(0, Math.round((e.coolingUntil - now) / 1000)),
      })),
    }, null, 1));
    return;
  }

  const body = await readBody(req);
  const headers = forwardHeaders(req);
  const target = UPSTREAM.replace(/\/$/, "") + req.url;

  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const eg = pickEgress(attempt);
    const started = Date.now();
    let upstream;
    try {
      upstream = await undiciFetch(target, {
        method: req.method,
        headers,
        body: body.length ? body : undefined,
        dispatcher: eg.dispatcher || undefined,
        redirect: "manual",
      });
    } catch (err) {
      eg.errors += 1;
      console.error(`[rotator] ${eg.name} transport error: ${err.message}`);
      last = { status: 502, text: JSON.stringify({ error: { message: `egress ${eg.name} failed: ${err.message}` } }) };
      continue;
    }

    const text = await upstream.text();
    const ms = Date.now() - started;

    if (upstream.status === 429 || (upstream.status === 403 && LIMIT_BODY.test(text))) {
      const cd = cooldownFor(upstream, text) || DEFAULT_COOLDOWN_MS;
      eg.coolingUntil = Date.now() + cd;
      console.log(`[rotator] ${eg.name} limited (${upstream.status}) -> cooling ${Math.round(cd / 1000)}s`);
      last = { status: upstream.status, text };
      continue;
    }

    eg.hits += 1;
    console.log(`[rotator] ${eg.name} ${upstream.status} ${ms}ms`);
    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (HOP_BY_HOP.has(k.toLowerCase()) || k.toLowerCase() === "content-encoding") return;
      outHeaders[k] = v;
    });
    res.writeHead(upstream.status, outHeaders);
    res.end(text);
    return;
  }

  const payload = last || { status: 502, text: JSON.stringify({ error: { message: "all egresses failed" } }) };
  res.writeHead(payload.status, { "content-type": "application/json" });
  res.end(payload.text);
});

server.listen(PORT, HOST, () => {
  console.log(`[rotator] listening on http://${HOST}:${PORT} -> ${UPSTREAM}`);
  for (const e of egresses) console.log(`[rotator]   egress ${e.name}${e.proxyUrl ? ` via ${e.proxyUrl}` : " (direct)"}`);
});
