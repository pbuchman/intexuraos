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

NETWORK_NAME="${NETWORK_NAME:-code-worker-net}"
SUBNET="${SUBNET:-172.28.0.0/16}"

echo "========================================"
echo "Setting up Code worker network"
echo "========================================"
echo "Network: $NETWORK_NAME"
echo "Subnet: $SUBNET"
echo ""

# Create network if not exists
if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    echo "Network '$NETWORK_NAME' already exists"
else
    echo "Creating Docker network: $NETWORK_NAME"
    docker network create \
        --driver bridge \
        --opt com.docker.network.bridge.enable_ip_masquerade=true \
        --subnet "$SUBNET" \
        "$NETWORK_NAME"
    echo "Network created successfully"
fi

echo ""
echo "Network details:"
docker network inspect "$NETWORK_NAME" --format '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}}{{end}}'

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
