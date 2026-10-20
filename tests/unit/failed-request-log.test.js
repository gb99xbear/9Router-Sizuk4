// Failed requests must be visible in the dashboard log, but must NOT count as
// usage. appendRequestLog used to be a no-op, so every error vanished: the log
// is derived from usageHistory, and saveUsageStats() skips zero-token rows.
import { describe, it, expect, beforeEach } from "vitest";
import {
  appendRequestLog,
  getRecentLogs,
  getUsageStats,
  getChartData,
} from "@/lib/db/index.js";

describe("failed request logging", () => {
  beforeEach(async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`DELETE FROM usageHistory`);
  });

  it("records a FAILED row with its reason", async () => {
    await appendRequestLog({
      provider: "opencode",
      model: "big-pickle",
      connectionId: "conn-1",
      status: "FAILED 403",
      error: "OpenCode's free models aren't available from your current network",
    });

    const logs = await getRecentLogs(10);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("FAILED 403");
    expect(logs[0]).toContain("aren't available from your current network");
  });

  it("keeps the 7-field shape so existing parsers still split it", async () => {
    await appendRequestLog({ provider: "p", model: "m", status: "FAILED 500" });
    const [line] = await getRecentLogs(10);
    expect(line.split(" | ").length).toBe(7);
  });

  it("ignores PENDING and success markers (they are not outcomes)", async () => {
    await appendRequestLog({ provider: "p", model: "m", status: "PENDING" });
    await appendRequestLog({ provider: "p", model: "m", status: "200 OK", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    expect(await getRecentLogs(10)).toHaveLength(0);
  });

  it("does not inflate request counts, charts or stats", async () => {
    await appendRequestLog({ provider: "opencode", model: "m", status: "FAILED 403", error: "blocked" });

    const stats = await getUsageStats("24h");
    expect(stats.totalRequests).toBe(0);
    expect(stats.byProvider.opencode).toBeUndefined();

    const chart = await getChartData("24h");
    expect(chart.reduce((sum, b) => sum + b.requests, 0)).toBe(0);
  });
});
