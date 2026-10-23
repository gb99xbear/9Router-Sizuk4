<div align="center">

<img src="../assets/logo.svg" width="128" alt="opencode-free-9router 标志" />

# opencode-free-9router

**将 OpenCode Zen 免费模型作为 9Router 的一个 OpenAI 兼容提供者对外暴露。**
无需 OpenCode 账号、无需 API key、无需订阅 —— 只需一个本地适配器。

免费模型 · 已认证的 free-tier 客户端 · OpenAI 兼容 · 零依赖

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

## 这是什么

OpenCode 提供了 **免费额度（free tier）** —— 十一个零成本可用的模型。但访问受限：除非请求携带官方
客户端的指纹，否则网关会返回
`403 FreeTierError: "OpenCode's free tier can only be used from within OpenCode"`。

`opencode-free-9router` 在一个极小的本地适配器中复现该指纹，使 **9Router —— 以及任何指向
9Router 的工具 —— 都能免费调用这些模型。**

```
OpenAI 客户端 ──▶ 9Router :20128/v1 ──▶ provider-node "OpenCode Free"
            ──▶ 适配器 :8790/v1 ──▶ opencode.ai/zen/v1  (Bearer public + 认证)
```

> 完整拓扑、文件地图与数据流图见 **[STRUCTURE.md](../STRUCTURE.md)**。

---

## 免费模型

十一个模型已完成端到端验证。使用两类端点。

十一个模型已完成端到端验证。免费集合会轮换：旧模型弃用、新模型出现，随时运行 `node src/cli.js check`。

| 模型 | 上下文 | 输出 | 输入 | 说明 |
|------|--------|------|------|------|
| `beam-free` | 1M | 128K | text | MoE 推理，23B 激活 |
| `big-pickle` | 200K | 32K | text | 通用推理 |
| `cat-jam-free` | 1M | 128K | text | 编码 + 结构化 JSON |
| `deepseek-v4.1-flash-free` | 200K | 32K | text, image | DeepSeek V4.1 Flash |
| `glm-5.3-flash-free` | 200K | 32K | text, image, video, pdf | GLM 多模态 |
| `longcat-2.5-preview-free` | 1M | 128K | text | 长上下文 |
| `mimo-v2.6-flash-free` | 200K | 32K | text | 轻量 flash |
| `nemotron-3-ultra-free` | 1M | 128K | text | 大型模型 |
| `nemotron-3.5-lightning-free` | 262K | 262K | text | 低延迟 |
| `nemotron-3.5-super-vl-free` | 1M | 128K | text, image | NVIDIA 视觉语言 |
| `space-bunny-free` | 1M | 512K | text | 大输出 |

全部使用 `POST /chat/completions`。

**当前未提供服务**（网关目录仍列出，但已弃用、不可用或协议不同）：`exo-free`、`fledge-alpha-free`、`ling-3.0-flash-fin-free`、`ling-3.1-flash-free`、`muse-spark-1.2-contributor-free`、`muse-spark-1.3-contributor-free`、`step-5-preview-free`。不做代理：`jev-1.13-free`（SystemOne 协议，由 9Router 原生支持）。

---

## 快速开始

需要 **Node.js >= 18**。无需安装任何东西 —— 零依赖。

```bash
git clone https://github.com/0xgetz/opencode-free-9router.git
cd opencode-free-9router

# 1. 启动适配器（http://127.0.0.1:8790/v1）
node src/adapter.js

# 2. 在另一个终端注册到 9Router（9Router 需正在运行）
node src/connect-9router.js
```

完成。9Router 中提供者 **OpenCode Free** 现在会列出十一个模型。

### 直接试用模型

```bash
node src/cli.js ask big-pickle "用一句话解释闭包"
node src/cli.js check          # 实时探测每个模型
```

### 像普通 OpenAI API 一样调用

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"space-bunny-free","messages":[{"role":"user","content":"你好"}]}'
```

---

## free tier 网关如何工作

网关只向它认为是 OpenCode 客户端的请求提供免费模型。适配器精确发送已认证的指纹：

| 信号 | 值 |
|------|-----|
| `User-Agent` | `opencode/<版本>`（版本 >= 1.17） |
| `x-opencode-client` | `desktop` |
| `x-opencode-session` | `ses_<12 hex><14 base62>` —— 每个身份一个稳定 id |
| `x-opencode-request` | `msg_<12 hex><14 base62>` —— 每轮一个稳定 id |
| `Authorization` | `Bearer public` |
| `stream`（body） | `true` —— 非流式请求会被拒绝 |
| `tools`（body） | `bash`、`glob`、`grep`、`read` —— 指纹四件套 |

全部位于 [`src/opencode_free.js`](../src/opencode_free.js)，由 `node src/selftest.js` 覆盖。

---

## 项目结构

```
opencode-free-9router/
├── src/
│   ├── opencode_free.js     # 认证、id、请求整形、complete()
│   ├── adapter.js           # OpenAI 兼容 HTTP 服务器 (:8790/v1)
│   ├── connect-9router.js   # 在 9Router 注册提供者
│   ├── cli.js               # list / ask / check
│   └── selftest.js          # 离线 + --live 检查
├── docs/                    # 翻译版 README
├── assets/                  # logo + 社交预览
└── STRUCTURE.md             # 拓扑、文件地图、图示
```

---

## 测试

```bash
npm test              # 离线：11 项检查，无需网络
npm run test:live     # 同时调用每个免费模型（较慢）
```

---

## 9Router 说明

`connect-9router.js` 默认连接本机 9Router（`http://127.0.0.1:20128`）。可通过以下变量修改：

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `ROUTER_URL` | `http://127.0.0.1:20128` | 9Router 基础 URL |
| `ADAPTER_URL` | `http://127.0.0.1:8790/v1` | 本适配器基础 URL |
| `ADAPTER_API_KEY` | `sk-opencode-free` | 适配器期望的 key |
| `PROVIDER_NAME` | `OpenCode Free` | 9Router 面板显示的名称 |
| `INITIAL_PASSWORD` | `123456` | 9Router 登录密码（如已设置） |

---

## 法律与合理使用

本项目为**非官方**项目，与 OpenCode 和 9Router 均无关联。它像 OpenCode 客户端一样使用 free tier。
free tier 有额度限制且会随时变化 —— 请遵守上游服务条款，保持合理的请求量，且不要转售该访问权限。
使用风险自负。

---

## 许可证

[MIT](../LICENSE) © 2026 0xgetz
