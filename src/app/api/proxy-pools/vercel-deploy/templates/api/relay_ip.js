// Diagnostic endpoint: reports the egress IP the relay presents to upstreams.
// Same-origin, no auth: reveals only this function's public egress IP.
// Used to verify that each deployed relay exits from a DIFFERENT address.

export default async function handler(req, res) {
  const started = Date.now();
  let ip = null;
  let provider = null;
  const sources = [
    { url: 'https://api.ipify.org?format=json', pick: (j) => j.ip },
    { url: 'https://api64.ipify.org?format=json', pick: (j) => j.ip },
    { url: 'https://ifconfig.me/all.json', pick: (j) => j.ip_addr }
  ];

  for (const src of sources) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const r = await fetch(src.url, {
        signal: controller.signal,
        headers: { 'user-agent': 'vercel-relay-ip/1.0' }
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const j = await r.json();
      const v = src.pick(j);
      if (v) {
        ip = v;
        provider = new URL(src.url).hostname;
        break;
      }
    } catch (e) {
      // try next source
    }
  }

  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('access-control-allow-origin', process.env.ALLOWED_ORIGINS || '*');

  if (!ip) {
    return res.status(502).json({ error: { type: 'egress_ip_unavailable' } });
  }

  return res.status(200).json({
    ip,
    source: provider,
    relay: process.env.VERCEL_URL || null,
    region: process.env.VERCEL_REGION || null,
    latencyMs: Date.now() - started
  });
}
