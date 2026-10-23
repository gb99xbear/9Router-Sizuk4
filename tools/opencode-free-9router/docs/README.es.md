<div align="center">

<img src="../assets/logo.svg" width="128" alt="logo de opencode-free-9router" />

# opencode-free-9router

**Expón los modelos gratuitos de OpenCode Zen como un único proveedor compatible con OpenAI para 9Router.**
Sin cuenta de OpenCode, sin API key, sin suscripción — solo un adaptador local.

Modelos gratis · cliente free-tier atestiguado · compatible con OpenAI · cero dependencias

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](../LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](../package.json)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-6ea8fe?style=flat-square)](https://platform.openai.com/docs/api-reference/chat)
[![9Router](https://img.shields.io/badge/integrates-9Router-8b5cf6?style=flat-square)](https://9router.com)
[![OpenCode](https://img.shields.io/badge/upstream-opencode.ai-18181b?style=flat-square)](https://opencode.ai)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](https://github.com/0xgetz/opencode-free-9router/pulls)

[English](../README.md) · [Indonesia](README.id.md) · [Español](README.es.md) · [日本語](README.ja.md) · [中文](README.zh.md)

</div>

---

## Qué es

OpenCode incluye un **free tier**: once modelos que puedes usar sin coste. Pero el acceso está
restringido: la puerta de enlace responde `403 FreeTierError: "OpenCode's free tier can only be
used from within OpenCode"` a menos que la petición lleve la huella del cliente oficial.

`opencode-free-9router` reproduce esa huella en un pequeño adaptador local, de modo que **9Router
—y todo lo que apunte a 9Router— puede llamar a estos modelos gratis.**

```
Cliente OpenAI ──▶ 9Router :20128/v1 ──▶ provider-node "OpenCode Free"
               ──▶ adaptador :8790/v1 ──▶ opencode.ai/zen/v1  (Bearer public + atestación)
```

> Consulta **[STRUCTURE.md](../STRUCTURE.md)** para la topología completa, el mapa de archivos y los diagramas de flujo.

---

## Los modelos gratuitos

Once modelos verificados de extremo a extremo. El conjunto gratuito rota: los modelos viejos se deprecan y aparecen nuevos, así que ejecuta `node src/cli.js check` cuando quieras.

| Modelo | Contexto | Salida | Entrada | Notas |
|--------|----------|--------|---------|-------|
| `beam-free` | 1M | 128K | text | MoE reasoning, 23B activos |
| `big-pickle` | 200K | 32K | text | razonamiento general |
| `cat-jam-free` | 1M | 128K | text | coding + JSON estructurado |
| `deepseek-v4.1-flash-free` | 200K | 32K | text, image | DeepSeek V4.1 Flash |
| `glm-5.3-flash-free` | 200K | 32K | text, image, video, pdf | GLM multimodal |
| `longcat-2.5-preview-free` | 1M | 128K | text | contexto largo |
| `mimo-v2.6-flash-free` | 200K | 32K | text | flash compacto |
| `nemotron-3-ultra-free` | 1M | 128K | text | modelo grande |
| `nemotron-3.5-lightning-free` | 262K | 262K | text | baja latencia |
| `nemotron-3.5-super-vl-free` | 1M | 128K | text, image | NVIDIA vision-language |
| `space-bunny-free` | 1M | 512K | text | salida grande |

Todos usan `POST /chat/completions`.

**Sin servicio ahora** (anunciados en el catálogo de la puerta de enlace, pero obsoletos, no disponibles o con otro protocolo): `exo-free`, `fledge-alpha-free`, `ling-3.0-flash-fin-free`, `ling-3.1-flash-free`, `muse-spark-1.2-contributor-free`, `muse-spark-1.3-contributor-free`, `step-5-preview-free`. Tampoco se proxifica: `jev-1.13-free` (protocolo SystemOne, manejado nativamente por 9Router).

---

## Inicio rápido

Requiere **Node.js >= 18**. No hay nada que instalar — cero dependencias.

```bash
git clone https://github.com/0xgetz/opencode-free-9router.git
cd opencode-free-9router

# 1. inicia el adaptador (http://127.0.0.1:8790/v1)
node src/adapter.js

# 2. en otra terminal, regístralo en 9Router (9Router debe estar activo)
node src/connect-9router.js
```

Listo. En 9Router el proveedor **OpenCode Free** ya lista once modelos.

### Prueba un modelo directamente

```bash
node src/cli.js ask big-pickle "Explica los closures en una línea"
node src/cli.js check          # prueba en vivo cada modelo
```

### Llama al adaptador como cualquier API de OpenAI

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"space-bunny-free","messages":[{"role":"user","content":"hola"}]}'
```

---

## Cómo funciona el gate del free tier

La puerta de enlace solo sirve los modelos gratuitos a quien cree que es el cliente de OpenCode.
El adaptador envía la huella atestiguada exacta:

| Señal | Valor |
|-------|-------|
| `User-Agent` | `opencode/<versión>` (versión >= 1.17) |
| `x-opencode-client` | `desktop` |
| `x-opencode-session` | `ses_<12 hex><14 base62>` — un id estable por identidad |
| `x-opencode-request` | `msg_<12 hex><14 base62>` — un id estable por turno |
| `Authorization` | `Bearer public` |
| `stream` (body) | `true` — las peticiones sin streaming se rechazan |
| `tools` (body) | `bash`, `glob`, `grep`, `read` — el cuarteto de huella |

Todo vive en [`src/opencode_free.js`](../src/opencode_free.js) y está cubierto por `node src/selftest.js`.

---

## Estructura del proyecto

```
opencode-free-9router/
├── src/
│   ├── opencode_free.js     # atestación, ids, shaping, complete()
│   ├── adapter.js           # servidor HTTP compatible con OpenAI (:8790/v1)
│   ├── connect-9router.js   # registra el proveedor en 9Router
│   ├── cli.js               # list / ask / check
│   └── selftest.js          # pruebas offline + --live
├── docs/                    # READMEs traducidos
├── assets/                  # logo + social preview
└── STRUCTURE.md             # topología, mapa de archivos, diagramas
```

---

## Pruebas

```bash
npm test              # offline: 11 comprobaciones, sin red
npm run test:live     # además llama a cada modelo gratis (lento)
```

---

## Notas de 9Router

`connect-9router.js` habla con un 9Router local en `http://127.0.0.1:20128`. Cámbialo con:

| Variable | Por defecto | Significado |
|----------|-------------|-------------|
| `ROUTER_URL` | `http://127.0.0.1:20128` | URL base de 9Router |
| `ADAPTER_URL` | `http://127.0.0.1:8790/v1` | URL base de este adaptador |
| `ADAPTER_API_KEY` | `sk-opencode-free` | clave que espera el adaptador |
| `PROVIDER_NAME` | `OpenCode Free` | nombre en el panel de 9Router |
| `INITIAL_PASSWORD` | `123456` | contraseña de 9Router si está configurada |

---

## Legal y uso justo

Este proyecto es **no oficial** y no está afiliado a OpenCode ni a 9Router. Usa el free tier igual
que el cliente de OpenCode. Los free tiers tienen límites y cambian sin aviso — respeta los términos
del servicio upstream, mantén un volumen de peticiones razonable y no revendas el acceso. Úsalo bajo
tu propio riesgo.

---

## Licencia

[MIT](../LICENSE) © 2026 0xgetz
