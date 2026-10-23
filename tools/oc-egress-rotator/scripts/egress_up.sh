#!/bin/bash
# Bring up the WARP egress layers under systemd:
#   warpns (base tunnel + proxy) and warp1..3 (extra egresses + proxies).
# Does NOT start the rotator; that is its own unit and reads /__egress.
set -uo pipefail

ROTDIR=/home/ubuntu/tools/oc-egress-rotator
WARPDIR=/home/ubuntu/warp
EXTRA=${EXTRA_EGRESSES:-3}

echo "[egress_up] $(date -Is) building base tunnel"
sudo "$WARPDIR/setup.sh" || echo "[egress_up] base tunnel setup returned non-zero"

# CONNECT proxy for the base namespace
sudo ip netns exec warpns pkill -f warp-proxy.js 2>/dev/null || true
sudo ip netns exec warpns env HOST=10.203.0.2 PORT=8081 QUIET=1 \
  setsid nohup node "$ROTDIR/warp-proxy.js" >>"$WARPDIR/warp-proxy.log" 2>&1 </dev/null &
sleep 2

for i in $(seq 1 "$EXTRA"); do
  echo "[egress_up] building extra egress warp$i"
  sudo "$WARPDIR/warp_add.sh" "$i" || echo "[egress_up] warp$i setup returned non-zero"
done

# the rotator decides which of these egresses to use, so publish the list
# (single line on purpose: systemd EnvironmentFile is line-oriented)
{
  printf 'EGRESSES=direct,warpns=http://10.203.0.2:8081'
  for i in $(seq 1 "$EXTRA"); do printf ',warp%s=http://10.203.%s.2:8081' "$i" "$i"; done
  printf '\n'
} > "$WARPDIR/egresses.env"
echo "[egress_up] egress list: $(cat "$WARPDIR/egresses.env")"

if command -v netguard >/dev/null 2>&1; then
  sudo netguard verify >/dev/null 2>&1 || {
    echo "[egress_up] netguard FAILED - host connectivity is broken, check immediately"
    sudo netguard || true
  }
fi
echo "[egress_up] done"
