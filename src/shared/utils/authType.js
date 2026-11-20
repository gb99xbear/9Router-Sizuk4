/**
 * Canonical authType helpers.
 *
 * 9Router stores `authType` per connection. Historically three spellings leaked
 * in through direct SQLite writes and older importers:
 *
 *   apikey | api_key | api-key   -> all mean the same thing
 *
 * Every comparison in the app used a bare === against "apikey", so rows holding
 * the underscore/dash spelling silently fell through to the OAuth branch and
 * surfaced as "Provider test not supported" - and PUT silently dropped new
 * keys for those rows. Normalise at every read; write only the canonical form.
 */

export const CANONICAL_AUTH_TYPES = ["apikey", "oauth", "cookie", "none"];

/**
 * Fold arbitrary input to its canonical authType.
 * @returns {string|null} canonical value, or null when the value is not a known
 *   authType (e.g. "bearer", "token") - callers must decide what to do.
 */
export function normalizeAuthType(raw) {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/g, "");
  if (!v) return "apikey"; // openai-compatible default
  if (v === "apikey") return "apikey";
  if (v === "oauth") return "oauth";
  if (v === "cookie") return "cookie";
  if (v === "none") return "none";
  return null; // unknown spelling - never guess
}

/** True when the connection authenticates with an API key (any spelling). */
export function isApiKeyAuth(raw) {
  return normalizeAuthType(raw) === "apikey";
}
