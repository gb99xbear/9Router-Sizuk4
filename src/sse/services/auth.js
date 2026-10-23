import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { getAntigravityQuotaCache } from "./antigravityQuota.js";
import * as log from "../utils/logger.js";

// Per-connection write locks (not a global serialization barrier).
// Different keys can be selected in parallel; only the same key's DB write
// is serialized to avoid lastUsedAt / consecutiveUseCount races.
const connectionWriteLocks = new Map();

// Atomic per-provider rotating pointer for CONCURRENT round-robin spread.
// Decisions in memory with a synchronous counter, so simultaneous requests
// land on DIFFERENT keys instead of both reading the same stale lastUsedAt
// snapshot and choosing the same key (the race that re-created per-key
// concurrency-limit hits).
const rrPointer = new Map();

// In-flight guard: connectionId -> epoch ms until which the key is reserved.
// Round-robin must NOT hand the same account to a second concurrent request
// while the first is still streaming, because that re-creates the upstream
// per-account concurrency "at capacity" 429s. A synchronous set/get keeps
// this immune to the same snapshot race the pointer already solves.
const inFlight = new Map();
// Safety net only: a request that never reports back (crash, dropped stream)
// releases after this long so the key cannot be stranded forever.
const IN_FLIGHT_TTL_MS = 60 * 1000;

function inFlightUntil(connectionId) {
  const until = inFlight.get(connectionId);
  if (!until) return 0;
  if (until <= Date.now()) { inFlight.delete(connectionId); return 0; }
  return until;
}

export function markConnectionInFlight(connectionId) {
  if (!connectionId) return;
  inFlight.set(connectionId, Date.now() + IN_FLIGHT_TTL_MS);
}

export function releaseConnectionInFlight(connectionId) {
  if (connectionId) inFlight.delete(connectionId);
}

// True when the key is reserved by another live request.
function isConnectionInFlight(connectionId) {
  return inFlightUntil(connectionId) > 0;
}


export function filterConnectionsForModel(providerId, connections, model, settings = {}) {
  const override = (settings.providerStrategies || {})[providerId] || {};
  if (override.strictModelAssignment !== true || !model) {
    return connections;
  }
  return connections.filter((connection) => {
    const assignedModel = connection.providerSpecificData?.assignedModel
      || (providerId === "freebuff" ? connection.providerSpecificData?.freebuffModel : null);
    return assignedModel === model;
  });
}

