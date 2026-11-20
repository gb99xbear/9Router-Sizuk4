#!/usr/bin/env node
/**
 * selftest.js
 * ---------------------------------------------------------------------------
 * End-to-end checks with no external test runner.
 *
 *   node src/selftest.js            # offline checks (structure, ids, headers)
 *   node src/selftest.js --live     # also calls the real free gateway
 *
 * Exit code 0 = all passed, 1 = a failure.
 */

import assert from "node:assert/strict";
import http from "node:http";
import {
  newSessionId,
  newRequestId,
  stableSessionId,
  deriveRequestId,
  prepareChatBody,
  prepareResponsesBody,
  buildHeaders,
  endpointFor,
  workingModels,
  complete,
  SESSION_RE,
  REQUEST_RE,
} from "./opencode_free.js";
import { createServer } from "./adapter.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 ${name}\n      ${err.message}`);
  }
}

const LIVE = process.argv.includes("--live");

console.log("opencode-free-9router selftest\n");

await test("session id has the attested shape", () => {
  const id = newSessionId();
  assert.match(id, SESSION_RE);
});

await test("request id has the attested shape", () => {
  const id = newRequestId();
  assert.match(id, REQUEST_RE);
});

await test("stable session is reused per identity", () => {
  const a = stableSessionId("user-1");
  const b = stableSessionId("user-1");
  const c = stableSessionId("user-2");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

await test("request id is deterministic for the same turn", () => {
  const sess = stableSessionId("turn-user");
  const body = { messages: [{ role: "user", content: "hello world" }] };
  assert.equal(deriveRequestId(sess, body), deriveRequestId(sess, body));
});

await test("chat body gets the fingerprint tool quartet + stream", () => {
  const body = prepareChatBody("big-pickle", { messages: [{ role: "user", content: "hi" }] });
  assert.equal(body.stream, true);
  const names = body.tools.map((t) => t.function.name);
  for (const n of ["bash", "glob", "grep", "read"]) assert.ok(names.includes(n), `missing ${n}`);
});

await test("responses body gets the flat tool quartet", () => {
  const body = prepareResponsesBody("muse-spark-1.3-contributor-free", {
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  const names = body.tools.map((t) => t.name);
  for (const n of ["bash", "glob", "grep", "read"]) assert.ok(names.includes(n));
});

await test("headers carry the attestation", () => {
  const headers = buildHeaders({ model: "big-pickle", body: { messages: [] } });
  assert.equal(headers.Authorization, "Bearer public");
  assert.match(headers["User-Agent"], /^opencode\/\d+\.\d+/);
  assert.equal(headers["x-opencode-client"], "desktop");
  assert.match(headers["x-opencode-session"], SESSION_RE);
  assert.match(headers["x-opencode-request"], REQUEST_RE);
});

await test("endpoint routing: current models use chat completions", () => {
  assert.match(endpointFor("big-pickle"), /\/chat\/completions$/);
  assert.match(endpointFor("beam-free"), /\/chat\/completions$/);
});


await test("working model set is non-empty", () => {
  assert.ok(workingModels().length >= 8);
});

await test("adapter serves /v1/models and /health", async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(health.status, "ok");
    const models = await fetch(`${base}/v1/models`).then((r) => r.json());
    assert.equal(models.object, "list");
    assert.ok(models.data.length >= 8);
  } finally {
    server.close();
  }
});

await test("adapter 404s unknown routes", async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

if (LIVE) {
  console.log("\nlive upstream checks (this calls opencode.ai):\n");
  for (const model of workingModels()) {
    await test(`live: ${model}`, async () => {
      const out = await complete(model, {
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 32,
      });
      const text = out.choices?.[0]?.message?.content || "";
      assert.ok(typeof text === "string" && text.length >= 0);
      console.log(`      ${model} -> ${JSON.stringify(text.slice(0, 60))}`);
    });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
