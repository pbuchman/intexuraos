resource "hcloud_ssh_key" "deploy" {
  name       = "intexuraos-prod-deploy"
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
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_source_ips
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = var.web_source_ips
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = var.web_source_ips
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
  delete_protection  = true
  rebuild_protection = true
  labels             = local.common_labels

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.prod_ipv4.id
    ipv6_enabled = false
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [image]
  }
}
