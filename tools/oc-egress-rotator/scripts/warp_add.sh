#!/bin/bash
# Build an additional WARP egress: its own wgcf device, own network namespace,
# own CONNECT proxy. Usage: warp_add.sh <index>   (index 1..N)
set -uo pipefail

IDX=${1:?usage: warp_add.sh <index>}
NS="warp$IDX"
SUBNET="10.203.$IDX."
HOST_IP="${SUBNET}1"
NS_IP="${SUBNET}2"
NET="${SUBNET}0/30"
PROXY_PORT=8081
DEVDIR="/home/ubuntu/warp/dev$IDX"
ROTDIR=/home/ubuntu/tools/oc-egress-rotator
HOST_IF=$(ip route get 1.1.1.1 | grep -oP 'dev \K\S+' | head -1)

mkdir -p "$DEVDIR"

# fresh anonymous WARP device for this egress
if [ ! -f "$DEVDIR/wgcf-profile.conf" ]; then
  (cd "$DEVDIR" && /tmp/wgcf register --accept-tos >/dev/null 2>&1 && /tmp/wgcf generate >/dev/null 2>&1)
fi

get() { grep -E "^$1 = " "$DEVDIR/wgcf-profile.conf" | head -1 | cut -d= -f2- | sed 's/^ *//'; }
PRIV=$(get PrivateKey)
PEER=$(get PublicKey)
ADDR=$(get Address | cut -d, -f1 | tr -d ' ')
ENDPOINT_HOST=$(get Endpoint | cut -d: -f1)
ENDPOINT_PORT=$(get Endpoint | cut -d: -f2)
EP_IP=$(getent ahostsv4 "$ENDPOINT_HOST" | awk '{print $1; exit}')

umask 077; printf '%s' "$PRIV" > "$DEVDIR/warp.key"

# teardown leftovers
sudo ip netns del "$NS" 2>/dev/null
sudo ip link del "veth-h$IDX" 2>/dev/null

sudo ip netns add "$NS"
sudo ip link add "veth-h$IDX" type veth peer name "veth-n$IDX"
sudo ip link set "veth-n$IDX" netns "$NS"
sudo ip addr add "$HOST_IP/30" dev "veth-h$IDX"
sudo ip link set "veth-h$IDX" up
sudo ip netns exec "$NS" ip addr add "$NS_IP/30" dev "veth-n$IDX"
sudo ip netns exec "$NS" ip link set "veth-n$IDX" up
sudo ip netns exec "$NS" ip link set lo up

sudo sysctl -qw net.ipv4.ip_forward=1
sudo iptables -t nat -C POSTROUTING -s "$NET" -o "$HOST_IF" -j MASQUERADE 2>/dev/null || \
  sudo iptables -t nat -A POSTROUTING -s "$NET" -o "$HOST_IF" -j MASQUERADE
sudo iptables -C FORWARD -s "$NET" -j ACCEPT 2>/dev/null || sudo iptables -I FORWARD 1 -s "$NET" -j ACCEPT
sudo iptables -C FORWARD -d "$NET" -j ACCEPT 2>/dev/null || sudo iptables -I FORWARD 1 -d "$NET" -j ACCEPT

# endpoint pinned outside the tunnel, then default through it
sudo ip netns exec "$NS" ip route add "$EP_IP/32" via "$HOST_IP" dev "veth-n$IDX"
sudo ip netns exec "$NS" ip link add warp type wireguard
sudo ip netns exec "$NS" wg set warp private-key "$DEVDIR/warp.key" \
  peer "$PEER" allowed-ips 0.0.0.0/0,::/0 endpoint "$EP_IP:$ENDPOINT_PORT" persistent-keepalive 25
sudo ip netns exec "$NS" ip addr add "$ADDR" dev warp
sudo ip netns exec "$NS" ip link set warp up
sudo ip netns exec "$NS" ip link set warp mtu 1280
sudo ip netns exec "$NS" ip route add default dev warp

sudo mkdir -p "/etc/netns/$NS"
printf 'nameserver 1.1.1.1\n' | sudo tee "/etc/netns/$NS/resolv.conf" >/dev/null

sleep 6
IP=$(sudo ip netns exec "$NS" curl -s -m 12 https://1.1.1.1/cdn-cgi/trace 2>/dev/null | awk -F= '/^ip=/{print $2}')

# CONNECT proxy for this namespace
sudo ip netns exec "$NS" env HOST="$NS_IP" PORT="$PROXY_PORT" QUIET=1 \
  setsid nohup node "$ROTDIR/warp-proxy.js" >>"/home/ubuntu/warp/proxy-$NS.log" 2>&1 </dev/null &
sleep 2

echo "$NS $IP http://$NS_IP:$PROXY_PORT"
