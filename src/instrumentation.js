export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    // Proactive OAuth token refresh. Must start here (boot, alias resolver active):
    // the custom-server import cannot resolve "open-sse/..." and the layout path
    // only fires on a page render, which left tokens unrefreshed after a restart.
    const { startBackgroundTokenRefresh } = await import("@/sse/services/backgroundTokenRefresh.js");
    startBackgroundTokenRefresh();
  }
}
