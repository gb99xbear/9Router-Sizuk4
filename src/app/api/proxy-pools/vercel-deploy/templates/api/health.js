import { applyCorsHeaders } from '../lib/headers.js';

export default async function handler(req, res) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS || '*';

  // Support OPTIONS preflight
  if (req.method === 'OPTIONS') {
    const corsHeaders = {};
    applyCorsHeaders(corsHeaders, allowedOrigins);
    for (const [k, v] of Object.entries(corsHeaders)) {
      res.setHeader(k, v);
    }
    return res.status(204).end();
  }

  const corsHeaders = {};
  applyCorsHeaders(corsHeaders, allowedOrigins);
  for (const [k, v] of Object.entries(corsHeaders)) {
    res.setHeader(k, v);
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    status: 'ok',
    service: 'vercel-api-proxy'
  });
}
