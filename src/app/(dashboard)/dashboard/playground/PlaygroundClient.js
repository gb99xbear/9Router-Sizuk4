"use client";

import { useState, useEffect, useRef } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

// Kelas warna badge verdict untuk capability-test tool loop.
const VERDICT_CLASS = new Map([
  ["PASS", "text-green-500"],
  ["PARTIAL", "text-amber-500"],
  ["FAIL", "text-red-500"],
  ["ERROR", "text-red-500"],
]);

const NEUTRAL_VERDICT_CLASS = "text-text-muted";

// Warna teks untuk verdict. Verdict tak dikenali dapat warna neutral.
export function verdictColor(verdict) {
  return VERDICT_CLASS.get(verdict) || NEUTRAL_VERDICT_CLASS;
}

const TRUNCATION_SUFFIX = " ... (dipotong)";

// Potong nilai panjang untuk paparan trace. String(value) dipakai supaya
// Symbol, BigInt, objek circular, null dan undefined tak pernah melontar.
export function truncateForDisplay(value, limit = 2000) {
  let text;
  try {
    text = typeof value === "string" ? value : String(value);
  } catch {
    text = "";
  }
  if (text.length > limit) {
    return { text: text.slice(0, limit) + TRUNCATION_SUFFIX, truncated: true };
  }
  return { text, truncated: false };
}

// Paparan nilai trace. Backend hantar `arguments` sebagai JSON string dan
// `result` sebagai objek ({ ok, content, error }), jadi string dibiar as-is
// (elak double-encode) dan objek dijadikan JSON pretty. Nilai yang tak boleh
// di-JSON-kan (circular, BigInt, Symbol) jatuh balik ke String(value).
export function formatTraceValue(value) {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value, null, 2);
    if (typeof json === "string") return json;
  } catch {}
  try {
    return String(value);
  } catch {
    return "";
  }
}

// Body POST untuk /api/playground/agent (capability test, read-only).
export function buildAgentRequest({ model, messages } = {}) {
  if (!model) throw new Error("model is required");
  return { model, messages, capabilityTest: true };
}

