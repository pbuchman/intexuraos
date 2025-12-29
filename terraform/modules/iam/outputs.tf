output "service_accounts" {
  description = "Map of service names to their service account emails"
  value = {
    user_service                 = google_service_account.user_service.email
    promptvault_service          = google_service_account.promptvault_service.email
    notion_service               = google_service_account.notion_service.email
    whatsapp_service             = google_service_account.whatsapp_service.email
    api_docs_hub                 = google_service_account.api_docs_hub.email
    mobile_notifications_service = google_service_account.mobile_notifications_service.email
  }
}

output "user_service_sa" {
  description = "User service service account email"
  value       = google_service_account.user_service.email
}

output "promptvault_service_sa" {
  description = "PromptVault service service account email"
  value       = google_service_account.promptvault_service.email
}

output "notion_service_sa" {
  description = "Notion service service account email"
  value       = google_service_account.notion_service.email
}

output "whatsapp_service_sa" {
  description = "WhatsApp service service account email"
  value       = google_service_account.whatsapp_service.email
}

output "api_docs_hub_sa" {
  description = "API Docs Hub service account email"
  value       = google_service_account.api_docs_hub.email
}

output "mobile_notifications_service_sa" {
  description = "Mobile Notifications service service account email"
  value       = google_service_account.mobile_notifications_service.email
}

