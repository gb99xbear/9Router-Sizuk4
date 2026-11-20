import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { parseJson, stringifyJson } from "@/lib/db/helpers/jsonCol.js";

const customKey = (providerAlias, id, type) => `${providerAlias}|${id}|${type}`;

/**
 * POST /api/models/custom/batch
 * Body: { providerAlias, models: [{ id, type?, name?, caps? }], replace?: bool }
 *
 * One request for the whole import instead of one per model. Inserts run in a
 * single transaction, so 100 models cost one round-trip and one commit.
 * With replace:true, existing rows for that provider are cleared first
 * (that is the "replace the whole list" path).
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { providerAlias, models, replace } = body || {};
    if (!providerAlias || !Array.isArray(models)) {
      return NextResponse.json(
        { error: "providerAlias and models[] required" }, { status: 400 });
    }

    const db = await getAdapter();
    let added = 0, updated = 0;

    db.transaction(() => {
      if (replace) {
        db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key LIKE ?`,
               [`${providerAlias}|%`]);
      }
      for (const m of models) {
        const id = m?.id || m?.name || m?.model;
        if (!id) continue;
        const type = m?.type || "llm";
        const k = customKey(providerAlias, id, type);
        const row = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
        if (row) {
          const prev = parseJson(row.value) || {};
          const next = { ...prev, ...(m?.name ? { name: m.name } : {}), ...(m?.caps ? { caps: m.caps } : {}) };
          db.run(`UPDATE kv SET value = ? WHERE scope = 'customModels' AND key = ?`,
                 [stringifyJson(next), k]);
          updated += 1;
        } else {
          const value = stringifyJson({
            providerAlias, id, type, name: m?.name || id, ...(m?.caps ? { caps: m.caps } : {}),
          });
          db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
          added += 1;
        }
      }
    });

    return NextResponse.json({ success: true, added, updated });
  } catch (error) {
    console.log("Error batch adding custom models:", error);
    return NextResponse.json({ error: "Failed to batch add custom models" }, { status: 500 });
  }
}

/**
 * DELETE /api/models/custom/batch
 * Body: { providerAlias, ids?: [..], all?: bool, aliases?: [..] }
 *
 * One request deletes the whole list. `all:true` wipes every custom model for
 * the provider; `ids` wipes a subset; `aliases` clears modelAliases rows in the
 * same transaction.
 */
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { providerAlias, ids, all, aliases } = body || {};
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }

    const db = await getAdapter();
    let removed = 0, aliasRemoved = 0;

    db.transaction(() => {
      if (all) {
        const before = db.get(
          `SELECT COUNT(*) AS n FROM kv WHERE scope='customModels' AND key LIKE ?`,
          [`${providerAlias}|%`]);
        db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key LIKE ?`,
               [`${providerAlias}|%`]);
        removed += before?.n || 0;
      } else if (Array.isArray(ids)) {
        for (const id of ids) {
          if (!id) continue;
          for (const type of ["llm", "image", "webSearch"]) {
            const k = customKey(providerAlias, id, type);
            const row = db.get(`SELECT 1 FROM kv WHERE scope='customModels' AND key=?`, [k]);
            if (row) {
              db.run(`DELETE FROM kv WHERE scope='customModels' AND key=?`, [k]);
              removed += 1;
            }
          }
        }
      }
      if (Array.isArray(aliases)) {
        for (const a of aliases) {
          if (!a) continue;
          const row = db.get(`SELECT 1 FROM kv WHERE scope='modelAliases' AND key=?`, [a]);
          if (row) {
            db.run(`DELETE FROM kv WHERE scope='modelAliases' AND key=?`, [a]);
            aliasRemoved += 1;
          }
        }
      }
    });

    return NextResponse.json({ success: true, removed, aliasRemoved });
  } catch (error) {
    console.log("Error batch deleting custom models:", error);
    return NextResponse.json({ error: "Failed to batch delete custom models" }, { status: 500 });
  }
}
