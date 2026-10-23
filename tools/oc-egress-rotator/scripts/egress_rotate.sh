#!/bin/bash
# Rotate to a fresh WARP egress when every egress is cooling.
# Rebuilds the tunnel, re-registers if needed, and stops as soon as the new
# egress has OpenCode quota. Bounded: leaves the stack in a working state or
# reports failure; never loops forever.
set -uo pipefail
NS=warpns
WARPDIR=/home/ubuntu/warp
ROTDIR=/home/ubuntu/tools/oc-egress-rotator
MODEL=${MODEL:-deepseek-v4.1-flash-free}
MAX_TRIES=${MAX_TRIES:-8}
ADAPTER_DIR=/home/ubuntu/tools/opencode-free-9router

probe_quota() {
  local ok
  ok=$(cd "$ADAPTER_DIR" && sudo ip netns exec "$NS" env MODEL="$MODEL" N=1 node test_warp_quota.mjs 2>/dev/null | grep -c 'OK  ')
  [ "$ok" -ge 1 ]
}

restart_ingress_proxy() {
  sudo ip netns exec "$NS" pkill -f warp-proxy.js 2>/dev/null
  sudo pkill -f "$ROTDIR/warp-proxy.js" 2>/dev/null
  sleep 1
  sudo ip netns exec "$NS" env HOST=10.203.0.2 PORT=8081 QUIET=1 \
    setsid nohup node "$ROTDIR/warp-proxy.js" >>/home/ubuntu/warp/warp-proxy.log 2>&1 </dev/null &
  sleep 2
}

for try in $(seq 1 "$MAX_TRIES"); do
  # 2 of every 3 attempts get a brand-new device, since the egress IP is tied
  # to the handshake rather than the account alone.
  if [ $((try % 3)) -ne 1 ] || [ ! -f "$WARPDIR/wgcf-profile.conf" ]; then
    (cd "$WARPDIR" && rm -f wgcf-account.toml wgcf-profile.conf && \
      /tmp/wgcf register --accept-tos >/dev/null 2>&1 && /tmp/wgcf generate >/dev/null 2>&1)
  fi

  sudo "$WARPDIR/setup.sh" >/tmp/warp-setup.log 2>&1
  IP=$(sudo ip netns exec "$NS" curl -s -m 12 https://1.1.1.1/cdn-cgi/trace 2>/dev/null | awk -F= '/^ip=/{print $2}')

  if [ -z "${IP:-}" ]; then
    echo "try $try: tunnel down"
    continue
  fi

  if probe_quota; then
    restart_ingress_proxy
    echo "try $try: egress $IP has quota - rotating to it"
    echo "$IP" > "$WARPDIR/live_egress.txt"
    exit 0
  fi
  echo "try $try: egress $IP still capped"
done

echo "no fresh WARP egress found after $MAX_TRIES tries"
exit 1
