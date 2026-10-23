// Header processing & sanitization for Vercel API Proxy

const DISALLOWED_UPSTREAM_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  'upgrade',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'via',
  'cdn-loop',
  'x-vercel-id',
  'x-vercel-forwarded-for',
  'x-vercel-deployment-url',
  'x-vercel-proxied-for'
]);

const DISALLOWED_DOWNSTREAM_HEADERS = new Set([
  'connection',
  'transfer-encoding',
  'content-encoding',
  'keep-alive'
]);

/**
 * Filters incoming client headers before forwarding to upstream API.
 * @param {Record<string, string | string[] | undefined>} incomingHeaders
 * @param {string} [serverApiKey]
 * @returns {Record<string, string>}
 */
export function prepareUpstreamHeaders(incomingHeaders, serverApiKey) {
  const cleanHeaders = {};

  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!value) continue;
    const lowerKey = key.toLowerCase();

    if (DISALLOWED_UPSTREAM_HEADERS.has(lowerKey)) {
      continue;
    }

    cleanHeaders[lowerKey] = Array.isArray(value) ? value.join(', ') : value;
  }

  // Inject server-side API Key if configured
  if (serverApiKey) {
    cleanHeaders['authorization'] = `Bearer ${serverApiKey}`;
  }

  return cleanHeaders;
}

/**
 * Filters upstream response headers before returning to client and adds CORS.
 * @param {Headers} upstreamHeaders
 * @param {string} [allowedOrigins='*']
 * @returns {Record<string, string>}
 */
export function prepareDownstreamHeaders(upstreamHeaders, allowedOrigins = '*') {
  const cleanHeaders = {};

  upstreamHeaders.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (DISALLOWED_DOWNSTREAM_HEADERS.has(lowerKey)) {
      return;
    }
    cleanHeaders[lowerKey] = value;
  });

  // Apply CORS headers
  applyCorsHeaders(cleanHeaders, allowedOrigins);

  return cleanHeaders;
}

/**
 * Applies CORS headers to response header object
 * @param {Record<string, string>} headers
 * @param {string} [origin='*']
 */
export function applyCorsHeaders(headers, origin = '*') {
  headers['access-control-allow-origin'] = origin || '*';
  headers['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS';
  headers['access-control-allow-headers'] = 'Content-Type, Authorization, X-Request-ID, Accept, User-Agent';
  headers['access-control-max-age'] = '86400';
}
