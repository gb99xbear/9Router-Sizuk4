# Egress rotator for OpenCode's free tier

OpenCode's free tier answers `429 FreeUsageLimitError` ("Free usage limit
reached") **per egress IP**, not per session and not per account. Measured proof:
the identical attested request (same headers, `Authorization: Bear public`, a
fresh `ses_` id) returns 429 with `retry-after` ~75000s from one IP and 200 from
another IP at the same moment.

This directory turns that fact into capacity. It sits between the OpenCode
adapter and opencode.ai and owns exactly one decision: **which IP the request
leaves from**.

```
9Router :20128 → adapter :8790 (attestation) → rotator :9090 → [ direct | WARP ] → opencode.ai
```

## Pieces

| File | Runs where | Job |
|---|---|---|
| `egress-rotator.js` | host | Forwards `/zen/v1/*` to opencode.ai through a chosen egress. On 429 it parks that egress for the upstream `retry-after` and retries the same request on the next egress. `/__egress` reports state. |
| `scripts/warp-proxy.js` | inside netns `warpns` | Minimal CONNECT proxy. The host reaches it at `10.203.0.2:8081`, so anything tunnelled through it exits via that namespace's WARP interface. |
| `scripts/warp_netns_setup.sh` | host (root) | Builds the isolated WARP tunnel: netns + veth + WireGuard, endpoint pinned out the veth. |
| `scripts/egress_up.sh` | host (root) | Full bring-up of the egress layer (base tunnel + N extra tunnels + their proxies) and writes `egresses.env` for the rotator. |
| `scripts/warp_add.sh` | host (root) | Adds one more egress: its own WARP device, own namespace, own CONNECT proxy. |
| `scripts/egress_rotate.sh` | host (root) | Rotates to a fresh WARP egress when every egress is cooling. Bounded loop; stops at the first egress that has quota. |
| `scripts/egress_autorotate.sh` | host (root) | Timer entry point: rotates only when every egress is cooling, rate-limited to one attempt per `ROTATE_INTERVAL`. |
| `scripts/netguard.sh` | host (root) | Connectivity guard. Snapshot before and verify after any host-network change, so a broken host is caught in seconds instead of hours. |
| `systemd/` | host (root) | Units + timer for the whole stack. |

## Egress measurement (2026-10-23, Oracle A1, from SG)

| Egress | Attestation | Quota | Verdict |
|---|---|---|---|
| Oracle public IP | pass | drained (429, ~21h) | usable again after reset |
| Vercel edge | **fail** (`FreeTierError`) | n/a | unusable |
| Cloudflare Worker | pass | shared anycast IP, hot (1/12) | poor |
| **Cloudflare WARP** | pass | own bucket -> **20/20 OK** | **working second bucket** |

Vercel fails because it stamps `x-vercel-id`, `x-invocation-id`,
`x-amzn-trace-id`, `sec-fetch-mode` and its own JA4 TLS digest onto outbound
requests; the ones added at egress cannot be stripped from inside the function.

## systemd layout

```
oc-warp-egress.service      oneshot, RemainAfterExit  - builds tunnels + proxies, writes egresses.env
oc-egress-rotator.service   simple,  Restart=always   - the rotator on 127.0.0.1:9090
oc-egress-autorotate.service + .timer                 - every 15 min: rotate only if all egresses cooling
```

```bash
sudo install -m644 systemd/*.service systemd/*.timer /etc/systemd/system/
sudo install -m755 scripts/*.sh /home/ubuntu/warp/
sudo install -m755 scripts/netguard.sh /usr/local/bin/netguard
sudo systemctl daemon-reload
sudo systemctl enable --now oc-warp-egress.service oc-egress-rotator.service oc-egress-autorotate.timer
```

`Restart=always` means a stray `pkill` on the rotator is survived: systemd brings
it back within seconds (verified: SIGKILL to the rotator, a new PID was serving
again in 8s). The unit `Description=` states that out loud, since on a shared box
that is the only warning a human gets before killing it.

## Running

```bash
# state: per-egress hits and remaining cooldown
curl -s http://127.0.0.1:9090/__egress

# host connectivity check (run this around ANY network change)
sudo netguard

# force a rotation now instead of waiting for the timer
sudo /home/ubuntu/warp/egress_rotate.sh

# point the adapter at the rotator instead of opencode.ai
OPENCODE_ZEN_BASE=http://127.0.0.1:9090/zen/v1 node tools/opencode-free-9router/src/adapter.js

# logs
tail -f /home/ubuntu/warp/rotator.log /home/ubuntu/warp/autorotate.log
```

## Gotchas that cost time

1. **Pin the tunnel endpoint outside the tunnel.** Without
   `ip route add <endpoint>/32 via <host> dev <veth>` inside the namespace, the
   default route swallows the WireGuard handshake and you get
   `transfer: 0 B received`.
2. **Routes die with the link.** `ip link set warp down` drops routes added with
   `ip route add`, so re-add both the endpoint route and `default dev warp` after
   every bounce.
3. **Oracle's FORWARD policy is DROP.** The namespace needs
   `iptables -I FORWARD -s <subnet> -j ACCEPT` and the reverse, plus a
   MASQUERADE for the subnet out the real interface.
4. **`wg` wants a comma-separated allowed-ips list** (`0.0.0.0/0,::/0`), not two
   arguments.
5. **The WARP egress IP follows the handshake, not the account.** Bouncing the
   link or just re-registering often keeps the same IP; a fresh device plus a
   fresh handshake eventually lands on a different one (observed
   `104.28.222.43`, `104.28.222.46`, `104.28.254.46`, `104.28.254.47`).
6. **Always check the host after a network change.** netguard exists because an
   unguarded namespace/iptables change once left the host unable to resolve for
   roughly two hours. Bracket every change: `netguard snapshot` → change →
   `netguard verify`. The WARP scripts now call it automatically.

## Design limits

The rotator removes the *local* limiter and lets several IP buckets be used in
turn. It cannot create upstream capacity: once every reachable IP is drained,
requests 429 until a bucket resets. More independent IPs is the only lever that
adds throughput.
