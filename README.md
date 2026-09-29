# ⚡ 9Router Sizuk4 Edition

> High-Performance Universal AI API Gateway with Native Multi-Upstream Routing, Proxy Pool Circuit Breakers, DeepSeek PoW Web Solver, and Dual-Engine Persona Fusion.

Built & maintained by **[gb99xbear](https://github.com/gb99xbear)** & **Sizuk4**.

---

## ✨ Key Features

- 🔀 **Multi-Upstream Routing & Dynamic Load Balancing**: Seamlessly orchestrate OpenAI, Gemini, Claude, Grok, DeepSeek, Antigravity, Kiro, Freebuff, and OpenAI-compatible endpoints with auto-failover and zero-downtime routing.
- 🛡️ **Advanced Proxy Pool & Circuit Breakers**: Built-in HTTP/SOCKS5 proxy pool rotation with live health checks, automated isolation of dead nodes, and strict egress routing (Cloudflare Workers, Vercel Relays, BrightData Canary).
- 🧩 **DeepSeek Web PoW Solver**: Native WebAssembly + CJS Proof-of-Work solver for robust direct scraping and headless execution.
- ⚡ **Connection Chat Probes**: Real-time internal latency and model availability probe engine without touching external quota endpoints.
- 🎭 **Dual-Engine Fusion & Model Cascading**: Split high-complexity reasoning and persona synthesis across dual backends transparently.
- 📊 **Modern Real-Time Web Dashboard**: Clean Next.js dashboard featuring catalog whitelisting, live token usage analytics, proxy monitors, and provider management.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: >= 20.x
- **Package Manager**: npm / pnpm / yarn / bun

### 2. Installation
```bash
git clone https://github.com/gb99xbear/9Router-Sizuk4.git
cd 9Router-Sizuk4
npm install
```

### 3. Environment Setup
```bash
cp .env.example .env
```

Edit \`.env\` to configure your admin credentials, database path, and server port.

### 4. Running the Gateway
```bash
# Development mode
npm run dev

# Production build & start
npm run build
npm start
```

---

## 📄 License

MIT License. Developed with ❤️ by gb99xbear & Sizuk4.
