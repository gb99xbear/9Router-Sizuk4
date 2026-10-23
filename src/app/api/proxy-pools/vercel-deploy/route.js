import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import { readFile } from "fs/promises";
import path from "path";

const VERCEL_API = "https://api.vercel.com";
// Default target utk relay pool THK (PRD SEC-02: fixed upstream allowlist)
const DEFAULT_TARGET = "https://tokenharbor.ai";

// Template files dibaca dari repo (folder templates/ ikut struktur PRD Bear)
const TEMPLATE_FILES = [
  "api/proxy.js",
  "api/health.js",
  "api/relay_ip.js",
  "lib/headers.js",
  "lib/upstream.js",
  "lib/security.js",
  "package.json",
  "vercel.json",
];

async function loadTemplateFiles() {
  const base = path.join(process.cwd(), "src/app/api/proxy-pools/vercel-deploy/templates");
  const out = [];
  for (const rel of TEMPLATE_FILES) {
    const data = await readFile(path.join(base, rel), "utf8");
    out.push({ file: rel, data });
  }
  return out;
}

async function pollDeployment(deploymentId, token, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.readyState === "READY") return data;
    if (data.readyState === "ERROR" || data.readyState === "CANCELED") {
      throw new Error(`Deployment failed: ${data.readyState}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Deployment timed out");
}

async function vercelPost(token, pathname, body) {
  const res = await fetch(`${VERCEL_API}${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `${pathname} failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Random suffix: <prefix>-<5char>-<index> (ikut gaya screenshot UI Bear)
function makeName(prefix, index) {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${rand}-${index}`;
}

/**
 * Deploy SATU relay mengikut PRD Bear:
 * 1. Create project  2. Set env TARGET_API_BASE_URL  3. Deploy template files
 * 4. Disable SSO protection  5. Poll READY  6. Register ke proxyPools
 */
async function deployOne(token, projectName, files, targetBaseUrl) {
  // 1. Create project (fallback v9 kalau v10 tak wujud)
  let project;
  try {
    project = await vercelPost(token, "/v10/projects", {
      name: projectName,
      framework: null,
    });
  } catch (e) {
    if (e.status === 404 || e.status === 405) {
      project = await vercelPost(token, "/v9/projects", {
        name: projectName,
        framework: null,
      });
    } else if (e.status === 409) {
      // Dah wujud - resolve id by name
      const res = await fetch(`${VERCEL_API}/v9/projects/${projectName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw e;
      project = await res.json();
    } else {
      throw e;
    }
  }
  const projectId = project.id || project.uid || projectName;

  // 2. Set env - WAJIB sebelum deployment supaya serverless snapshot ambil
  try {
    await vercelPost(token, `/v10/projects/${projectId}/env`, {
      key: "TARGET_API_BASE_URL",
      value: targetBaseUrl,
      target: ["production"],
      type: "plain",
    });
  } catch (e) {
    // 409 = env key dah wujud - ok je (nilai sama utk relay kita)
    if (e.status !== 409) throw e;
  }

  // 3. Deploy template files
  // (projectId TAK dibenarkan dalam /v13/deployments body - name unik auto-attach project)
  const deployment = await vercelPost(token, "/v13/deployments", {
    name: projectName,
    files,
    projectSettings: { framework: null },
    target: "production",
  });
  const deploymentId = deployment.id || deployment.uid;

  // 4. Disable deployment protection (Vercel Authentication)
  await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ssoProtection: null }),
  }).catch(() => {});

  // 5. Poll READY
  const ready = await pollDeployment(deploymentId, token);
  const deployUrl = `https://${ready.url}`;

  // 6. Register ke proxyPools (type vercel - connectionProxy.js faham relay)
  const proxyPool = await createProxyPool({
    name: projectName,
    proxyUrl: deployUrl,
    type: "vercel",
    noProxy: "",
    isActive: true,
    strictProxy: false,
  });

  return { name: projectName, deployUrl, poolId: proxyPool?.id || null };
}

// Worker pool: `count` tugas, serentak maksimum `workers`
async function runPool(count, workers, taskFn) {
  const results = new Array(count);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= count) return;
      try {
        results[i] = { ok: true, index: i, ...(await taskFn(i)) };
      } catch (e) {
        results[i] = { ok: false, index: i, error: e?.message || String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, count) }, worker));
  return results;
}

// POST /api/proxy-pools/vercel-deploy
// Body: { vercelToken, projectName?, count?, workers?, targetUrl? }
// - count default 1 (back-compat single deploy), max 100
// - workers default 10, max 10 (parallelism)
export async function POST(request) {
  try {
    const body = await request.json();
    const vercelToken = body.vercelToken;
    const prefix = (body.projectName || "").trim() || "vercel-relay";
    const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 100);
    const workers = Math.min(Math.max(parseInt(body.workers, 10) || 10, 1), 10);
    const targetBaseUrl = (body.targetUrl || "").trim() || DEFAULT_TARGET;

    if (!vercelToken) {
      return NextResponse.json({ error: "Vercel API token is required" }, { status: 400 });
    }
    // Validasi target format (PRD SEC-02)
    try {
      const u = new URL(targetBaseUrl);
      if (!/^https?:$/.test(u.protocol)) throw new Error("protocol");
    } catch {
      return NextResponse.json({ error: `Invalid targetUrl: ${targetBaseUrl}` }, { status: 400 });
    }

    const files = await loadTemplateFiles();
    const started = Date.now();
    const results = await runPool(count, workers, (i) =>
      deployOne(vercelToken, makeName(prefix, i + 1), files, targetBaseUrl)
    );

    const created = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // Single-deploy back-compat (client lama expect bentuk ni)
    if (count === 1 && created.length === 1) {
      return NextResponse.json(
        { proxyPool: { id: created[0].poolId }, deployUrl: created[0].deployUrl },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        total: count,
        created: created.length,
        failed: failed.length,
        workers,
        target: targetBaseUrl,
        elapsedMs: Date.now() - started,
        results,
        errors: failed.map((f) => ({ index: f.index, error: f.error })),
      },
      { status: created.length > 0 ? 201 : 500 }
    );
  } catch (error) {
    console.log("Error deploying Vercel relays:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}
