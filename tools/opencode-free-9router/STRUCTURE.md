# Project structure

`opencode-free-9router` is deliberately tiny and dependency-free: four Node.js modules under
`src/`, no `node_modules`, no build step. This document shows how the pieces fit together and
what each file owns. All diagrams are plain Markdown/text — no images.

---

## 1. Runtime topology

The adapter sits between your OpenAI client and the OpenCode Zen gateway, and is itself a
provider inside 9Router.

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                     YOUR MACHINE                         │
                    │                                                          │
   OpenAI client    │   ┌─────────────┐        ┌────────────────────────────┐  │
   (Cursor / Cline  │   │  9Router    │  HTTP  │  adapter.js                │  │
    Claude Code /   ├──▶│ :20128/v1   ├───────▶│  :8790/v1                  │  │
    any SDK)        │   │             │        │                            │  │
                    │   │ provider-   │        │  shapes body + headers,    │  │
                    │   │ node        │        │  aggregates SSE, re-streams │  │
                    │   │ "OpenCode   │        └──────────────┬─────────────┘  │
                    │   │  Free"      │                       │                │
                    │   └─────────────┘                       │ Bearer public  │
                    └─────────────────────────────────────────┼────────────────┘
                                                              │ + attestation
                                                              ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │               opencode.ai/zen/v1  (upstream)             │
                    │                                                          │
                    │   POST /chat/completions   → free chat models          │
                    │   POST /responses          → 2 muse-spark models         │
                    └──────────────────────────────────────────────────────────┘
```

---

## 2. File map

```
opencode-free-9router/
│
├── src/
│   ├── opencode_free.js      ── core library (no I/O server)
│   │     • attested id generation (ses_ / msg_)
│   │     • stable session store
│   │     • request shaping (chat + responses)
│   │     • attested header builder
│   │     • complete() one-shot call
│   │     • model catalog constants
│   │
│   ├── adapter.js            ── HTTP server, OpenAI-compatible
│   │     • GET  /v1/models
│   │     • POST /v1/chat/completions  (stream + non-stream)
│   │     • GET  /health
│   │
│   ├── connect-9router.js    ── registers the provider in 9Router
│   │     • logs in (optional password)
│   │     • POST provider-node "OpenCode Free"
│   │
│   ├── cli.js                ── operator CLI
│   │     • list | ask | check
│   │
│   └── selftest.js           ── verification
│         • 11 offline assertions
│         • optional --live probe of every model
│
├── docs/
│   ├── README.id.md          ── Bahasa Indonesia
│   ├── README.es.md          ── Español
│   ├── README.ja.md          ── 日本語
│   └── README.zh.md          ── 中文
│
├── assets/
│   ├── logo.svg / logo.png
│   └── social-preview.svg / social-preview.png
│
├── README.md
├── STRUCTURE.md              ── this file
├── LICENSE                   ── MIT
├── package.json
└── .gitignore
```

---

## 3. Request data-flow

What happens to one `POST /v1/chat/completions` from a downstream tool.

```
 client body
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ adapter.js                                                          │
│   1. parse JSON, read model                                         │
│   2. complete(model, body, { downstreamUa, downstreamClient })      │
└───────────────────────────────┬─────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ opencode_free.js                                                    │
│                                                                     │
│   isResponsesModel(model)?                                          │
│        │ no                         │ yes                           │
│        ▼                            ▼                               │
│   prepareChatBody()            prepareResponsesBody()               │
│   • stream = true              • stream = true, store = false       │
│   • inject bash/glob/          • map messages → input items          │
│     grep/read (flat fn)        • inject bash/glob/grep/read (flat)   │
│        │                            │                                │
│        └────────────┬───────────────┘                                │
│                     ▼                                                │
│   buildHeaders()                                                    │
│   • UA opencode/1.19.3                                             │
│   • x-opencode-client: desktop                                      │
│   • x-opencode-session: ses_…  (stable)                             │
│   • x-opencode-request: msg_…  (derived from last turn)             │
│   • Authorization: Bearer public                                    │
│                     │                                                │
│                     ▼                                                │
│   fetch(endpointFor(model))  ───────────────────────────────▶ Zen   │
│                     │                                                │
│   aggregateChat() / aggregateResponses()  ◀───────────────── SSE    │
│   • fold deltas into one Chat Completion object                     │
└───────────────────────────────┬─────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ adapter.js                                                          │
│   body.stream ? re-emit as SSE : return JSON                        │
└───────────────────────────────┬─────────────────────────────────────┘
                                 ▼
                          client response
```

---

## 4. The free-tier attestation

The upstream gate rejects anything that does not look like the OpenCode client. The adapter
supplies every signal the gate checks.

```
   signal                     value                          short-lived?
   ────────────────────────   ────────────────────────────   ────────────
   User-Agent                 opencode/<ver>, ver >= 1.17    no
   x-opencode-client          desktop                        no
   x-opencode-session         ses_<12 hex><14 base62>        per identity (stable)
   x-opencode-request         msg_<12 hex><14 base62>        per turn (derived)
   Authorization              Bearer public                  no
   body.stream                true                           per request
   body.tools                 bash, glob, grep, read         per request
```

```
   no attestation ──────────────────────────────▶ 403 FreeTierError
   attestation    ──────────────────────────────▶ 200 text/event-stream
```

---

## 5. State and lifecycle

```
   stableSessions (Map, max 1000)
   ┌──────────────────────────────────────────────┐
   │  identity key  ──▶  ses_…  (least-recently    │
   │                     used evicted when full)   │
   └──────────────────────────────────────────────┘
        reused across requests so free-tier quota
        is accounted per conversation, not per call

   adapter server
   ┌──────────────────────────────────────────────┐
   │  listen :8790  ──▶  request  ──▶  upstream    │
   │  SIGINT/SIGTERM ──▶  graceful close           │
   └──────────────────────────────────────────────┘
```

---

## 6. Verification surface

```
   node src/selftest.js            (offline)
      ├── id shapes                  ses_/msg_ regex
      ├── stable session reuse
      ├── deterministic request id
      ├── chat body fingerprint
      ├── responses body fingerprint
      ├── header attestation
      ├── endpoint routing
      └── adapter routes (/health, /v1/models, 404)

   node src/selftest.js --live     (network)
      └── calls every working model, asserts a response
```

---

## 7. Proven 9Router integration

The provider was registered and exercised end-to-end against **9Router v0.5.95**:

```
   POST /api/provider-nodes  {name,prefix,baseUrl,type:"openai-compatible",apiType:"chat"}
         └▶ node  openai-compatible-chat-<uuid>

   POST /api/providers       {provider:<uuid>,name,apiKey,baseUrl}
         └▶ connection  authType:"apikey", isActive:true

   GET  /v1/models           └▶ 11 ids, e.g. ocfree/beam-free
   POST /v1/chat/completions └▶ 200, "ROUTED-OK"

   route:  client ─▶ 9Router :20128 ─▶ adapter :8790 ─▶ opencode.ai/zen/v1
```
