import { getAdapter } from "../driver.js";

// Additive egress counters, one row per (day, relayHost, targetHost).
// Called from the relay fetch path - must never throw into the request path.
export async function addRelayBytes({ day, relayHost = null, targetHost = null, inBytes = 0, outBytes = 0 }) {
  try {
    const db = await getAdapter();
    const id = `${day}|${relayHost || ""}|${targetHost || ""}`;
    db.run(
      `INSERT INTO relayBytes(id, day, relayHost, targetHost, requests, inBytes, outBytes, updatedAt)
       VALUES(?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         requests  = requests + 1,
         inBytes   = inBytes + excluded.inBytes,
         outBytes  = outBytes + excluded.outBytes,
         updatedAt = excluded.updatedAt`,
      [id, day, relayHost, targetHost, Math.max(0, inBytes | 0), Math.max(0, outBytes | 0), new Date().toISOString()]
    );
  } catch {
    /* metering must never break a request */
  }
}

export async function getRelayBytes(fromDay) {
  const db = await getAdapter();
  return db.all(
    `SELECT day, relayHost, targetHost, requests, inBytes, outBytes
       FROM relayBytes WHERE day >= ? ORDER BY day DESC, inBytes DESC`,
    [fromDay]
  );
}