export default function PlaygroundClient() {
  const [models, setModels] = useState([]);
  const [testModel, setTestModel] = useState("");
  const [testKey, setTestKey] = useState("");
  const [testScope, setTestScope] = useState("draft");
  const [testMode, setTestMode] = useState("single");
  const [testPrompt, setTestPrompt] = useState("");
  const [testUserMsg, setTestUserMsg] = useState("Siapa kau?");
  const [testScriptTurns, setTestScriptTurns] = useState([
    { role: "user", content: "Hai, tolong perkenalkan diri." },
    { role: "assistant", content: "Saya Alfred, butler peribadi Master Bear." },
  ]);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState(null);
  const [showPayload, setShowPayload] = useState(true);
  const [testTools, setTestTools] = useState("");
  const [useTools, setUseTools] = useState(false);
  const [agentTools, setAgentTools] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentResult, setAgentResult] = useState(null);
  const [showTrace, setShowTrace] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const mq = modelQuery.trim().toLowerCase();
  const filteredModels = mq
    ? models.filter((m) => ((m.display || "") + " " + m.id).toLowerCase().includes(mq))
    : models;

  useEffect(() => {
    (async () => {
      try {
        const [mres, nres] = await Promise.all([
          fetch("/api/models?activeOnly=true", { cache: "no-store" }),
          fetch("/api/provider-nodes", { cache: "no-store" }),
        ]);
        const mdata = await mres.json();
        const ndata = await nres.json();

        const nodeInfo = {};
        for (const n of (Array.isArray(ndata?.nodes) ? ndata.nodes : [])) {
          if (n?.id) nodeInfo[n.id] = { name: n.name, prefix: n.prefix };
        }

        const rawList = Array.isArray(mdata?.models) ? mdata.models : [];
        const seen = new Set();
        const list = [];

        for (const m of rawList) {
          const full = m.fullModel || m.model || m.id;
          if (!full) continue;
          
          const parts = full.split("/");
          const info = nodeInfo[m.provider] || {};
          let prefix = info.prefix || (parts.length > 1 ? parts[0] : (m.provider || "model"));
          let modelName = parts.length > 1 ? parts.slice(1).join("/") : full;
          
          // Bersihkan prefix jika ada nama provider panjang
          if (prefix.startsWith("openai-compatible-chat-") && prefix.endsWith("-node")) {
            prefix = prefix.replace("openai-compatible-chat-", "").replace("-node", "");
          }
          
          let displayModelName = m.name || modelName;
          if (prefix.includes("notion") && m.name && m.name !== modelName) {
            displayModelName = `${m.name} (${modelName})`;
          }
          const formattedId = `${prefix}/${modelName}`;
          if (seen.has(formattedId)) continue;
          seen.add(formattedId);

          list.push({
            id: formattedId,
            display: `${prefix}/${displayModelName}`,
            provider: info.name || prefix,
          });
        }

        // Susun mengikut abjad prefix kemudian nama model
        list.sort((a, b) => a.display.localeCompare(b.display));

                // Pastikan model sah Kiro Claude Sonnet & Haiku sentiasa ada dalam picker
        if (!list.some(m => m.id === "kr/claude-sonnet-4.5")) {
          list.push({ id: "kr/claude-sonnet-4.5", display: "kr/Claude Sonnet 4.5", provider: "Kiro AI" });
          list.push({ id: "kr/claude-haiku-4.5", display: "kr/Claude Haiku 4.5", provider: "Kiro AI" });
        }
        setModels(list);
        if (list.length > 0 && !testModel) {
          const gem = list.find((m) => m.id.includes("gemini-3.8-flash") || m.id.startsWith("ag/")) || list[0];
          setTestModel(gem.id);
        }
      } catch (err) {
        console.error("Gagal memuatkan senarai model:", err);
      }
    })();

    try {
      const k = localStorage.getItem("9r_tester_api_key") || "";
      setTestKey(k);
    } catch {}
  }, []);

  const saveTestKey = (v) => {
    setTestKey(v);
    try {
      localStorage.setItem("9r_tester_api_key", v);
    } catch {}
  };

  const buildPayload = () => {
    let msgs = [];
    if (testMode === "chat") {
      msgs = testScriptTurns.filter((t) => (t.content || "").trim().length > 0);
      msgs.push({ role: "user", content: testUserMsg });
    } else {
      if (testScope === "draft" && testPrompt.trim()) {
        msgs.push({ role: "system", content: testPrompt });
      }
      msgs.push({ role: "user", content: testUserMsg });
    }
    return msgs;
  };

  const runTest = async () => {
    if (!testModel) return;
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);

    const headers = { "Content-Type": "application/json" };
    if (testKey.trim()) {
      headers["Authorization"] = `Bearer ${testKey.trim()}`;
    }

    const payloadMessages = buildPayload();
    const t0 = performance.now();

    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers,
        body: (() => {
          const body = { model: testModel, messages: payloadMessages, stream: false, max_tokens: 300 };
          if (useTools && testTools.trim()) {
            try { body.tools = JSON.parse(testTools); } catch (e) { console.error("tools parse:", e); }
          }
          return JSON.stringify(body);
        })(),
      });

      const elapsed = Math.round(performance.now() - t0);
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        setTestError(`HTTP ${res.status}: ${data?.error?.message || data?.error || text}`);
      } else {
        const choice = data?.choices?.[0];
        const content = choice?.message?.content || JSON.stringify(data, null, 2);
        setTestResult({
          content,
          model: data?.model || testModel,
          ms: elapsed,
          usage: data?.usage,
        });
      }
    } catch (err) {
      setTestError(`Network error: ${err.message}`);
    } finally {
      setTestBusy(false);
    }
  };

  const runCapabilityTest = async () => {
    if (!agentTools || !testModel) return;
    setAgentBusy(true);
    setTestError(null);
    setAgentResult(null);
    setShowTrace(false);

    const headers = { "Content-Type": "application/json" };
    if (testKey.trim()) {
      headers["Authorization"] = `Bearer ${testKey.trim()}`;
    }

    try {
      const res = await fetch("/api/playground/agent", {
        method: "POST",
        headers,
        body: JSON.stringify(buildAgentRequest({ model: testModel, messages: buildPayload() })),
      });

      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        setTestError(`HTTP ${res.status}: ${data?.error?.message || data?.error || text}`);
      } else {
        setAgentResult({
          answer: data?.answer || "",
          verdict: data?.verdict || "ERROR",
          trace: Array.isArray(data?.trace) ? data.trace : [],
          challengeId: data?.challengeId,
        });
      }
    } catch (err) {
      setTestError(`Network error: ${err.message}`);
    } finally {
      setAgentBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2.5">
          <span className="material-symbols-outlined text-primary text-3xl">science</span>
          Playground
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Uji sebarang model terus melalui 9Router. Log masuk dashboard membenarkan akses terus tanpa perlu API key.
        </p>
      </div>

      <Card
        title="Interactive Prompt & Model Tester"
        subtitle="Kirim panggilan langsung ke LLM API dengan paparan latency dan usage sebenar."
        icon="psychology"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Model (cari)
              <input
                type="text"
                placeholder="Cari model... (cth: gemini, notion, agcli)"
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                disabled={testBusy}
                className="rounded-[8px] border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main focus:outline-none focus:border-primary"
              />
              <span className="text-[11px] font-mono text-text-muted break-all">
                dipilih: {testModel || "-"}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              API key (pilihan / auto-bypass jika logged in)
              <input
                type="password"
                placeholder="optional (auto-allowed if logged in)"
                value={testKey}
                onChange={(e) => saveTestKey(e.target.value)}
                disabled={testBusy}
                className="rounded-[8px] border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main focus:outline-none focus:border-primary"
              />
            </label>
          </div>

          <div className="rounded-[8px] border border-border bg-surface-2 overflow-hidden">
            <div className="max-h-56 overflow-y-auto">
              {filteredModels.slice(0, 80).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setTestModel(m.id); setModelQuery(""); }}
                  disabled={testBusy}
                  className={"w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-3 hover:bg-surface " + (m.id === testModel ? "bg-surface text-primary" : "text-text-main")}
                >
                  <span className="font-mono truncate">{m.display || m.id}</span>
                  <span className="text-[10px] text-text-muted shrink-0">{m.provider}</span>
                </button>
              ))}
              {filteredModels.length === 0 && (
                <div className="px-3 py-2 text-xs text-text-muted">Tiada model padan dgn carian tu.</div>
              )}
            </div>
            <div className="px-3 py-1.5 text-[11px] text-text-muted border-t border-border/50">
              {filteredModels.length} daripada {models.length} model{filteredModels.length > 80 ? " - tunjuk 80 pertama, taip lagi spesifik" : ""}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs pt-1 border-t border-border/50">
            <span className="text-text-muted font-medium">Mode:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="test-mode" checked={testMode === "single"} onChange={() => setTestMode("single")} disabled={testBusy} />
              System prompt tunggal
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="test-mode" checked={testMode === "chat"} onChange={() => setTestMode("chat")} disabled={testBusy} />
              Multi-turn chat script
            </label>
          </div>

          {testMode === "single" ? (
            <textarea
              rows={4}
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              disabled={testBusy}
              placeholder="System prompt untuk diuji (pilihan)..."
              className="w-full font-mono text-xs p-3 rounded-[8px] border border-border bg-surface-2 text-text-main focus:outline-none focus:border-primary"
            />
          ) : (
            <div className="space-y-2">
              {testScriptTurns.map((turn, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-20 text-[11px] font-mono text-text-muted capitalize">{turn.role}:</span>
                  <input
                    type="text"
                    value={turn.content}
                    onChange={(e) => {
                      const next = [...testScriptTurns];
                      next[idx].content = e.target.value;
                      setTestScriptTurns(next);
                    }}
                    className="flex-1 font-mono text-xs p-2 rounded-[6px] border border-border bg-surface text-text-main"
                  />
                  <button
                    onClick={() => setTestScriptTurns(testScriptTurns.filter((_, i) => i !== idx))}
                    className="text-xs text-red-500 hover:opacity-80 px-2"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setTestScriptTurns([...testScriptTurns, { role: "user", content: "" }])}>+ User</Button>
                <Button size="sm" variant="outline" onClick={() => setTestScriptTurns([...testScriptTurns, { role: "assistant", content: "" }])}>+ Assistant</Button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-text-muted mb-1 font-medium">Mesej Pengguna (Prompt User)</label>
            <textarea
              rows={3}
              value={testUserMsg}
              onChange={(e) => setTestUserMsg(e.target.value)}
              disabled={testBusy}
              className="w-full font-mono text-xs p-3 rounded-[8px] border border-border bg-surface text-text-main focus:outline-none focus:border-primary"
            />
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input type="checkbox" checked={useTools} onChange={(e) => setUseTools(e.target.checked)} disabled={testBusy} />
              Guna Tools (JSON array)
            </label>
            {useTools && (
              <textarea
                value={testTools}
                onChange={(e) => setTestTools(e.target.value)}
                disabled={testBusy}
                rows={8}
                placeholder='[{"type":"function","function":{"name":"get_weather","parameters":{"type":"object","properties":{}}}}]'
                className="w-full font-mono text-xs p-3 rounded-[8px] border border-border bg-surface text-text-main focus:outline-none focus:border-primary mt-2"
              />
            )}
          </div>

          <div className="pt-2 space-y-2">
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={agentTools}
                onChange={(e) => setAgentTools(e.target.checked)}
                disabled={testBusy || agentBusy}
              />
              Agent Tools (uji keupayaan tool, read-only)
            </label>
            <p className="text-[11px] text-text-muted">
              Hantar 2 tool ujian deterministik. Tiada akses fail, shell, rangkaian atau kredensial.
            </p>

            {agentTools && (
              <div className="space-y-3">
                <Button
                  onClick={runCapabilityTest}
                  disabled={!agentTools || !testModel || testBusy || agentBusy}
                >
                  {agentBusy ? "Menjalankan..." : "Jalankan Capability Test"}
                </Button>

                {agentResult && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-text-muted">
                      Tool loop: <span className={"font-mono font-semibold " + verdictColor(agentResult.verdict)}>{String(agentResult.verdict)}</span>
                    </div>

                    <button
                      type="button"
                      aria-expanded={showTrace}
                      onClick={() => setShowTrace(!showTrace)}
                      className="text-[11px] font-mono text-primary hover:opacity-80"
                    >
                      {showTrace ? "Sembunyi trace" : "Papar trace"}
                    </button>

                    {showTrace && (
                      <div className="rounded-[8px] border border-border/40 overflow-x-auto divide-y divide-border/40">
                        {agentResult.trace.length === 0 && (
                          <div className="px-3 py-2 font-mono text-[11px] text-text-muted">Trace kosong.</div>
                        )}
                        {agentResult.trace.map((entry, idx) => (
                          <div key={idx} className="px-3 py-2 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-text-muted">
                              <span>round {String(entry?.round)}</span>
                              <span>{String(entry?.type)}</span>
                              <span className="text-text-main">{String(entry?.toolName || entry?.detail || "")}</span>
                              <span>{String(entry?.status)}</span>
                              {entry?.durationMs != null && <span>{String(entry.durationMs)}ms</span>}
                            </div>
                            {entry?.arguments != null && (
                              <pre className="font-mono text-[11px] text-text-muted whitespace-pre-wrap break-all">
                                {truncateForDisplay(formatTraceValue(entry.arguments)).text}
                              </pre>
                            )}
                            {entry?.result != null && (
                              <pre className="font-mono text-[11px] text-text-muted whitespace-pre-wrap break-all border-t border-border/30 pt-1">
                                {truncateForDisplay(formatTraceValue(entry.result)).text}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {agentResult.answer && (
                      <div className="p-3 rounded-[10px] bg-surface-2 border border-border font-sans text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                        {String(agentResult.answer)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <Button onClick={runTest} disabled={testBusy || agentBusy || !testModel}>
                {testBusy ? "Menjana..." : "Jalan Test"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowPayload(!showPayload)}>
                {showPayload ? "Sembunyi Payload" : "Papar Payload"}
              </Button>
            </div>
            {testResult && (
              <span className="text-xs text-text-muted font-mono tabular-nums">
                {testResult.ms}ms · {testResult.usage?.total_tokens || 0} tokens
              </span>
            )}
          </div>

          {showPayload && (
            <div className="rounded-[8px] bg-black/40 p-3 font-mono text-[11px] text-text-muted overflow-x-auto border border-border/40">
              <div className="text-[10px] uppercase font-bold text-text-muted/60 mb-1">Payload Preview:</div>
              <pre>{JSON.stringify(buildPayload(), null, 2)}</pre>
            </div>
          )}

          {testError && (
            <div className="p-3 rounded-[8px] bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-mono">
              {testError}
            </div>
          )}

          {testResult && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-text-muted">
                <span>Jawapan daripada <code className="text-primary">{testResult.model}</code>:</span>
              </div>
              <div className="p-4 rounded-[10px] bg-surface-2 border border-border font-sans text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                {testResult.content}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
