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
| `scripts/egress_stack_up.sh` | host (root) | Full bring-up: tunnel, in-namespace proxy, rotator. |
| `scripts/egress_rotate.sh` | host (root) | Rotates to a fresh WARP egress when every egress is cooling. Bounded loop; stops at the first egress that has quota. |

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

## Running

```bash
# full stack (idempotent)
sudo tools/oc-egress-rotator/scripts/egress_stack_up.sh

# state
curl -s http://127.0.0.1:9090/__egress

# point the adapter at the rotator instead of opencode.ai
OPENCODE_ZEN_BASE=http://127.0.0.1:9090/zen/v1 node tools/opencode-free-9router/src/adapter.js

# when every egress is cooling, find a fresh one
sudo tools/oc-egress-rotator/scripts/egress_rotate.sh
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

## Design limits

The rotator removes the *local* limiter and lets several IP buckets be used in
turn. It cannot create upstream capacity: once every reachable IP is drained,
requests 429 until a bucket resets. More independent IPs is the only lever that
adds throughput.
