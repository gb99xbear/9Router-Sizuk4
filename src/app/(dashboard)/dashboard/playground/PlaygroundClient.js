"use client";

import { useState, useEffect, useRef } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

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

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => {
        const list = Array.isArray(d) ? d : d.models || d.data || [];
        setModels(list);
        if (list.length > 0 && !testModel) {
          const gem = list.find((m) => m.id?.includes("gemini-3.8-flash")) || list[0];
          setTestModel(gem.id);
        }
      })
      .catch(() => {});

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
        body: JSON.stringify({
          model: testModel,
          messages: payloadMessages,
          stream: false,
          max_tokens: 300,
        }),
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
              Model
              <select
                value={testModel}
                onChange={(e) => setTestModel(e.target.value)}
                disabled={testBusy}
                className="rounded-[8px] border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main focus:outline-none focus:border-primary"
              >
                <option value="">- pilih model -</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
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

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <Button onClick={runTest} disabled={testBusy || !testModel}>
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
