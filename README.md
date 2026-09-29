# ⚡ 9Router Sizuk4 Edition

> High-Performance Universal AI API Gateway with Native Multi-Upstream Routing, Proxy Pool Circuit Breakers, DeepSeek PoW Web Solver, and Dual-Engine Persona Fusion.

Built & maintained by **[gb99xbear](https://github.com/gb99xbear)** & **Sizuk4**.

---

## ✨ Key Features

- 🔀 **Multi-Upstream Routing & Dynamic Load Balancing**: Seamlessly orchestrate OpenAI, Gemini, Claude, Grok, DeepSeek, Antigravity, Kiro, Freebuff, and OpenAI-compatible endpoints with auto-failover and zero-downtime routing.
- 🛡️ **Advanced Proxy Pool & Circuit Breakers**: Built-in HTTP/SOCKS5 proxy pool rotation with live health checks, automated isolation of dead nodes, and strict egress routing (Cloudflare Workers, Vercel Relays, BrightData Canary).
- 🧩 **DeepSeek Web PoW Solver**: Native WebAssembly + CJS Proof-of-Work solver for robust direct scraping and headless execution.
- ⚡ **Connection Chat Probes**: Real-time internal latency and model availability probe engine () without touching external quota endpoints.
- 🎭 **Dual-Engine Fusion & Model Cascading**: Split high-complexity reasoning and persona synthesis across dual backends transparently.
- 📊 **Modern Real-Time Web Dashboard**: Clean Next.js dashboard featuring catalog whitelisting, live token usage analytics, proxy monitors, and provider management.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: >= 20.x
- **Package Manager**: npm <command>

Usage:

npm install        install all the dependencies in your project
npm install <foo>  add the <foo> dependency to your project
npm test           run this project's tests
npm run <foo>      run the script named <foo>
npm <command> -h   quick help on <command>
npm -l             display usage info for all commands
npm help <term>    search for help on <term>
npm help npm       more involved overview

All commands:

    access, adduser, approve-scripts, audit, bugs, cache, ci,
    completion, config, dedupe, deny-scripts, deprecate, diff,
    dist-tag, docs, doctor, edit, exec, explain, explore,
    find-dupes, fund, get, help, help-search, init, install,
    install-ci-test, install-scripts, install-test, link, ll,
    login, logout, ls, org, outdated, owner, pack, ping, pkg,
    prefix, profile, prune, publish, query, rebuild, repo,
    restart, root, run, sbom, search, set, shrinkwrap, stage,
    star, stars, start, stop, team, test, token, trust,
    undeprecate, uninstall, unpublish, unstar, update, version,
    view, whoami

Specify configs in the ini-formatted file:
    /home/ubuntu/.npmrc
or on the command line via: npm <command> --key=value

More configuration info: npm help config
Configuration fields: npm help 7 config

npm@11.19.0 /home/ubuntu/.hermes/node/lib/node_modules/npm /  /  / 

### 2. Installation

added 597 packages, and audited 598 packages in 36s

208 packages are looking for funding
  run `npm fund` for details

7 vulnerabilities (3 moderate, 3 high, 1 critical)

To address all issues, run:
  npm audit fix

Run `npm audit` for details.

### 3. Environment Setup


Edit  to configure your admin credentials, database path, and server port.

### 4. Running the Gateway

> 9router-sizuk4@1.0.13 dev
> next dev --port 20127


> 9router-sizuk4@1.0.13 build
> next build --webpack


> 9router-sizuk4@1.0.13 start
> node custom-server.js --port 20127

---

## 🛠️ Architecture Overview



---

## 📄 License

MIT License. Developed with ❤️ by gb99xbear & Sizuk4.
