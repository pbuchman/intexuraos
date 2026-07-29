#!/bin/bash
set -euo pipefail

# ==============================================================================
# Setup Docker Network for Code Workers
# ==============================================================================
# Creates an isolated Docker network for worker containers.
# Network isolation rules block access to:
#   - Cloud metadata server (169.254.169.254)
#   - Localhost
#   - Private IP ranges
# ==============================================================================

readonly NETWORK_NAME="code-worker-net"
readonly BRIDGE_NAME="code-worker-br"
readonly SUBNET="172.28.0.0/16"
readonly IPV6_SUBNET="fd00:172:28::/64"

echo "========================================"
echo "Setting up Code worker network"
echo "========================================"
echo "Network: $NETWORK_NAME"
echo "Linux bridge: $BRIDGE_NAME"
echo "Subnet: $SUBNET"
echo "IPv6 subnet: $IPV6_SUBNET"
echo ""

validate_network_contract() {
    local driver ipam_driver internal bridge_name enable_ipv6 enable_ip_masquerade
    local gateway_mode_ipv4 gateway_mode_ipv6 subnets subnet subnet_count
    local has_ipv4_subnet has_ipv6_subnet
    local errors=()

    driver="$(docker network inspect "$NETWORK_NAME" --format '{{.Driver}}')"
    ipam_driver="$(docker network inspect "$NETWORK_NAME" --format '{{.IPAM.Driver}}')"
    internal="$(docker network inspect "$NETWORK_NAME" --format '{{.Internal}}')"
    bridge_name="$(docker network inspect "$NETWORK_NAME" --format '{{index .Options "com.docker.network.bridge.name"}}')"
    enable_ipv6="$(docker network inspect "$NETWORK_NAME" --format '{{.EnableIPv6}}')"
    enable_ip_masquerade="$(docker network inspect "$NETWORK_NAME" --format '{{index .Options "com.docker.network.bridge.enable_ip_masquerade"}}')"
    gateway_mode_ipv4="$(docker network inspect "$NETWORK_NAME" --format '{{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}}')"
    gateway_mode_ipv6="$(docker network inspect "$NETWORK_NAME" --format '{{index .Options "com.docker.network.bridge.gateway_mode_ipv6"}}')"
    subnets="$(docker network inspect "$NETWORK_NAME" --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}')"

    [[ "$driver" == "bridge" ]] || errors+=("driver must be bridge (found: $driver)")
    [[ "$ipam_driver" == "default" ]] || errors+=("IPAM driver must be default (found: $ipam_driver)")
    [[ "$internal" == "false" ]] || errors+=("network must not be internal")
    [[ "$bridge_name" == "$BRIDGE_NAME" ]] || errors+=("Linux bridge name must be $BRIDGE_NAME (found: $bridge_name)")
    [[ "$enable_ipv6" == "true" ]] || errors+=("IPv6 must be enabled")
    [[ "$enable_ip_masquerade" == "true" ]] || errors+=("IP masquerade must be enabled")
    [[ -z "$gateway_mode_ipv4" || "$gateway_mode_ipv4" == "nat" ]] || errors+=("IPv4 gateway mode must be nat when configured (found: $gateway_mode_ipv4)")
    [[ -z "$gateway_mode_ipv6" || "$gateway_mode_ipv6" == "nat" ]] || errors+=("IPv6 gateway mode must be nat when configured (found: $gateway_mode_ipv6)")

    subnet_count=0
    has_ipv4_subnet=false
    has_ipv6_subnet=false
    while IFS= read -r subnet; do
        [[ -z "$subnet" ]] && continue
        subnet_count=$((subnet_count + 1))
        [[ "$subnet" == "$SUBNET" ]] && has_ipv4_subnet=true
        [[ "$subnet" == "$IPV6_SUBNET" ]] && has_ipv6_subnet=true
    done <<< "$subnets"
    if [[ "$subnet_count" -ne 2 || "$has_ipv4_subnet" != "true" || "$has_ipv6_subnet" != "true" ]]; then
        errors+=("IPAM subnets must be exactly $SUBNET and $IPV6_SUBNET")
    fi

    if (( ${#errors[@]} > 0 )); then
        echo "Network '$NETWORK_NAME' does not satisfy the required Code worker dual-stack contract:" >&2
        printf '  - %s\n' "${errors[@]}" >&2
        echo "Refusing to modify or replace an existing Docker network." >&2
        return 1
    fi
}

# Create network if not exists
if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    echo "Network '$NETWORK_NAME' already exists"
else
    echo "Creating Docker network: $NETWORK_NAME"
    docker network create \
        --driver bridge \
        --ipv6 \
        --opt "com.docker.network.bridge.name=$BRIDGE_NAME" \
        --opt com.docker.network.bridge.enable_ip_masquerade=true \
        --subnet "$SUBNET" \
        --subnet "$IPV6_SUBNET" \
        "$NETWORK_NAME"
    echo "Network created successfully"
fi

validate_network_contract

echo ""
echo "Network details:"
docker network inspect "$NETWORK_NAME" --format '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}} {{end}}'

# Note: iptables rules for blocking metadata server etc. should be applied
# at the host level on Linux. On macOS with Docker Desktop, network isolation
# is handled differently through the VM.
#
# For production GCE VMs, add these iptables rules:
#   sudo iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
#   sudo iptables -I DOCKER-USER -d 127.0.0.0/8 -j DROP
#   sudo iptables -I DOCKER-USER -d 10.0.0.0/8 -j DROP
#   sudo iptables -I DOCKER-USER -d 172.16.0.0/12 -j DROP
#   sudo iptables -I DOCKER-USER -d 192.168.0.0/16 -j DROP

echo ""
echo "Network setup complete: $NETWORK_NAME"
