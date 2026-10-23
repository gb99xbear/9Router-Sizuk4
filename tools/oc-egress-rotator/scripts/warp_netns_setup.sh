#!/bin/bash
# Bring up a Cloudflare WARP WireGuard tunnel inside an isolated netns.
# The host's own routing (SSH, Tailscale, 9router, adapter) is untouched.
set -euo pipefail

NS=warpns
PROFILE=/home/ubuntu/warp/wgcf-profile.conf
VETH_H=veth-h
VETH_NS=veth-w
HOST_SUBNET=10.203.0.0/30
HOST_IP=10.203.0.1
NS_IP=10.203.0.2
HOST_IF=$(ip route get 1.1.1.1 | grep -oP 'dev \K\S+' | head -1)

get() { grep -E "^$1 = " "$PROFILE" | head -1 | cut -d= -f2- | sed 's/^ *//'; }

PRIV=$(get PrivateKey)
PEER=$(get PublicKey)
ADDR4=$(get Address | cut -d, -f1 | tr -d ' ')
ENDPOINT_HOST=$(get Endpoint | cut -d: -f1)
ENDPOINT_PORT=$(get Endpoint | cut -d: -f2)

echo "host if=$HOST_IF  endpoint=$ENDPOINT_HOST:$ENDPOINT_PORT  addr4=$ADDR4"

# resolve endpoint on the host (netns has no DNS before the tunnel is up)
EP_IP=$(getent ahostsv4 "$ENDPOINT_HOST" | awk '{print $1; exit}')
echo "endpoint resolved to $EP_IP"

# --- teardown any previous attempt ---
sudo ip netns del "$NS" 2>/dev/null || true
sudo ip link del "$VETH_H" 2>/dev/null || true

# --- netns + veth ---
sudo ip netns add "$NS"
sudo ip link add "$VETH_H" type veth peer name "$VETH_NS"
sudo ip link set "$VETH_NS" netns "$NS"
sudo ip addr add "$HOST_IP/30" dev "$VETH_H"
sudo ip link set "$VETH_H" up
sudo ip netns exec "$NS" ip addr add "$NS_IP/30" dev "$VETH_NS"
sudo ip netns exec "$NS" ip link set "$VETH_NS" up
sudo ip netns exec "$NS" ip link set lo up

# --- host NAT so the tunnel can reach its endpoint ---
sudo sysctl -qw net.ipv4.ip_forward=1
sudo iptables -t nat -C POSTROUTING -s "$HOST_SUBNET" -o "$HOST_IF" -j MASQUERADE 2>/dev/null || \
  sudo iptables -t nat -A POSTROUTING -s "$HOST_SUBNET" -o "$HOST_IF" -j MASQUERADE

# --- wireguard interface inside the netns ---
KEYFILE=/home/ubuntu/warp/warp.key
umask 077; printf '%s' "$PRIV" > "$KEYFILE"

# The tunnel's own endpoint must NOT go through the tunnel: pin it out the veth
# before the default route flips to `warp`. Without this the handshake never
# completes (0 B received) because the encrypted packets loop into wg itself.
sudo ip netns exec "$NS" ip route add "$EP_IP/32" via "$HOST_IP" dev "$VETH_NS"

sudo ip netns exec "$NS" ip link add warp type wireguard
sudo ip netns exec "$NS" wg set warp private-key "$KEYFILE" \
  peer "$PEER" allowed-ips 0.0.0.0/0,::/0 endpoint "$EP_IP:$ENDPOINT_PORT" persistent-keepalive 25
sudo ip netns exec "$NS" ip addr add "$ADDR4" dev warp
sudo ip netns exec "$NS" ip link set warp up
sudo ip netns exec "$NS" ip route add default dev warp
sudo ip netns exec "$NS" ip -6 route add default dev warp 2>/dev/null || true

# --- DNS inside the netns ---
sudo mkdir -p "/etc/netns/$NS"
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' | sudo tee "/etc/netns/$NS/resolv.conf" >/dev/null

sleep 3
echo "--- handshake ---"
sudo ip netns exec "$NS" wg show warp | head -8
echo "--- egress IP via WARP ---"
sudo ip netns exec "$NS" curl -s -m 20 https://api.ipify.org; echo
