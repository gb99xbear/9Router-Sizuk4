#!/bin/bash
# Bring up the whole rotating-egress stack:
#   1. WARP tunnel in netns `warpns`
#   2. CONNECT proxy inside that namespace (reachable by the host at 10.203.0.2:8081)
#   3. egress rotator on 127.0.0.1:9090 (direct + warp)
set -uo pipefail

ROTDIR=/home/ubuntu/tools/oc-egress-rotator
NS=warpns
WARPPROXY=10.203.0.2:8081

sudo /home/ubuntu/warp/setup.sh >/tmp/warp-setup.log 2>&1
IP=$(sudo ip netns exec "$NS" curl -s -m 15 https://1.1.1.1/cdn-cgi/trace | awk -F= '/^ip=/{print $2}')
echo "warp egress: ${IP:-NONE}"

# CONNECT proxy inside the namespace
sudo pkill -f "$ROTDIR/warp-proxy.js" 2>/dev/null
sudo ip netns exec "$NS" pkill -f warp-proxy.js 2>/dev/null
sleep 1
sudo ip netns exec "$NS" env HOST=10.203.0.2 PORT=8081 QUIET=1 \
  setsid nohup node "$ROTDIR/warp-proxy.js" >>/home/ubuntu/warp/warp-proxy.log 2>&1 < /dev/null &
sleep 3
PROXY_IP=$(curl -s -m 15 --proxy "http://$WARPPROXY" https://1.1.1.1/cdn-cgi/trace | awk -F= '/^ip=/{print $2}')
echo "proxy reachable, egress via proxy: ${PROXY_IP:-NONE}"

# rotator
pkill -f "$ROTDIR/egress-rotator.js" 2>/dev/null
sleep 1
cd "$ROTDIR"
EGRESSES="direct,warp1=http://$WARPPROXY" LISTEN_PORT=9090 LISTEN_HOST=127.0.0.1 \
  setsid nohup node "$ROTDIR/egress-rotator.js" >>/home/ubuntu/warp/rotator.log 2>&1 < /dev/null &
sleep 3
echo "rotator status:"
curl -s -m 10 http://127.0.0.1:9090/__egress
