output "service_accounts" {
  description = "Map of service names to their service account emails"
  value = {
    auth_service       = google_service_account.auth_service.email
    notion_gpt_service = google_service_account.notion_gpt_service.email
    api_docs_hub       = google_service_account.api_docs_hub.email
  }
}

output "auth_service_sa" {
  description = "Auth service service account email"
  value       = google_service_account.auth_service.email
}

output "notion_gpt_service_sa" {
  description = "Notion GPT service service account email"
  value       = google_service_account.notion_gpt_service.email
}

output "api_docs_hub_sa" {
  description = "API Docs Hub service account email"
  value       = google_service_account.api_docs_hub.email
}

