<div align="center">

<img src="../assets/logo.svg" width="128" alt="opencode-free-9router ロゴ" />

# opencode-free-9router

**OpenCode Zen の無料モデルを、9Router 用の OpenAI 互換プロバイダーとして公開します。**
OpenCode アカウント・API キー・サブスクリプションは不要 — ローカルアダプターだけ。

無料モデル · 認証済み free-tier クライアント · OpenAI 互換 · 依存ゼロ

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

## 概要

OpenCode には **無料枠（free tier）** があり、11 個のモデルを無料で使えます。ただしアクセスは
制限されています。公式クライアントのフィンガープリントを持たないリクエストには、ゲートウェイが
`403 FreeTierError: "OpenCode's free tier can only be used from within OpenCode"` を返します。

`opencode-free-9router` はそのフィンガープリントを小さなローカルアダプターで再現し、
**9Router — そして 9Router を指すあらゆるツール — からこれらのモデルを無料で呼び出せるようにします。**

```
OpenAI クライアント ──▶ 9Router :20128/v1 ──▶ provider-node "OpenCode Free"
                  ──▶ アダプター :8790/v1 ──▶ opencode.ai/zen/v1  (Bearer public + 認証)
```

> トポロジー・ファイル構成・データフロー図は **[STRUCTURE.md](../STRUCTURE.md)** を参照してください。

---

## 無料モデル

11 個のモデルがエンドツーエンドで検証済みです。2 つのエンドポイント系統を使います。

11 個のモデルがエンドツーエンドで検証済みです。無料セットは入れ替わります — 旧モデルは非推奨になり新モデルが現れるので、`node src/cli.js check` をいつでも実行してください。

| モデル | コンテキスト | 出力 | 入力 | 備考 |
|--------|--------------|------|------|------|
| `beam-free` | 1M | 128K | text | MoE reasoning, 23B アクティブ |
| `big-pickle` | 200K | 32K | text | 汎用推論 |
| `cat-jam-free` | 1M | 128K | text | コーディング + 構造化 JSON |
| `deepseek-v4.1-flash-free` | 200K | 32K | text, image | DeepSeek V4.1 Flash |
| `glm-5.3-flash-free` | 200K | 32K | text, image, video, pdf | GLM マルチモーダル |
| `longcat-2.5-preview-free` | 1M | 128K | text | ロングコンテキスト |
| `mimo-v2.6-flash-free` | 200K | 32K | text | 軽量フラッシュ |
| `nemotron-3-ultra-free` | 1M | 128K | text | 大型モデル |
| `nemotron-3.5-lightning-free` | 262K | 262K | text | 低レイテンシ |
| `nemotron-3.5-super-vl-free` | 1M | 128K | text, image | NVIDIA vision-language |
| `space-bunny-free` | 1M | 512K | text | 大出力 |

すべて `POST /chat/completions` を使用します。

**現在サービス停止中**（ゲートウェイのカタログには載っていますが、非推奨・利用不可・別プロトコル）: `exo-free`, `fledge-alpha-free`, `ling-3.0-flash-fin-free`, `ling-3.1-flash-free`, `muse-spark-1.2-contributor-free`, `muse-spark-1.3-contributor-free`, `step-5-preview-free`。プロキシ対象外: `jev-1.13-free`（SystemOne プロトコル、9Router がネイティブ対応）。

---

## クイックスタート

**Node.js >= 18** が必要です。インストールは不要 — 依存ゼロです。

```bash
git clone https://github.com/0xgetz/opencode-free-9router.git
cd opencode-free-9router

# 1. アダプターを起動（http://127.0.0.1:8790/v1）
node src/adapter.js

# 2. 別シェルで 9Router に登録（9Router が起動している必要があります）
node src/connect-9router.js
```

これだけです。9Router のプロバイダー **OpenCode Free** に 11 個のモデルが並びます。

### モデルを直接試す

```bash
node src/cli.js ask big-pickle "クロージャを一行で説明して"
node src/cli.js check          # すべてのモデルをライブ検証
```

### 通常の OpenAI API として呼ぶ

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"space-bunny-free","messages":[{"role":"user","content":"こんにちは"}]}'
```

---

## free tier ゲートの仕組み

ゲートウェイは、OpenCode クライアントだと判断した相手にだけ無料モデルを提供します。アダプターは
認証済みフィンガープリントを正確に送信します:

| シグナル | 値 |
|----------|-----|
| `User-Agent` | `opencode/<version>`（version >= 1.17） |
| `x-opencode-client` | `desktop` |
| `x-opencode-session` | `ses_<12 hex><14 base62>` — アイデンティティごとに 1 つの安定 ID |
| `x-opencode-request` | `msg_<12 hex><14 base62>` — ターンごとに 1 つの安定 ID |
| `Authorization` | `Bearer public` |
| `stream`（body） | `true` — 非ストリーミングは拒否されます |
| `tools`（body） | `bash`, `glob`, `grep`, `read` — フィンガープリント quartet |

すべて [`src/opencode_free.js`](../src/opencode_free.js) にあり、`node src/selftest.js` で検証されます。

---

## プロジェクト構成

```
opencode-free-9router/
├── src/
│   ├── opencode_free.js     # 認証、ID、整形、complete()
│   ├── adapter.js           # OpenAI 互換 HTTP サーバー (:8790/v1)
│   ├── connect-9router.js   # 9Router にプロバイダー登録
│   ├── cli.js               # list / ask / check
│   └── selftest.js          # オフライン + --live 検証
├── docs/                    # 翻訳 README
├── assets/                  # ロゴ + ソーシャルプレビュー
└── STRUCTURE.md             # トポロジー、ファイル構成、図
```

---

## テスト

```bash
npm test              # オフライン: 11 チェック、ネットワーク不要
npm run test:live     # すべての無料モデルを呼び出し（低速）
```

---

## 9Router の設定

`connect-9router.js` はローカルの 9Router（`http://127.0.0.1:20128`）と通信します。変更は:

| 変数 | 既定値 | 意味 |
|------|--------|------|
| `ROUTER_URL` | `http://127.0.0.1:20128` | 9Router のベース URL |
| `ADAPTER_URL` | `http://127.0.0.1:8790/v1` | このアダプターのベース URL |
| `ADAPTER_API_KEY` | `sk-opencode-free` | アダプターが期待するキー |
| `PROVIDER_NAME` | `OpenCode Free` | 9Router ダッシュボードの表示名 |
| `INITIAL_PASSWORD` | `123456` | 9Router のログインパスワード（設定時） |

---

## 法的注意と公正利用

本プロジェクトは**非公式**であり、OpenCode および 9Router と提携していません。OpenCode クライアント
と同じように free tier を利用します。free tier には制限があり予告なく変更されます。上流の利用規約を
守り、リクエスト量を常識的な範囲に保ち、アクセスを再販しないでください。自己責任で使用してください。

---

## ライセンス

[MIT](../LICENSE) © 2026 0xgetz
