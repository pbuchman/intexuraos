# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "project_id" {
  description = "GCP project ID"
  value       = var.project_id
}

output "region" {
  description = "GCP region"
  value       = var.region
}

output "artifact_registry_url" {
  description = "Artifact Registry URL"
  value       = module.artifact_registry.repository_url
}

output "auth_service_url" {
  description = "Auth Service URL"
  value       = module.auth_service.service_url
}

output "promptvault_service_url" {
  description = "PromptVault Service URL"
  value       = module.promptvault_service.service_url
}

output "notion_service_url" {
  description = "Notion Service URL"
  value       = module.notion_service.service_url
}

output "whatsapp_service_url" {
  description = "WhatsApp Service URL"
  value       = module.whatsapp_service.service_url
}

output "api_docs_hub_url" {
  description = "API Docs Hub URL"
  value       = module.api_docs_hub.service_url
}

output "firestore_database" {
  description = "Firestore database name"
  value       = module.firestore.database_name
}

output "service_accounts" {
  description = "Service account emails"
  value       = module.iam.service_accounts
}

output "static_assets_bucket_name" {
  description = "Static assets bucket name"
  value       = module.static_assets.bucket_name
}

output "static_assets_public_url" {
  description = "Static assets public base URL"
  value       = module.static_assets.public_base_url
}

output "web_app_bucket_name" {
  description = "Web app bucket name"
  value       = module.web_app.bucket_name
}

output "web_app_url" {
  description = "Web app public URL"
  value       = module.web_app.website_url
}

output "web_app_load_balancer_ip" {
  description = "Web app load balancer IP (configure DNS A record to point to this)"
  value       = module.web_app.load_balancer_ip
}

output "web_app_dns_a_record_hint" {
  description = "DNS A record hint for web app"
  value       = module.web_app.web_app_dns_a_record_hint
}

output "web_app_cert_name" {
  description = "Managed SSL certificate name for web app"
  value       = module.web_app.web_app_cert_name
}
