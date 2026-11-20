// Per-provider / per-model system-prompt resolution.
// Lookup order is most-specific first:
//   1. "provider/model"  (exact model, provider-qualified)
//   2. "model"           (model name, any provider)
//   3. "provider/*"      (wildcard: every model of that provider)
// Falls back to the global customPromptText when nothing matches.
// Fail-open: a bad map never breaks a request.

export function resolveModelPrompt({ provider, model, clientModel, map, globalText }) {
  try {
    if (!map || typeof map !== "object") return globalText || "";
    // 1. apa yang client hantar (cth "thk/deepseek-v4.1-flash:free") -- paling intuitif
    if (clientModel) {
      const byClient = map[clientModel];
      if (typeof byClient === "string" && byClient.trim()) return byClient;
      const bare = clientModel.includes("/") ? clientModel.split("/").slice(1).join("/") : null;
      if (bare) {
        const byBare = map[bare];
        if (typeof byBare === "string" && byBare.trim()) return byBare;
      }
      const cpref = clientModel.includes("/") ? clientModel.split("/")[0] : null;
      if (cpref) {
        const byPref = map[cpref + "/*"];
        if (typeof byPref === "string" && byPref.trim()) return byPref;
      }
    }
    if (provider && model) {
      const exact = map[provider + "/" + model];
      if (typeof exact === "string" && exact.trim()) return exact;
    }
    if (model) {
      const byModel = map[model];
      if (typeof byModel === "string" && byModel.trim()) return byModel;
    }
    if (provider) {
      const wildcard = map[provider + "/*"];
      if (typeof wildcard === "string" && wildcard.trim()) return wildcard;
    }
  } catch (_) {}
  return globalText || "";
}

// Returns the raw entry for this request (string prompt OR {turns:[...]}).
// Chat-mode entries carry a `turns` array which chatCore injects as fake
// history via injectChatTurns instead of appending a system directive.
// Fail-open: any error degrades to single-mode text.
export function resolveModelPromptEntry({ provider, model, clientModel, map, globalText }) {
  const text = resolveModelPrompt({ provider, model, clientModel, map, globalText });
  try {
    if (!map || typeof map !== "object") return { mode: "single", text };
    const keys = [];
    if (clientModel) {
      keys.push(clientModel);
      if (clientModel.includes("/")) keys.push(clientModel.split("/").slice(1).join("/"));
    }
    if (provider && model) keys.push(`${provider}/${model}`);
    if (model) keys.push(model);
    for (const k of keys) {
      const v = map[k];
      if (v && typeof v === "object" && Array.isArray(v.turns) && v.turns.length) {
        return { mode: "chat", turns: v.turns, text: v.text || "" };
      }
    }
  } catch (_) {}
  return { mode: "single", text };
}
