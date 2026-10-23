// Security & Rate Limiting & Safe Logging module

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100; // Max 100 requests per minute per IP

/**
 * Validates target base URL to prevent open proxy / SSRF primitives.
 * @param {string} targetBaseUrl
 * @returns {URL}
 */
export function validateTargetUrl(targetBaseUrl) {
  if (!targetBaseUrl) {
    throw new Error('TARGET_API_BASE_URL is not configured');
  }

  try {
    const parsed = new URL(targetBaseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid URL protocol. Only HTTP and HTTPS are supported.');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid TARGET_API_BASE_URL: ${err.message}`);
  }
}

/**
 * Simple in-memory rate limiter per IP address
 * @param {string} clientIp
 * @returns {{ allowed: boolean, current: number, limit: number, resetMs: number }}
 */
export function checkRateLimit(clientIp = 'unknown') {
  const now = Date.now();
  let record = rateLimitMap.get(clientIp);

  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(clientIp, record);
    
    // Clean up old entries periodically
    if (rateLimitMap.size > 10000) {
      for (const [ip, item] of rateLimitMap.entries()) {
        if (now > item.resetTime) rateLimitMap.delete(ip);
      }
    }
    return { allowed: true, current: 1, limit: MAX_REQUESTS_PER_WINDOW, resetMs: RATE_LIMIT_WINDOW_MS };
  }

  record.count += 1;
  const resetMs = Math.max(0, record.resetTime - now);

  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, current: record.count, limit: MAX_REQUESTS_PER_WINDOW, resetMs };
  }

  return { allowed: true, current: record.count, limit: MAX_REQUESTS_PER_WINDOW, resetMs };
}

/**
 * Sanitizes object by masking sensitive keys (e.g. authorization, api keys)
 * @param {Record<string, any>} obj
 * @returns {Record<string, any>}
 */
export function sanitizeLogData(obj) {
  const sanitized = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (lower.includes('auth') || lower.includes('key') || lower.includes('secret') || lower.includes('token')) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

/**
 * Safe logger according to SEC-05
 * @param {{ method: string, path: string, status: number, latencyMs: number, requestId?: string }} info
 */
export function logRequest(info) {
  const timestamp = new Date().toISOString();
  console.log(
    JSON.stringify({
      timestamp,
      method: info.method,
      path: info.path,
      status: info.status,
      latencyMs: info.latencyMs,
      requestId: info.requestId || '-'
    })
  );
}
