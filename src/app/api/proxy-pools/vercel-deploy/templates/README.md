# Vercel API Proxy

A secure, high-performance, serverless HTTP/HTTPS reverse proxy built for Vercel Serverless Functions.

## 🚀 Features

- **Transparent Forwarding**: Supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- **API Key Injection**: Server-side secret key injection via environment variables (`TARGET_API_KEY`).
- **Header Protection**: Whitelists safe headers and strips internal hop-by-hop headers.
- **CORS Configurable**: Configurable origin controls (`ALLOWED_ORIGINS`).
- **Timeout Protection**: Configurable upstream timeout (`PROXY_TIMEOUT_MS`).
- **Rate Limiting**: Built-in rate limiting protection (`RATE_LIMIT_ENABLED`).
- **Health Check**: Health endpoint at `/api/health`.

---

## 🛠️ Environment Variables

Configure these variables in your Vercel Project Settings or local `.env` file:

| Variable | Required | Default | Description |
|---|---|---|---|
| `TARGET_API_BASE_URL` | **Yes** | - | Base URL of the target API (e.g. `https://api.openai.com`) |
| `TARGET_API_KEY` | No | - | Server-side secret key injected as `Authorization: Bearer <KEY>` |
| `ALLOWED_ORIGINS` | No | `*` | Allowed origins for CORS headers |
| `PROXY_TIMEOUT_MS` | No | `30000` | Upstream request timeout in milliseconds |
| `RATE_LIMIT_ENABLED` | No | `true` | Enables or disables rate limiting (`true` / `false`) |

---

## 💻 Local Development

1. Install Vercel CLI (if not already installed):
```bash
npm install -g vercel
```

2. Run local dev server:
```bash
vercel dev
```

---

## 🚀 Production Deployment

Deploy directly to Vercel using the Vercel CLI:

```bash
vercel --prod
```

Or connect the repository to your Vercel Dashboard for continuous deployment.

---

## 📖 Usage Examples

### 1. Health Check
```http
GET /api/health
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "service": "vercel-api-proxy"
}
```

### 2. Forwarding Requests

Client sends request to proxy:
```http
POST https://your-proxy.vercel.app/api/proxy/v1/chat/completions
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [{ "role": "user", "content": "Hello!" }]
}
```

Proxy forwards upstream to:
```http
POST https://TARGET_API_BASE_URL/v1/chat/completions
Authorization: Bearer <TARGET_API_KEY>
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [{ "role": "user", "content": "Hello!" }]
}
```
