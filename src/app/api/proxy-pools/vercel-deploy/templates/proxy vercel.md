# PRD — Vercel API Proxy

## 1. Product Overview

**Nama:** Vercel API Proxy
**Platform:** Vercel Serverless Functions
**Tipe:** HTTP/HTTPS Reverse Proxy
**Tujuan:** Menyediakan endpoint proxy yang menerima request dari client, meneruskannya ke target API, lalu mengembalikan response target API ke client.

### Arsitektur

```text
Client / 9Router
       │
       ▼
Vercel Proxy
       │
       ├── Validate Request
       ├── Add / Remove Headers
       ├── Inject API Key
       └── Forward Request
       │
       ▼
Target API
       │
       ▼
Vercel Proxy
       │
       ▼
Client / 9Router
```

---

# 2. Problem

Client membutuhkan endpoint perantara antara aplikasi dan API provider.

Kebutuhan utama:

* Backend/API provider tidak perlu diekspos langsung.
* API key provider tidak dikirim ke client.
* Endpoint API dapat menggunakan domain Vercel sendiri.
* Request dan response dapat diteruskan secara transparan.
* Header tertentu dapat dimodifikasi sebelum request diteruskan.

---

# 3. Goals

### Primary Goals

1. Menerima HTTP/HTTPS request dari client.
2. Meneruskan request ke target API.
3. Mengembalikan status code target API.
4. Mengembalikan response body target API.
5. Mendukung API key yang disimpan sebagai Vercel Environment Variable.
6. Mendukung GET, POST, PUT, PATCH, DELETE, dan HEAD.
7. Menyediakan konfigurasi target API tanpa hard-code secret.
8. Menangani error upstream dengan jelas.

### Secondary Goals

* Logging request dasar.
* Timeout protection.
* CORS configuration.
* Basic rate limiting jika diperlukan.
* Health-check endpoint.

---

# 4. Non-Goals

Proxy ini **bukan**:

* VPN.
* SOCKS5 proxy.
* TCP/UDP tunnel.
* Residential proxy.
* IP rotation service.
* Proxy untuk menyamarkan aktivitas ilegal.
* Server yang menjalankan proses background permanen.

Scope produk hanya **HTTP/HTTPS API proxy**.

---

# 5. Functional Requirements

## FR-01 — Request Forwarding

Proxy harus menerima request:

```text
POST /api/proxy/v1/chat/completions
```

dan meneruskannya ke:

```text
https://TARGET_API/v1/chat/completions
```

Method request harus dipertahankan.

---

## FR-02 — Supported Methods

Proxy wajib mendukung:

```text
GET
POST
PUT
PATCH
DELETE
HEAD
```

---

## FR-03 — Request Body

Untuk request yang memiliki body, proxy harus meneruskan body tanpa mengubah struktur JSON.

Contoh:

```json
{
  "model": "example-model",
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ]
}
```

Body harus diteruskan ke upstream API.

---

## FR-04 — API Authentication

API key target harus disimpan di:

```text
Vercel Environment Variables
```

Contoh:

```text
TARGET_API_KEY=xxxxxxxx
```

Client tidak boleh mendapatkan nilai environment variable tersebut.

Proxy kemudian menambahkan:

```http
Authorization: Bearer <TARGET_API_KEY>
```

ke request upstream jika provider menggunakan Bearer authentication.

---

## FR-05 — Header Handling

Proxy harus memiliki whitelist/allowlist header.

Header yang umum diteruskan:

```text
Content-Type
Accept
User-Agent
X-Request-ID
```

Header internal seperti:

```text
Host
Content-Length
Connection
```

tidak boleh diteruskan secara mentah jika dapat menyebabkan konflik dengan upstream.

---

# 6. Response Handling

Proxy harus mempertahankan:

* HTTP status code.
* Response body.
* Content-Type.
* Response headers yang aman untuk diteruskan.

Contoh:

```text
Target API
HTTP 200
       ↓
Vercel Proxy
HTTP 200
       ↓
Client
```

Jika upstream mengembalikan:

```text
401
```

proxy harus mengembalikan:

```text
401
```

bukan mengubahnya menjadi `200`.

---

# 7. Error Handling

Proxy harus menangani minimal:

### Upstream 4xx

Contoh:

```text
401 Unauthorized
403 Forbidden
404 Not Found
429 Too Many Requests
```

Response diteruskan ke client.

### Upstream 5xx

Contoh:

```text
500
502
503
504
```

Response diteruskan jika tersedia.

### Connection Failure

Jika target API tidak dapat dihubungi:

```json
{
  "error": {
    "type": "upstream_connection_error",
    "message": "Unable to reach upstream API"
  }
}
```

HTTP status:

```text
502 Bad Gateway
```

---

# 8. Timeout

Proxy harus mempunyai batas waktu request.

Jika upstream terlalu lama merespons, proxy harus menghentikan request dan mengembalikan:

```text
504 Gateway Timeout
```

Timeout tidak boleh membuat server/function menunggu tanpa batas.

---

# 9. CORS

Proxy harus dapat dikonfigurasi untuk kebutuhan browser.

Contoh:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

Untuk production, wildcard `*` sebaiknya diganti dengan origin yang diizinkan.

---

# 10. Health Check

Endpoint:

```text
GET /api/health
```

Response:

```json
{
  "status": "ok",
  "service": "vercel-api-proxy"
}
```

