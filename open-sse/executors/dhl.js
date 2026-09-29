// DHL (dahl.global) executor — per-model admission gate + in-slot 429 retry.
//
// Upstream returns 429 `model_concurrency` ("This model is at concurrency
// capacity. Paid accounts are admitted first") when too many requests for the
// same model are in flight, regardless of which account is used. Per-account
// lock/backoff cannot help: under a concurrent burst every request picks a
// different account, each gets 429'd in ~400ms, and the burst burns the whole
// pool in seconds (observed: 100 accounts locked <30s on 2026-09-27).
//
// Two-layer fix:
//  1. Semaphore: at most DHL_MAX_CONCURRENCY requests in flight per upstream
//     model; the rest wait in a bounded FIFO queue instead of multiplying the
//     burst upstream. Slot is held until the response body is fully consumed
//     (streaming holds it until the stream ends).
//  2. In-slot retry: on 429 model_concurrency, wait out the upstream
//     Retry-After (capped) and retry the SAME account inside the slot, instead
//     of returning the 429 to chatCore which would park the account and grab
//     the next one. Only after exhausting local retries does the normal
//     account-fallback path take over.
//
// Tunables (env):
//   DHL_MAX_CONCURRENCY   max in-flight requests per model (default 2)
//   DHL_QUEUE_LIMIT       max queued waiters per model (default 60)
//   DHL_QUEUE_TIMEOUT_MS  max wait for a slot (default 90s; on timeout the
//                         request proceeds un-gated, like pre-fix behavior)
//   DHL_429_RETRIES       in-slot retries on model_concurrency (default 6)
//   DHL_RETRY_CAP_MS      cap per retry wait (default 8000)

import { DefaultExecutor } from "./default.js";

const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.DHL_MAX_CONCURRENCY || "3", 10));
const QUEUE_LIMIT = Math.max(0, parseInt(process.env.DHL_QUEUE_LIMIT || "60", 10));
const QUEUE_TIMEOUT_MS = Math.max(1000, parseInt(process.env.DHL_QUEUE_TIMEOUT_MS || "90000", 10));
const RETRIES_429 = Math.max(0, parseInt(process.env.DHL_429_RETRIES || "6", 10));
const RETRY_CAP_MS = Math.max(1000, parseInt(process.env.DHL_RETRY_CAP_MS || "8000", 10));

// model -> { active, waiters: [{resolve, timer}] }
const gates = new Map();

function getGate(model) {
  let gate = gates.get(model);
  if (!gate) {
    gate = { active: 0, waiters: [] };
    gates.set(model, gate);
  }
  return gate;
}

function release(model) {
  const gate = gates.get(model);
  if (!gate) return;
  const next = gate.waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    // Slot transfers directly to the next waiter; active count unchanged.
    next.resolve(true);
  } else {
    gate.active = Math.max(0, gate.active - 1);
  }
  if (gate.active === 0 && gate.waiters.length === 0) gates.delete(model);
}

function acquire(model) {
  const gate = getGate(model);
  if (gate.active < MAX_CONCURRENCY) {
    gate.active += 1;
    return Promise.resolve(() => release(model));
  }
  if (gate.waiters.length >= QUEUE_LIMIT) {
    // Queue full: proceed un-gated (degrade to pre-fix behavior) rather than fail.
    return Promise.resolve(() => {});
  }
  return new Promise((resolve) => {
    const entry = {
      resolve: null,
      timer: setTimeout(() => {
        const idx = gate.waiters.indexOf(entry);
        if (idx >= 0) gate.waiters.splice(idx, 1);
        // Timed out waiting — proceed un-gated.
        entry.resolve(() => {});
      }, QUEUE_TIMEOUT_MS),
    };
    entry.resolve = (releaseFn) => resolve(releaseFn);
    gate.waiters.push(entry);
  });
}

// Wrap the upstream Response so the slot is held until the body is fully
// consumed (streaming responses hold the upstream slot until the stream ends),
// with a hard hold-time cap as a leak guard.
const MAX_HOLD_MS = 15 * 60 * 1000;

function wrapResponseWithRelease(response, releaseFn) {
  if (!response?.body) {
    releaseFn();
    return response;
  }
  let released = false;
  const holdTimer = setTimeout(() => releaseFn(), MAX_HOLD_MS);
  const rel = () => { if (!released) { released = true; clearTimeout(holdTimer); releaseFn(); } };

  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { rel(); controller.close(); return; }
        controller.enqueue(value);
      } catch (e) {
        rel();
        controller.error(e);
      }
    },
    cancel(reason) {
      rel();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isModelConcurrency429(response) {
  if (response.status !== 429) return false;
  try {
    const clone = response.clone();
    const text = await clone.text();
    return /model_concurrency/i.test(text);
  } catch {
    return false;
  }
}

function retryAfterMs(response) {
  const ra = response?.headers?.get("retry-after");
  if (!ra) return null;
  const sec = Number(ra);
  if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, RETRY_CAP_MS);
  const asDate = Date.parse(ra);
  if (!Number.isNaN(asDate)) return Math.max(250, Math.min(asDate - Date.now(), RETRY_CAP_MS));
  return null;
}

export class DhlExecutor extends DefaultExecutor {
  async execute(opts) {
    const model = opts?.model || "_";
    const release = await acquire(model);
    try {
      // In-slot retry: hold the admission slot and retry the SAME account on
      // upstream model_concurrency 429s, instead of cycling to the next
      // account (which re-multiplies the burst under concurrency).
      for (let attempt = 0; ; attempt++) {
        let result;
        try {
          result = await super.execute(opts);
        } catch (err) {
          release();
          throw err;
        }
        if (result.response.ok) {
          // Hold the slot until the caller finishes consuming the body.
          result.response = wrapResponseWithRelease(result.response, release);
          return result;
        }
        if (attempt < RETRIES_429 && await isModelConcurrency429(result.response)) {
          // Drain the error body to free the upstream socket, then wait out
          // the upstream Retry-After (or linear backoff) and retry same acct.
          let waitMs = retryAfterMs(result.response);
          try { await result.response.text(); } catch { /* ignore */ }
          if (waitMs == null) waitMs = Math.min(1000 * (attempt + 1), RETRY_CAP_MS);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        release();
        return result;
      }
    } catch (err) {
      release();
      throw err;
    }
  }
}

export default DhlExecutor;
