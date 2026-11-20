# OpenCode Free - Sizuk4 integration

This directory is the **OpenCode Free adapter** vendored into the 9Router
Sizuk4 repo. It is one half of a two-part system; both halves ship together.

```
client → 9Router (:20128) → adapter (:8790) → opencode.ai
                 │
                 └─ open-sse/executors/opencode.js   ← the other half
```

## The two halves

| Half | Path | Job |
|---|---|---|
| Router side | `open-sse/executors/opencode.js` | Built-in `oc/` free-tier executor. Mints a fresh session per request and reports a 1s reset on IP-limit 429/403. |
| Adapter side | `tools/opencode-free-9router/src/opencode_free.js` | Attested bridge the router calls as an OpenAI-compatible node (prefix `ocfree`). Session rotation + local 429 retry. |

Both halves implement the same rule: **a free-tier quota is drawn per request,
not per conversation.** A conversation-stable session reuses one exhausted
bucket, and the 429 that follows then pins the connection for the whole
account-wide cooldown window.

## Why the two halves differ

- The built-in executor talks to opencode.ai directly from the router process.
- The adapter exists for cases where the router needs an OpenAI-compatible
  node (custom models list, per-node proxy pools, `ocfree/*` aliases). It
  emits a 429 to the router only when its own retries are exhausted.

## Runtime wiring (Oracle A1)

systemd unit `opencode-free-adapter.service`:

```
WorkingDirectory=/home/ubuntu/tools/opencode-free-9router
ExecStart=/usr/bin/node src/adapter.js
Environment=HOST=127.0.0.1
Environment=PORT=8790
Environment=ADAPTER_API_KEY=sk-opencode-free
```

Router side registers it as a provider node:

```
id      openai-compatible-chat-b7ea80b8-840b-4381-98dc-71db3818c210
prefix  ocfree
baseUrl http://127.0.0.1:8790/v1
```

Models are then addressed as `ocfree/<model>`, e.g.
`ocfree/deepseek-v4.1-flash-free`.

## Rules that must not regress

1. **Fresh session per request.** Only a caller-supplied canonical
   `ses_<12 hex><14 base62>` is reused; everything else is regenerated.
   Verified by `node src/selftest.js` and by the rotation assertion in
   `src/selftest.js`.
2. **Do not touch the global 429 rules.** `open-sse/config/errorConfig.js`
   carries a 30s floor that TokenHarbor depends on. OpenCode's fast-fail is
   scoped to the OpenCode executor (via `resetsAtMs`) and to the adapter's own
   retry loop. Never widen it to `ERROR_RULES`.
3. **Read `delta.reasoning_content`.** Upstream streams thinking in that field.
   Ignoring it makes reasoning-heavy turns come back with an empty message.

## Running the tests

```bash
npm --prefix tools/opencode-free-9router test    # adapter selftest, 11 checks
```

## Upstream

Fork of `0xgetz/opencode-free-9router` (MIT). Local changes are described in
`git log -- tools/opencode-free-9router`.
