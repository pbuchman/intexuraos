# -----------------------------------------------------------------------------
# Hetzner Cloud Resources
# -----------------------------------------------------------------------------

resource "hcloud_ssh_key" "deploy" {
  name       = "intexuraos-deploy"
  public_key = var.deploy_ssh_public_key
  labels     = local.common_labels
}

resource "hcloud_primary_ip" "prod_ipv4" {
  name          = "intexuraos-prod-ipv4"
  datacenter    = var.hetzner_datacenter
  type          = "ipv4"
  assignee_type = "server"
  auto_delete   = false
  labels        = local.common_labels
}

# -----------------------------------------------------------------------------
# Firewall — SSH (port 22) restricted to admin_ssh_source_ips.
# The variable has a validation rule that rejects 0.0.0.0/0 and ::/0 to
# prevent accidentally opening SSH to the internet. Additional defense-in-
# depth via sshd_config hardening (provision.sh):
#   - PasswordAuthentication no
#   - PermitRootLogin no
#   - AllowUsers deploy
#   - AuthenticationMethods publickey
# -----------------------------------------------------------------------------

resource "hcloud_firewall" "prod" {
  name   = "intexuraos-prod"
  labels = local.common_labels

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.admin_ssh_source_ips
    description = "SSH (restricted to admin IPs, key-only auth)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTP (Let's Encrypt HTTP-01 + redirect to HTTPS)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTPS"
  }

  rule {
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "ICMP (ping)"
  }
}

# -----------------------------------------------------------------------------
# Server — var.hetzner_server_type (default CX32: 4 vCPU, 8GB RAM, 80GB NVMe) running Ubuntu 24.04 LTS
# -----------------------------------------------------------------------------

resource "hcloud_server" "prod" {
  name         = "intexuraos-prod"
  server_type  = var.hetzner_server_type
  image        = "ubuntu-24.04"
  location     = var.hetzner_location
  ssh_keys     = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.prod.id]

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.prod_ipv4.id
    ipv6_enabled = true
  }

  labels = local.common_labels

  # Prevent accidental replacement (which would create a new VM with a new IP).
  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      # Ubuntu image ID changes when Hetzner updates the snapshot; do not recreate.
      image,
    ]
  }
}