Tujuannya untuk memastikan deployment aktif.

---

# 11. Security Requirements

## SEC-01 — Secret Protection

API key tidak boleh:

* Hard-code di source code.
* Ditampilkan dalam response.
* Ditulis ke log.
* Dikirim kembali ke client.

API key hanya boleh berada di environment variable.

---

## SEC-02 — Target URL

Target API harus dikontrol oleh server.

Jangan membuat endpoint seperti:

```text
/api/proxy?url=https://bebas.com
```

tanpa allowlist.

Jika URL bebas diberikan oleh user, proxy berpotensi menjadi **open proxy / SSRF primitive**.

Implementasi production harus menggunakan:

```text
ALLOWED_UPSTREAMS
```

atau satu target upstream yang fixed.

---

## SEC-03 — Request Size

Proxy harus membatasi ukuran request untuk mencegah abuse dan penggunaan resource berlebihan.

---

## SEC-04 — Rate Limiting

Production deployment sebaiknya memiliki rate limiting berdasarkan:

```text
IP
API key client
User ID
atau kombinasi beberapa identifier
```

---

## SEC-05 — Logging

Log hanya informasi yang diperlukan:

```text
timestamp
method
path
status
latency
request ID
```

Jangan log:

```text
Authorization
API keys
cookies
sensitive request body
```

---

# 12. API Specification

## Health

```http
GET /api/health
```

Response:

```json
{
  "status": "ok"
}
```

---

## Proxy

```http
ANY /api/proxy/*
```

Contoh:

```http
POST /api/proxy/v1/chat/completions
```

Forward menjadi:

```http
POST https://TARGET_API/v1/chat/completions
```

---

# 13. Environment Variables

Minimal:

```text
TARGET_API_BASE_URL=https://api.example.com
TARGET_API_KEY=xxxxxxxx
```

Optional:

```text
ALLOWED_ORIGINS=https://example.com
PROXY_TIMEOUT_MS=30000
RATE_LIMIT_ENABLED=true
```

---

# 14. Project Structure

```text
vercel-api-proxy/
│
├── api/
│   ├── health.js
│   └── proxy.js
│
├── lib/
│   ├── upstream.js
│   ├── headers.js
│   └── security.js
│
├── package.json
├── vercel.json
├── .env.example
└── README.md
```

---

# 15. Deployment

Development:

```bash
npm install
vercel dev
```

Production:

```bash
vercel --prod
```

Environment variables harus dikonfigurasi melalui Vercel project settings atau CLI.

---

# 16. Example Usage

Client mengirim:

```http
POST https://my-proxy.vercel.app/api/proxy/v1/chat/completions
Content-Type: application/json
```

Body:

```json
{
  "model": "example-model",
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ]
}
```

Proxy meneruskan:

```http
POST https://api.example.com/v1/chat/completions
Authorization: Bearer <SERVER_SIDE_API_KEY>
Content-Type: application/json
```

Client hanya mengetahui:

```text
my-proxy.vercel.app
```

dan tidak mengetahui secret upstream.

---

# 17. Acceptance Criteria

Project dianggap selesai apabila:

* [ ] Deployment berhasil di Vercel.
* [ ] `/api/health` mengembalikan status `ok`.
* [ ] GET request berhasil diteruskan.
* [ ] POST request berhasil diteruskan.
* [ ] JSON body diteruskan dengan benar.
* [ ] Status code upstream dipertahankan.
* [ ] Response body diteruskan dengan benar.
* [ ] API key tidak muncul di client.
* [ ] API key tidak muncul di log.
* [ ] Upstream timeout ditangani.
* [ ] Upstream 4xx ditangani.
* [ ] Upstream 5xx ditangani.
* [ ] CORS dapat dikonfigurasi.
* [ ] Target upstream tidak dapat diubah menjadi arbitrary URL oleh client.
* [ ] Basic abuse protection tersedia sebelum production.

---

# 18. Success Metrics

### Reliability

Target:

```text
≥ 99% successful proxy requests
```

tidak termasuk error yang memang berasal dari upstream.

### Security

Target:

```text
0 exposed API keys
0 unrestricted arbitrary-upstream requests
```

### Performance

Proxy overhead ideal:

```text
< 500 ms
```

di luar latency upstream.

---

# 19. Future Development

Versi berikutnya dapat menambahkan:

```text
v1.1
├── Rate limiting
├── Request ID
└── Better logging

v1.2
├── Multiple upstream providers
├── Provider routing
└── Automatic fallback

v1.3
├── Usage dashboard
├── API key management
└── Per-client quotas
```

---

# 20. Final Architecture

```text
                    ┌─────────────────┐
                    │     Client      │
                    │  / 9Router      │
                    └────────┬────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │       Vercel        │
                  │    API Proxy        │
                  ├─────────────────────┤
                  │ Authentication      │
                  │ Header Processing   │
                  │ Rate Limiting       │
                  │ Request Validation  │
                  │ Timeout Handling     │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │     Target API      │
                  │   AI/API Provider   │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │    Vercel Proxy     │
                  │  Response Handling  │
                  └──────────┬──────────┘
                             │
                             ▼
                       Client / 9Router
```

**MVP principle:** jangan bikin proxy terlalu pintar dulu. Fokus pertama adalah **forward request → upstream → return response**, lalu tambahkan authentication, security, rate limit, dan observability secara bertahap.
