#!/bin/bash
# netguard - connectivity guard for anything that touches host networking.
#
# Any change to routes, namespaces, iptables or DNS must be bracketed by:
#     netguard snapshot      # before
#     (apply the change)
#     netguard verify        # after -> auto-rollback hint if it broke
#
# Rationale: an earlier change left the host resolving nothing for ~2 hours
# because nobody checked connectivity after the change. This makes that check
# mandatory and cheap.
set -uo pipefail

STATE=/home/ubuntu/.netguard-state
PASS=0
FAIL=0

check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  OK    %s\n' "$name"; PASS=$((PASS + 1))
  else
    printf '  FAIL  %s\n' "$name"; FAIL=$((FAIL + 1))
  fi
}

probe() {
  echo "connectivity $(date -Is)"
  check "dns resolve (github.com)"      getent hosts github.com
  check "https 1.1.1.1"                 curl -s -m 8 -o /dev/null https://1.1.1.1
  check "https github.com"              curl -s -m 8 -o /dev/null https://github.com
  check "default route present"         bash -c 'ip route show default | grep -q .'
  check "tailscale interface up"        bash -c 'ip link show tailscale0 | grep -q "state UP\|state UNKNOWN"'
  check "resolv.conf non-empty"         bash -c 'grep -q nameserver /etc/resolv.conf'
  echo "  nameservers: $(grep -h nameserver /etc/resolv.conf | tr '\n' ' ')"
  echo "  default:     $(ip route show default | head -1)"
}

case "${1:-check}" in
  snapshot)
    {
      echo "# netguard snapshot $(date -Is)"
      echo "RESOLV=$(grep -h nameserver /etc/resolv.conf | tr '\n' ' ')"
      echo "ROUTE=$(ip route show default | head -1)"
      echo "FORWARD_RULES=$(iptables -S FORWARD 2>/dev/null | wc -l)"
      echo "NETNS=$(ip netns list 2>/dev/null | tr '\n' ' ')"
    } > "$STATE"
    echo "snapshot saved to $STATE"
    ;;
  verify)
    if [ ! -f "$STATE" ]; then echo "no snapshot; run: netguard snapshot"; exit 2; fi
    echo "=== post-change connectivity ==="
    probe
    if [ "$FAIL" -gt 0 ]; then
      echo
      echo "!! $FAIL check(s) FAILED - the last network change broke the host."
      echo "!! Roll it back now. Snapshot for reference:"
      cat "$STATE"
      exit 1
    fi
    echo "all checks passed ($PASS)"
    ;;
  *)
    probe
    [ "$FAIL" -eq 0 ] || exit 1
    ;;
esac
