resource "hcloud_ssh_key" "deploy" {
  name       = "intexuraos-deploy"
  public_key = var.deploy_ssh_public_key
  labels     = local.common_labels
}

resource "hcloud_primary_ip" "prod_ipv4" {
  name              = "intexuraos-prod-ipv4"
  type              = "ipv4"
  auto_delete       = false
  delete_protection = true
  location          = var.hetzner_location
  labels            = local.common_labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_firewall" "prod" {
  name   = "intexuraos-prod"
  labels = local.common_labels

  rule {
    description = "ICMP (ping)"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = var.web_source_ips
  }

  rule {
    description = "SSH (key-only, hardened sshd)"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.admin_ssh_source_ips
  }

  rule {
    description = "HTTP (Let's Encrypt HTTP-01 + redirect to HTTPS)"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = var.web_source_ips
  }

  rule {
    description = "HTTPS"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = var.web_source_ips
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_server" "prod" {
  name               = "intexuraos-prod"
  server_type        = var.hetzner_server_type
  image              = var.hetzner_image
  location           = var.hetzner_location
  ssh_keys           = [hcloud_ssh_key.deploy.id]
  firewall_ids       = [hcloud_firewall.prod.id]
  delete_protection  = false
  rebuild_protection = false
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    deploy_ssh_public_key = var.deploy_ssh_public_key
  })
  labels = local.common_labels

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.prod_ipv4.id
    ipv6_enabled = true
  }

  lifecycle {
    ignore_changes = [image]
  }
}
