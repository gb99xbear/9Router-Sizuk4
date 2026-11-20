// Minimal CONNECT proxy. Runs INSIDE a network namespace so that anything the
// host tunnels through it leaves via that namespace's egress (e.g. WARP).
// Zero dependencies: node:http + node:net only.
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || "0.0.0.0";
const QUIET = process.env.QUIET === "1";

let established = 0;
let failed = 0;

const server = http.createServer((req, res) => {
  res.writeHead(405, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "this proxy only supports CONNECT" }));
});

server.on("connect", (req, clientSocket, head) => {
  const lastColon = req.url.lastIndexOf(":");
  const host = req.url.slice(0, lastColon);
  const port = Number(req.url.slice(lastColon + 1)) || 443;

  const upstream = net.connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    established += 1;
    if (!QUIET && established % 25 === 0) console.log(`[warp-proxy] established=${established} failed=${failed}`);
  });

  upstream.on("error", () => {
    failed += 1;
    clientSocket.destroy();
  });
  clientSocket.on("error", () => upstream.destroy());
  clientSocket.setTimeout(180000, () => {
    clientSocket.destroy();
    upstream.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[warp-proxy] CONNECT proxy on http://${HOST}:${PORT}`);
});
