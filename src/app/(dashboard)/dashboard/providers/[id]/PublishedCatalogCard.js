"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button, Card, Input, Toggle } from "@/shared/components";

export default function PublishedCatalogCard({ providerId, candidates, hasActiveConnections }) {
  const [providerCatalogs, setProviderCatalogs] = useState({});
  const [selected, setSelected] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const [manualModelId, setManualModelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const candidateIds = useMemo(() => {
    const ids = new Set(candidates.map((candidate) => candidate.id));
    selected.forEach((id) => ids.add(id));
    return [...ids].sort((a, b) => a.localeCompare(b));
  }, [candidates, selected]);
  const filtered = candidateIds.filter((id) => id.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/provider-catalogs", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load published catalog");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const catalogs = data.providerCatalogs || {};
        const current = catalogs[providerId] || { enabled: false, modelIds: [] };
        setProviderCatalogs(catalogs);
        setEnabled(current.enabled === true);
        setSelected(Array.isArray(current.modelIds) ? current.modelIds : []);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [providerId]);

  const toggleModel = (id) => setSelected((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id]);

  const addManual = (event) => {
    event.preventDefault();
    const id = manualModelId.trim();
    if (!id) return;
    setSelected((current) => current.includes(id) ? current : [...current, id]);
    setManualModelId("");
  };

  const save = async () => {
    setSaving(true);
    setError("");
    const next = {
      ...providerCatalogs,
      [providerId]: { enabled, modelIds: selected },
    };
    try {
      const res = await fetch("/api/settings/provider-catalogs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerCatalogs: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save published catalog");
      setProviderCatalogs(data.providerCatalogs || next);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">publish</span>
            <h2 className="text-lg font-semibold">Published Model Catalog</h2>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Controls <code className="rounded bg-sidebar px-1 text-xs">/v1/models</code> when Global Catalog Whitelist is off.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{enabled ? "Publishing selected models" : "Legacy broadcast"}</span>
          <Toggle checked={enabled} onChange={setEnabled} disabled={loading} />
        </div>
      </div>

      {!hasActiveConnections && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
          This provider has no active connections. It will not appear in model discovery until it is switched on.
        </p>
      )}
      {enabled && selected.length === 0 && (
        <p className="mt-3 rounded-lg border border-border bg-sidebar/40 p-3 text-xs text-text-muted">
          No models selected - this provider publishes zero models.
        </p>
      )}
      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Selected ({selected.length})</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setSelected([])} disabled={selected.length === 0}>Clear</Button>
          <Button size="sm" onClick={save} loading={saving} disabled={loading} icon="save">Save catalog</Button>
        </div>
      </div>

      <div className="mt-3 flex min-h-[48px] flex-wrap gap-1.5 rounded-xl border border-border bg-sidebar/30 p-3">
        {selected.length === 0 ? <span className="self-center text-xs italic text-text-muted">No published models selected.</span> : selected.map((id) => (
          <button key={id} type="button" onClick={() => toggleModel(id)} className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 font-mono text-xs text-primary">
            {id}<span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        ))}
      </div>

      <form onSubmit={addManual} className="mt-4 flex gap-2">
        <Input value={manualModelId} onChange={(event) => setManualModelId(event.target.value)} placeholder="Add exact upstream model ID" className="flex-1 font-mono text-xs" />
        <Button size="sm" type="submit" icon="add" disabled={!manualModelId.trim()}>Add</Button>
      </form>

      <div className="mt-4 border-t border-border pt-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter model candidates" className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs focus:border-primary/50 focus:outline-none" />
        <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {filtered.map((id) => {
            const checked = selected.includes(id);
            return <button key={id} type="button" onClick={() => toggleModel(id)} className={`flex items-center justify-between rounded-lg border p-2 text-left font-mono text-xs ${checked ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-text-muted hover:bg-sidebar"}`}>
              <span className="truncate pr-2">{id}</span><span className="material-symbols-outlined text-[16px]">{checked ? "check_box" : "check_box_outline_blank"}</span>
            </button>;
          })}
          {filtered.length === 0 && <p className="col-span-full py-3 text-center text-xs text-text-muted">No candidates yet. Add an exact ID above.</p>}
        </div>
      </div>
    </Card>
  );
}

PublishedCatalogCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  candidates: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string.isRequired })).isRequired,
  hasActiveConnections: PropTypes.bool.isRequired,
};
