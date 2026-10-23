import { prepareUpstreamHeaders, prepareDownstreamHeaders, applyCorsHeaders } from '../lib/headers.js';
import { validateTargetUrl, checkRateLimit, logRequest } from '../lib/security.js';
import { forwardToUpstream } from '../lib/upstream.js';

export const config = {
  api: {
    bodyParser: false // Handle raw streams/buffers manually for transparent body forwarding
  }
};

/**
 * Reads raw request body from incoming HTTP request stream
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

/**
 * Extracts target subpath and original query parameters from request
 * Priority: 9Router relay contract header (x-relay-path) > PRD query/path logic
 * @param {import('http').IncomingMessage & { query?: Record<string, any> }} req
 * @returns {string}
 */
function getRelativeTargetPath(req) {
  // 9Router relay contract: path dibawa sebagai header x-relay-path
  // (9Router fetch ke origin relay terus, bukan /api/proxy/*)
  const relayPath = req.headers['x-relay-path'];
  if (relayPath && typeof relayPath === 'string' && relayPath.startsWith('/')) {
    return relayPath;
  }

  const dummyOrigin = 'http://localhost';
  const parsedUrl = new URL(req.url || '/', dummyOrigin);
  let subpath = '';

  if (req.query && req.query.path) {
    subpath = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
  } else {
    subpath = parsedUrl.pathname.replace(/^\/api\/proxy\/?/, '');
  }

  const searchParams = new URLSearchParams(parsedUrl.searchParams);
  searchParams.delete('path'); // Remove Vercel rewrite internal parameter

  const queryString = searchParams.toString();
  return subpath ? (queryString ? `${subpath}?${queryString}` : subpath) : (queryString ? `?${queryString}` : '');
}

export default async function handler(req, res) {
  const startTime = Date.now();
  const allowedOrigins = process.env.ALLOWED_ORIGINS || '*';

  // 1. Handle OPTIONS CORS Preflight
  if (req.method === 'OPTIONS') {
    const corsHeaders = {};
    applyCorsHeaders(corsHeaders, allowedOrigins);
    for (const [k, v] of Object.entries(corsHeaders)) {
      res.setHeader(k, v);
    }
    return res.status(204).end();
  }

  // 2. Check Rate Limit
  const isRateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';
  if (isRateLimitEnabled) {
    const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1').toString().split(',')[0].trim();
    const rateCheck = checkRateLimit(clientIp);

    if (!rateCheck.allowed) {
      const corsHeaders = {};
      applyCorsHeaders(corsHeaders, allowedOrigins);
      for (const [k, v] of Object.entries(corsHeaders)) {
        res.setHeader(k, v);
      }
      res.setHeader('Retry-After', Math.ceil(rateCheck.resetMs / 1000));
      return res.status(429).json({
        error: {
          type: 'rate_limit_exceeded',
          message: 'Too many requests. Please try again later.'
        }
      });
    }
  }

  // 3. Validate Target API URL (PRD SEC-02: fixed upstream, bukan open proxy)
  let targetBaseUrl;
  try {
    targetBaseUrl = process.env.TARGET_API_BASE_URL;
    validateTargetUrl(targetBaseUrl);
  } catch (err) {
    const corsHeaders = {};
    applyCorsHeaders(corsHeaders, allowedOrigins);
    for (const [k, v] of Object.entries(corsHeaders)) {
      res.setHeader(k, v);
    }
    return res.status(500).json({
      error: {
        type: 'configuration_error',
        message: err.message || 'TARGET_API_BASE_URL environment variable is missing or invalid'
      }
    });
  }

  // 3b. 9Router relay contract: x-relay-target wajib se-origin dgn env allowlist.
  //     Kalau berbeza = relay dipanggil utk upstream tak dibenarkan -> tolak (SEC-02).
  const relayTarget = req.headers['x-relay-target'];
  if (relayTarget && typeof relayTarget === 'string') {
    try {
      const relayOrigin = new URL(relayTarget).origin;
      const allowedOrigin = new URL(targetBaseUrl).origin;
      if (relayOrigin !== allowedOrigin) {
        return res.status(403).json({
          error: {
            type: 'upstream_not_allowed',
            message: `Relay target ${relayOrigin} is not in allowlist (allowed: ${allowedOrigin})`
          }
        });
      }
    } catch (err) {
      return res.status(400).json({
        error: { type: 'invalid_relay_target', message: 'Invalid x-relay-target header' }
      });
    }
  }

  // 4. Construct Target Upstream URL
  const subpath = getRelativeTargetPath(req);
  const normalizedBase = targetBaseUrl.endsWith('/') ? targetBaseUrl : `${targetBaseUrl}/`;
  const normalizedSubpath = subpath.startsWith('/') ? subpath.slice(1) : subpath;
  const fullTargetUrl = `${normalizedBase}${normalizedSubpath}`;

  // 5. Prepare Upstream Headers & Body
  const serverApiKey = process.env.TARGET_API_KEY;
  const upstreamHeaders = prepareUpstreamHeaders(req.headers, serverApiKey);

  let rawBody = null;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    try {
      rawBody = await readRawBody(req);
    } catch (err) {
      return res.status(400).json({
        error: {
          type: 'invalid_request_body',
          message: 'Failed to read request body'
        }
      });
    }
  }

  // 6. Forward Request to Upstream API
  const timeoutMs = parseInt(process.env.PROXY_TIMEOUT_MS || '30000', 10);
  const upstreamResult = await forwardToUpstream(fullTargetUrl, {
    method: req.method,
    headers: upstreamHeaders,
    body: rawBody,
    timeoutMs
  });

  // 7. Format & Write Response Headers
  const downstreamHeaders = prepareDownstreamHeaders(upstreamResult.headers, allowedOrigins);
  for (const [hName, hVal] of Object.entries(downstreamHeaders)) {
    res.setHeader(hName, hVal);
  }

  res.statusCode = upstreamResult.status;

  // 8. Stream / Send Response Body
  if (upstreamResult.body) {
    if (typeof upstreamResult.body === 'string') {
      res.end(upstreamResult.body);
    } else if (Buffer.isBuffer(upstreamResult.body)) {
      res.end(upstreamResult.body);
    } else if (typeof upstreamResult.body.getReader === 'function') {
      const reader = upstreamResult.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } catch (streamErr) {
        console.error('Error streaming response:', streamErr);
      } finally {
        res.end();
      }
    } else {
      // Fallback for Node ReadableStream
      try {
        for await (const chunk of upstreamResult.body) {
          res.write(chunk);
        }
      } catch (streamErr) {
        console.error('Error iterating response stream:', streamErr);
      } finally {
        res.end();
      }
    }
  } else {
    res.end();
  }

  // 9. Safe Log Execution Metrics
  const latencyMs = Date.now() - startTime;
  logRequest({
    method: req.method,
    path: subpath || '/',
    status: upstreamResult.status,
    latencyMs,
    requestId: (req.headers['x-request-id'] || '').toString()
  });
}
