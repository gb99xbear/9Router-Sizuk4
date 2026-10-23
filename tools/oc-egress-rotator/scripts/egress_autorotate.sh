#!/bin/bash
# Auto-rotate: when EVERY egress is cooling, try to find a fresh WARP egress
# instead of sitting idle until the buckets reset.
#
# Bounded and rate-limited on purpose: WARP gives a small pool per region, so a
# tight rotation loop would just churn without gaining quota. Default cadence is
# one rotation attempt per ROTATE_INTERVAL (30 min), max MAX_TRIES (6) probes.
set -uo pipefail

ROTATOR=http://127.0.0.1:9090
WARPDIR=/home/ubuntu/warp
LOG=$WARPDIR/autorotate.log
STAMP=$WARPDIR/last_rotate.txt
INTERVAL=${ROTATE_INTERVAL:-1800}
MAX_TRIES=${MAX_TRIES:-6}
ROTDIR=/home/ubuntu/tools/oc-egress-rotator

log() { echo "[$(date -Is)] $*" >> "$LOG"; }

status=$(curl -s -m 8 "$ROTATOR/__egress" 2>/dev/null)
if [ -z "$status" ]; then
  log "rotator not answering - leaving alone"
  exit 0
fi

# how many egresses are actually usable right now
ready=$(printf '%s' "$status" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print(-1); raise SystemExit
print(sum(1 for e in d.get("egresses", []) if e.get("cooling_for_s", 0) <= 0))
' 2>/dev/null)

if [ "${ready:-0}" != "0" ]; then
  log "$ready egress(es) ready - nothing to do"
  exit 0
fi

now=$(date +%s)
last=0
[ -f "$STAMP" ] && last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ $((now - last)) -lt "$INTERVAL" ]; then
  log "all egresses cooling; last rotation $(((now - last) / 60))m ago, waiting (interval ${INTERVAL}s)"
  exit 0
fi

log "all egresses cooling - rotating to find a fresh egress"
if sudo MAX_TRIES="$MAX_TRIES" "$WARPDIR/egress_rotate.sh" >> "$LOG" 2>&1; then
  echo "$now" > "$STAMP"
  log "rotation found a fresh egress; restarting the rotator to clear cooldown state"
  systemctl restart oc-egress-rotator.service 2>/dev/null || {
    pid=$(ss -lptn 'sport = :9090' 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
    [ -n "${pid:-}" ] && kill "$pid"
  }
  sleep 3
  log "post-restart: $(curl -s -m 8 "$ROTATOR/__egress" | tr -d '\n' | head -c 200)"
else
  echo "$now" > "$STAMP"
  log "no fresh egress found this round; will retry after ${INTERVAL}s"
fi