const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Per-connection lock helper: serializes the DB write for one key only.
  const withConnectionLock = async (connId, fn) => {
    const prev = connectionWriteLocks.get(connId) || Promise.resolve();
    let release;
    const next = new Promise(r => { release = r; });
    connectionWriteLocks.set(connId, next);
    await prev;
    try { return await fn(); }
    finally { release(); if (connectionWriteLocks.get(connId) === next) connectionWriteLocks.delete(connId); }
  };

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      let pickedId = override.proxyPoolId || null;
      let poolIds = [];
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true });
        poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
        // Scope region-aware ("smart") filtering to this provider/model so
        // pools marked unfit here are skipped.
        const scope = `${providerId}::${model || "*"}`;
        pickedId = pickProxyPoolId(poolIds, strategy, providerId, { scope });
      } else if (override.proxyPoolId) {
        poolIds = [override.proxyPoolId];
      }
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
          proxyPoolId: resolvedProxy.proxyPoolId || null,
          strictProxy: resolvedProxy.strictProxy === true,
          // Let chatCore's pool-scoped retry rotate across the same candidate
          // pool set (excluding the failed pool) instead of reusing it — this
          // is what makes per-IP limit retries work for no-auth providers.
          proxyPoolIds: poolIds,
          proxyRotationStrategy: strategy,
        },
      };
    }

    let connections = await getProviderConnections({ provider: providerId, isActive: true });
    const settings = await getSettings();
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    connections = filterConnectionsForModel(providerId, connections, model, settings);
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Antigravity quota cache is lazy: only populated after that account returns 409/429.
    const isAntigravity = providerId === "antigravity";
    const antigravityQuotaCache = isAntigravity && model ? getAntigravityQuotaCache() : null;

    // Filter out model-locked, excluded, and Antigravity quota-exhausted connections.
    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      // Antigravity: skip if live quota exhausted for this model
      if (isAntigravity && model && antigravityQuotaCache) {
        const quota = antigravityQuotaCache.get(c.id)?.[model];
        if (quota && quota.remainingPercentage <= 0 && quota.resetAt && new Date(quota.resetAt).getTime() > Date.now()) {
          const account = c.id?.slice(0, 8) || "unknown";
          log.info("AG_QUOTA", `${account} | CACHE_BLOCK ${model} — skip upstream until ${quota.resetAt}`);
          return false;
        }
      }
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      // Find earliest persistent lock or lazy Antigravity quota-cache reset for retry timing.
      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean);
      if (isAntigravity && model && antigravityQuotaCache) {
        connections.forEach((c) => {
          const resetAt = antigravityQuotaCache.get(c.id)?.[model]?.resetAt;
          if (resetAt && new Date(resetAt).getTime() > Date.now()) expiries.push(resetAt);
        });
      }
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    // Per-provider strategy overrides global setting
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      // Atomic in-memory pick so concurrent requests take DISJOINT keys.
      // The old logic compared lastUsedAt snapshots in async scope; two
      // simultaneous requests read the same snapshot and chose the SAME key
      // before the DB write landed -> spread was ineffective and re-created
      // per-key concurrency-limit errors. A synchronous pointer advance is
      // immune to that race.
      // True round-robin: Sort by stable identifier (priority, then id)
      // so the array order remains consistent across requests.
      const sorted = [...availableConnections].sort((a, b) => {
        const pDiff = (a.priority || 999) - (b.priority || 999);
        if (pDiff !== 0) return pDiff;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
      // Skip keys already reserved by another live request. If EVERY key is
      // in flight we still fall through to the raw pointer (better a possible
      // collision than a hard failure — upstream will 429 and we rotate).
      const free = sorted.filter((c) => !isConnectionInFlight(c.id));
      const pool = free.length > 0 ? free : sorted;

      if (pool.length > 0) {
        const rkey = providerId + "::" + (model || "*");
        const prev = rrPointer.get(rkey) || 0;
        connection = pool[prev % pool.length];
        rrPointer.set(rkey, prev + 1);
      }

      // Reserve the key for the lifetime of this request so a concurrent
      // request cannot pick the same account until we release it.
      if (connection) markConnectionInFlight(connection.id);

      // Persist usage for future ordering. Per-key lock serializes the DB write,
      // while the in-memory pointer already guarantees disjoint picks.
      if (connection) {
        await withConnectionLock(connection.id, () => updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        }));
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    // Scope the region-aware picker to this provider/model (e.g. freebuff::gpt-5.6-luna)
    const psdForProxy = connection.providerSpecificData?.proxyPoolIds?.length
      ? { ...connection.providerSpecificData, proxyPoolScope: `${providerId}::${model || ""}` }
      : connection.providerSpecificData;
    const resolvedProxy = await resolveConnectionProxyConfig(psdForProxy || {}, connection.id);

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        proxyPoolId: resolvedProxy.proxyPoolId || null,
        noFitPool: resolvedProxy.noFitPool === true,
        strictProxy: resolvedProxy.strictProxy === true,
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null, retryAfterMs = 0) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  // Request is finished (failed) — hand the key back to the rotation pool.
  releaseConnectionInFlight(connectionId);
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  // GitHub premium-request exhaustion is account-wide until the next UTC month.
  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  if (githubResetAtMs) {
    shouldFallback = true;
    cooldownMs = githubResetAtMs - Date.now();
    newBackoffLevel = 0;
  } else if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    // Antigravity quota API provides exact per-model resetAt. Do not truncate it.
    // Freebucks exhaustion is likewise a hard stop until the daily Pacific
    // reset (up to ~24h) — skip the account for the day rather than re-poke it
    // every 30 min; guard at 26h so a bad server value can't lock forever.
    const providerId = resolveProviderId(provider);
    cooldownMs = providerId === "antigravity"
      ? resetsAtMs - Date.now()
      : providerId === "freebuff"
        ? Math.min(resetsAtMs - Date.now(), 26 * 60 * 60 * 1000)
        : Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    const hintMs = retryAfterMs > 0 ? retryAfterMs : parseRetryAfterMs(errorText, null);
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel, hintMs));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason = typeof errorText === "string" ? errorText.slice(0, 1000) : "Provider error";
  const lockUpdate = buildModelLockUpdate(githubResetAtMs ? null : model, cooldownMs);

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  // Request is finished (succeeded) — hand the key back to the rotation pool.
  releaseConnectionInFlight(connectionId);
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true;    // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract Retry-After from either response headers or the JSON error body.
 * Upstreams put it in three different places:
 *   - a real HTTP header (TokenHarbor, most OpenAI-compatible servers)
 *   - a JSON body field: {"error": {"retry_after": 60}} or retryAfter
 *   - human text: "retry shortly" with no number (returns 0, ladder applies)
 * Returns milliseconds, or 0 when unknown.
 */
function parseRetryAfterMs(errorText, headers) {
  // 1) real header
  try {
    const h = headers && (headers.get ? headers.get("retry-after") : headers["retry-after"]);
    if (h != null) {
      const secs = Number(String(h).trim());
      if (Number.isFinite(secs) && secs > 0) return secs * 1000;
      const when = Date.parse(String(h));
      if (Number.isFinite(when)) {
        const ms = when - Date.now();
        if (ms > 0) return ms;
      }
    }
  } catch (e) {}
  // 2) JSON body
  try {
    const body = typeof errorText === "string" ? JSON.parse(errorText) : errorText;
    const cands = [
      body?.error?.retry_after,
      body?.error?.retryAfter,
      body?.retry_after,
      body?.retryAfter
    ];
    for (const c of cands) {
      const secs = Number(c);
      if (Number.isFinite(secs) && secs > 0) return secs * 1000;
    }
  } catch (e) {}
  // 3) "retry in 60 seconds" inside the message
  try {
    const txt = typeof errorText === "string" ? errorText : JSON.stringify(errorText || "");
    const m = txt.match(/retry[^0-9]{0,40}(\d{1,5})\s*(second|sec|s\b)/i);
    if (m) {
      const secs = Number(m[1]);
      if (Number.isFinite(secs) && secs > 0) return secs * 1000;
    }
    const m2 = txt.match(/retry[^0-9]{0,40}(\d{1,5})\s*(minute|min)/i);
    if (m2) {
      const mins = Number(m2[1]);
      if (Number.isFinite(mins) && mins > 0) return mins * 60 * 1000;
    }
  } catch (e) {}
  return 0;
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
