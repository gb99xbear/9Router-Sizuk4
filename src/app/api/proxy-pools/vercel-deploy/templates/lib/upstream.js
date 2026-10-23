// Upstream HTTP Request Executor using native Fetch API

/**
 * Forwards request to target API URL with timeout and error handling.
 * @param {string} targetUrl
 * @param {object} options
 * @param {string} options.method
 * @param {Record<string, string>} options.headers
 * @param {any} [options.body]
 * @param {number} [options.timeoutMs=30000]
 * @returns {Promise<{ status: number, headers: Headers, body: ReadableStream | Buffer | string | null, error?: object }>}
 */
export async function forwardToUpstream(targetUrl, options) {
  const timeoutMs = options.timeoutMs || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fetchOptions = {
    method: options.method,
    headers: options.headers,
    signal: controller.signal
  };

  // Attach body for methods that allow payloads
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method.toUpperCase()) && options.body) {
    fetchOptions.body = options.body;
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timer);

    return {
      status: response.status,
      headers: response.headers,
      body: response.body
    };
  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      return {
        status: 504,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          error: {
            type: 'upstream_timeout_error',
            message: `Upstream request timed out after ${timeoutMs}ms`
          }
        })
      };
    }

    return {
      status: 502,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        error: {
          type: 'upstream_connection_error',
          message: 'Unable to reach upstream API'
        }
      })
    };
  }
}
