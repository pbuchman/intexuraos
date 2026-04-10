output "firestore_database_id" {
  description = "Shared Firestore database name (owned by dev env, hardcoded constant)"
  value       = local.firestore_database_id
}

output "environment" {
  description = "Environment name"
  value       = var.environment
}

output "hetzner_server_ipv4" {
  description = "Hetzner VM public IPv4 — use for DNS A record at cutover"
  value       = hcloud_primary_ip.prod_ipv4.ip_address
}

output "hetzner_server_name" {
  description = "Hetzner VM name"
  value       = hcloud_server.prod.name
}

output "dns_update_hint" {
  description = "DNS record to create at cutover (Cloudflare: A record, proxy OFF)"
  value       = "A ${var.domain} ${hcloud_primary_ip.prod_ipv4.ip_address}"
}
