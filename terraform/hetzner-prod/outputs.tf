output "environment" {
  description = "Hetzner migration environment label."
  value       = var.environment
}

output "retained_gcp_project_id" {
  description = "Shared GCP project retained for Firestore, Pub/Sub, Secret Manager, GCS, Cloud Functions, Artifact Registry, and Cloud Build."
  value       = local.retained_gcp.project_id
}

output "retained_gcp_project_number" {
  description = "Shared GCP project number for retained resource integrations."
  value       = local.retained_gcp.project_number
}

output "retained_firestore_database_id" {
  description = "Retained Firestore database ID. The database remains owned by terraform/environments/dev."
  value       = local.retained_gcp.firestore_database_id
}

output "cloudflare_dns_api_token_secret_id" {
  description = "Retained GCP Secret Manager secret ID for the Cloudflare DNS API token."
  value       = local.retained_gcp.cloudflare_dns_api_token_secret_id
}

output "retained_gcp_inventory" {
  description = "Read-only inventory of retained GCP resources that remain owned by terraform/environments/dev."
  value       = local.retained_gcp_inventory
}

output "hetzner_server_id" {
  description = "Hetzner server ID for the production VM."
  value       = hcloud_server.prod.id
}

output "hetzner_server_name" {
  description = "Hetzner server name for runtime/deploy workers."
  value       = hcloud_server.prod.name
}

output "hetzner_server_ipv4" {
  description = "Stable primary IPv4 address assigned to the Hetzner production VM."
  value       = hcloud_primary_ip.prod_ipv4.ip_address
}

output "hetzner_primary_ipv4_id" {
  description = "Hetzner primary IPv4 resource ID."
  value       = hcloud_primary_ip.prod_ipv4.id
}

output "hetzner_location" {
  description = "Hetzner location used for both the server and primary IPv4."
  value       = var.hetzner_location
}

output "hetzner_firewall_id" {
  description = "Hetzner firewall ID attached to the production VM."
  value       = hcloud_firewall.prod.id
}

output "hetzner_dns_a_record_hint" {
  description = "DNS A record hint for production cutover."
  value       = "A ${var.domain} ${hcloud_primary_ip.prod_ipv4.ip_address}"
}

output "hetzner_ssh_command" {
  description = "SSH command for production VM operations."
  value       = "ssh root@${hcloud_primary_ip.prod_ipv4.ip_address}"
}

output "public_origin" {
  description = "Public production origin routed to the Hetzner VM."
  value       = "https://${var.domain}"
}
