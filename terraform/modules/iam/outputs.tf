output "service_accounts" {
  description = "Map of service names to their service account emails"
  value = {
    user_service                 = google_service_account.user_service.email
    promptvault_service          = google_service_account.promptvault_service.email
    notion_service               = google_service_account.notion_service.email
    whatsapp_service             = google_service_account.whatsapp_service.email
    api_docs_hub                 = google_service_account.api_docs_hub.email
    mobile_notifications_service = google_service_account.mobile_notifications_service.email
    research_agent               = google_service_account.research_agent.email
    commands_agent              = google_service_account.commands_agent.email
    actions_agent                = google_service_account.actions_agent.email
    data_insights_service        = google_service_account.data_insights_service.email
    image_service                = google_service_account.image_service.email
    notes_agent                  = google_service_account.notes_agent.email
    app_settings_service         = google_service_account.app_settings_service.email
    todos_agent                  = google_service_account.todos_agent.email
    bookmarks_agent              = google_service_account.bookmarks_agent.email
    calendar_agent               = google_service_account.calendar_agent.email
    web_agent                    = google_service_account.web_agent.email
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

output "research_agent_sa" {
  description = "Research Agent service account email"
  value       = google_service_account.research_agent.email
}

output "commands_agent_sa" {
  description = "Commands Agent service account email"
  value       = google_service_account.commands_agent.email
}

output "actions_agent_sa" {
  description = "Actions Agent service account email"
  value       = google_service_account.actions_agent.email
}

output "data_insights_service_sa" {
  description = "Data Insights Service service account email"
  value       = google_service_account.data_insights_service.email
}

output "image_service_sa" {
  description = "Image Service service account email"
  value       = google_service_account.image_service.email
}

output "notes_agent_sa" {
  description = "Notes Agent service account email"
  value       = google_service_account.notes_agent.email
}

output "app_settings_service_sa" {
  description = "App Settings Service service account email"
  value       = google_service_account.app_settings_service.email
}

output "todos_agent_sa" {
  description = "Todos Agent service account email"
  value       = google_service_account.todos_agent.email
}

output "bookmarks_agent_sa" {
  description = "Bookmarks Agent service account email"
  value       = google_service_account.bookmarks_agent.email
}

output "calendar_agent_sa" {
  description = "Calendar Agent service account email"
  value       = google_service_account.calendar_agent.email
}

output "web_agent_sa" {
  description = "Web Agent service account email"
  value       = google_service_account.web_agent.email
}
