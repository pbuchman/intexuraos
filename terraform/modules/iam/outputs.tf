output "service_accounts" {
  description = "Map of service names to their service account emails"
  value = {
    auth_service        = google_service_account.auth_service.email
    promptvault_service = google_service_account.promptvault_service.email
    whatsapp_service    = google_service_account.whatsapp_service.email
    api_docs_hub        = google_service_account.api_docs_hub.email
  }
}

output "auth_service_sa" {
  description = "Auth service service account email"
  value       = google_service_account.auth_service.email
}

output "promptvault_service_sa" {
  description = "PromptVault service service account email"
  value       = google_service_account.promptvault_service.email
}

output "whatsapp_service_sa" {
  description = "WhatsApp service service account email"
  value       = google_service_account.whatsapp_service.email
}

output "api_docs_hub_sa" {
  description = "API Docs Hub service account email"
  value       = google_service_account.api_docs_hub.email
}

