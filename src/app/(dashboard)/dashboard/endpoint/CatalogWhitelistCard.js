"use client";
import { useState, useEffect } from "react";
import { Card, Button, Input, Toggle } from "@/shared/components";

function CatalogWhitelistCard({
  whitelistEnabled,
  whitelist,
  onToggleEnabled,
  onSaveWhitelist,
}) {
  const [availableModels, setAvailableModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [customModelInput, setCustomModelInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [isModified, setIsModified] = useState(false);

  useEffect(() => {
    setSelectedModels(Array.isArray(whitelist) ? [...whitelist] : []);
    setIsModified(false);
  }, [whitelist]);

  const loadAllModels = async () => {
    setLoadingModels(true);
    try {
      // Fetch models from active providers + custom models + active combos
      const [modelsRes, combosRes] = await Promise.all([
        fetch("/api/models?activeOnly=true").then(r => r.ok ? r.json() : { models: [] }),
        fetch("/api/combos").then(r => r.ok ? r.json() : { combos: [] })
      ]);
      
      const set = new Set();
      if (Array.isArray(modelsRes?.models)) {
        modelsRes.models.forEach(m => {
          if (m.routedModel) set.add(m.routedModel);
          if (m.fullModel) set.add(m.fullModel);
          if (m.alias) set.add(m.alias);
        });
      }
      if (Array.isArray(combosRes?.combos)) {
        combosRes.combos.forEach(c => {
          if (c.name) set.add(c.name);
        });
      }
      // Also include common prefix forms from currently selected
      (whitelist || []).forEach(m => set.add(m));

      setAvailableModels(Array.from(set).sort());
    } catch (e) {
      console.log("Failed to load models list:", e);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    loadAllModels();
  }, []);

  const handleToggleModel = (modelId) => {
    const next = selectedModels.includes(modelId)
      ? selectedModels.filter(m => m !== modelId)
      : [...selectedModels, modelId];
    setSelectedModels(next);
    setIsModified(true);
  };

  const handleAddCustomModel = (e) => {
    e.preventDefault();
    const val = customModelInput.trim();
    if (!val) return;
    if (!selectedModels.includes(val)) {
      setSelectedModels([...selectedModels, val]);
      if (!availableModels.includes(val)) {
        setAvailableModels([...availableModels, val].sort());
      }
      setIsModified(true);
    }
    setCustomModelInput("");
  };

  const handleRemoveModel = (modelId) => {
    setSelectedModels(selectedModels.filter(m => m !== modelId));
    setIsModified(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveWhitelist(selectedModels);
      setIsModified(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectAllFiltered = () => {
    const toAdd = filteredAvailable.filter(m => !selectedModels.includes(m));
    if (toAdd.length > 0) {
      setSelectedModels([...selectedModels, ...toAdd]);
      setIsModified(true);
    }
  };

  const handleClearAll = () => {
    setSelectedModels([]);
    setIsModified(true);
  };

  const filteredAvailable = availableModels.filter(m => 
    m.toLowerCase().includes(searchTerm.toLowerCase().trim())
  );

  return (
    <Card id="catalog-whitelist">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">filter_list</span>
            <h2 className="text-lg font-semibold">Model Catalog Whitelist</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
              Sizuk4 Edition
            </span>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Restrict <code className="text-xs bg-sidebar px-1 rounded">/v1/models</code> discovery to a curated list while preserving full direct routing.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{whitelistEnabled ? "Whitelist Active" : "Broadcast All"}</span>
          <Toggle
            checked={whitelistEnabled}
            onChange={onToggleEnabled}
          />
        </div>
      </div>

      {whitelistEnabled ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Curated Models ({selectedModels.length})</span>
              {isModified && (
                <span className="text-xs text-amber-500 font-medium">● Unsaved changes</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleClearAll}
                disabled={selectedModels.length === 0}
              >
                Clear All
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={handleSave}
                loading={saving}
                disabled={!isModified}
                icon="save"
              >
                Save Changes
              </Button>
            </div>
          </div>

          {/* Active Chips */}
          <div className="flex flex-wrap gap-1.5 p-3 rounded-xl border border-border bg-black/[0.02] dark:bg-white/[0.02] min-h-[50px] max-h-[160px] overflow-y-auto">
            {selectedModels.length === 0 ? (
              <span className="text-xs text-text-muted italic self-center">No models in whitelist yet. Add models below or toggle items in the list.</span>
            ) : (
              selectedModels.map(m => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono bg-primary/10 border border-primary/20 text-primary"
                >
                  {m}
                  <button
                    type="button"
                    onClick={() => handleRemoveModel(m)}
                    className="hover:text-red-500 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Quick Add Custom Model */}
          <form onSubmit={handleAddCustomModel} className="flex gap-2">
            <Input
              placeholder="e.g. ag/gemini-3.7-flash-medium or HermesCombo"
              value={customModelInput}
              onChange={(e) => setCustomModelInput(e.target.value)}
              className="flex-1 font-mono text-xs"
            />
            <Button size="sm" type="submit" icon="add" disabled={!customModelInput.trim()}>
              Add Model
            </Button>
          </form>

          {/* Model Selector & Filter */}
          <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex-1 max-w-sm">
                <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-[16px] pointer-events-none">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Filter available models..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full h-8 pl-7 pr-3 rounded-lg border border-border bg-surface text-xs focus:outline-none focus:border-primary/50"
                />
              </div>
              <div className="flex items-center gap-2">
                {searchTerm && (
                  <Button size="xs" variant="secondary" onClick={handleSelectAllFiltered}>
                    Add Filtered ({filteredAvailable.filter(m => !selectedModels.includes(m)).length})
                  </Button>
                )}
                <Button size="xs" variant="ghost" onClick={loadAllModels} loading={loadingModels} icon="refresh">
                  Refresh
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[260px] overflow-y-auto p-1">
              {filteredAvailable.map(modelId => {
                const isSelected = selectedModels.includes(modelId);
                return (
                  <div
                    key={modelId}
                    onClick={() => handleToggleModel(modelId)}
                    className={`flex items-center justify-between p-2 rounded-lg border text-xs font-mono cursor-pointer transition-colors ${
                      isSelected
                        ? "border-primary/40 bg-primary/10 text-primary font-medium"
                        : "border-border/60 hover:border-border hover:bg-black/[0.02] dark:hover:bg-white/[0.02] text-text-muted"
                    }`}
                  >
                    <span className="truncate mr-2" title={modelId}>{modelId}</span>
                    <span className="material-symbols-outlined text-[16px] shrink-0">
                      {isSelected ? "check_box" : "check_box_outline_blank"}
                    </span>
                  </div>
                );
              })}
              {filteredAvailable.length === 0 && (
                <div className="col-span-full py-4 text-center text-xs text-text-muted">
                  No matching models found. Type exact ID above to add.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-dashed border-border text-center">
          <p className="text-sm text-text-muted">
            Whitelist is currently <b>disabled</b>. <code className="text-xs bg-sidebar px-1 rounded">/v1/models</code> will broadcast all configured providers and custom models dynamically.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={onToggleEnabled}
            className="mt-3"
            icon="toggle_on"
          >
            Enable Model Whitelist
          </Button>
        </div>
      )}
    </Card>
  );
}

export default CatalogWhitelistCard;
