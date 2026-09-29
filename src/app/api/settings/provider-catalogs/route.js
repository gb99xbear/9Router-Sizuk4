import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_PROVIDERS = 256;
const MAX_MODELS_PER_PROVIDER = 256;
const MAX_MODEL_ID_LENGTH = 256;
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function cleanModelIds(value) {
  if (!Array.isArray(value) || value.length > MAX_MODELS_PER_PROVIDER) return null;
  const seen = new Set();
  const ids = [];
  for (const valueItem of value) {
    if (typeof valueItem !== "string") return null;
    const id = valueItem.trim();
    if (!id || id.length > MAX_MODEL_ID_LENGTH) return null;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function cleanProviderCatalogs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_PROVIDERS) return null;
  const result = {};
  for (const [providerId, catalog] of entries) {
    if (!PROVIDER_ID_RE.test(providerId) || !catalog || typeof catalog !== "object" || Array.isArray(catalog)) return null;
    if (typeof catalog.enabled !== "boolean") return null;
    const modelIds = cleanModelIds(catalog.modelIds);
    if (!modelIds) return null;
    result[providerId] = { enabled: catalog.enabled, modelIds };
  }
  return result;
}

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({ providerCatalogs: settings.providerCatalogs || {} }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.log("Error reading provider catalogs:", error);
    return NextResponse.json({ error: "Failed to read provider catalogs" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const providerCatalogs = cleanProviderCatalogs(body?.providerCatalogs);
    if (!providerCatalogs) {
      return NextResponse.json({ error: "Invalid providerCatalogs payload" }, { status: 400 });
    }
    const settings = await updateSettings({ providerCatalogs });
    return NextResponse.json({ providerCatalogs: settings.providerCatalogs || {} }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.log("Error updating provider catalogs:", error);
    return NextResponse.json({ error: "Failed to update provider catalogs" }, { status: 500 });
  }
}
