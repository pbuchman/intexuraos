# IAM Module
# Creates service accounts and IAM bindings for IntexuraOS services.

# Service account for user-service
resource "google_service_account" "user_service" {
  account_id   = "intexuraos-user-svc-${var.environment}"
  display_name = "IntexuraOS User Service (${var.environment})"
  description  = "Service account for user-service Cloud Run deployment"
}

# Service account for promptvault-service
resource "google_service_account" "promptvault_service" {
  account_id   = "intexuraos-pv-svc-${var.environment}"
  display_name = "IntexuraOS PromptVault Service (${var.environment})"
  description  = "Service account for promptvault-service Cloud Run deployment"
}

# Service account for notion-service
resource "google_service_account" "notion_service" {
  account_id   = "intexuraos-notion-svc-${var.environment}"
  display_name = "IntexuraOS Notion Service (${var.environment})"
  description  = "Service account for notion-service Cloud Run deployment"
}

# Service account for whatsapp-service
resource "google_service_account" "whatsapp_service" {
  account_id   = "intexuraos-whatsapp-svc-${var.environment}"
  display_name = "IntexuraOS WhatsApp Service (${var.environment})"
  description  = "Service account for whatsapp-service Cloud Run deployment"
}

# Service account for api-docs-hub
resource "google_service_account" "api_docs_hub" {
  account_id   = "intexuraos-docs-hub-${var.environment}"
  display_name = "IntexuraOS API Docs Hub (${var.environment})"
  description  = "Service account for api-docs-hub Cloud Run deployment"
}

# Service account for mobile-notifications-service
resource "google_service_account" "mobile_notifications_service" {
  account_id   = "intexuraos-mobile-svc-${var.environment}"
  display_name = "IntexuraOS Mobile Notifications Service (${var.environment})"
  description  = "Service account for mobile-notifications-service Cloud Run deployment"
}

# Service account for research-agent
resource "google_service_account" "research_agent" {
  account_id   = "intexuraos-research-agent-${var.environment}"
  display_name = "IntexuraOS Research Agent (${var.environment})"
  description  = "Service account for research-agent Cloud Run deployment"
}

# Service account for commands-agent
resource "google_service_account" "commands_agent" {
  account_id   = "intexuraos-commands-agents-${var.environment}"
  display_name = "IntexuraOS Commands Agent (${var.environment})"
  description  = "Service account for commands-agent Cloud Run deployment"
}

# Service account for actions-agent
resource "google_service_account" "actions_agent" {
  account_id   = "intexuraos-actions-${var.environment}"
  display_name = "IntexuraOS Actions Agent (${var.environment})"
  description  = "Service account for actions-agent Cloud Run deployment"
}

# Service account for data-insights-agent
resource "google_service_account" "data_insights_agent" {
  account_id   = "intexuraos-insights-${var.environment}"
  display_name = "IntexuraOS Data Insights Agent (${var.environment})"
  description  = "Service account for data-insights-agent Cloud Run deployment"
}

# Service account for image-service
resource "google_service_account" "image_service" {
  account_id   = "intexuraos-image-svc-${var.environment}"
  display_name = "IntexuraOS Image Service (${var.environment})"
  description  = "Service account for image-service Cloud Run deployment"
}

# Service account for notes-agent
resource "google_service_account" "notes_agent" {
  account_id   = "intexuraos-notes-svc-${var.environment}"
  display_name = "IntexuraOS Notes Agent (${var.environment})"
  description  = "Service account for notes-agent Cloud Run deployment"
}

# Service account for app-settings-service
resource "google_service_account" "app_settings_service" {
  account_id   = "intexuraos-settings-${var.environment}"
  display_name = "IntexuraOS App Settings Service (${var.environment})"
  description  = "Service account for app-settings-service Cloud Run deployment"
}

# Service account for todos-agent
resource "google_service_account" "todos_agent" {
  account_id   = "intexuraos-todos-${var.environment}"
  display_name = "IntexuraOS Todos Agent (${var.environment})"
  description  = "Service account for todos-agent Cloud Run deployment"
}

# Service account for bookmarks-agent
resource "google_service_account" "bookmarks_agent" {
  account_id   = "intexuraos-bookmarks-${var.environment}"
  display_name = "IntexuraOS Bookmarks Agent (${var.environment})"
  description  = "Service account for bookmarks-agent Cloud Run deployment"
}

# Service account for calendar-agent
resource "google_service_account" "calendar_agent" {
  account_id   = "intexuraos-calendar-${var.environment}"
  display_name = "IntexuraOS Calendar Agent (${var.environment})"
  description  = "Service account for calendar-agent Cloud Run deployment"
}

# Service account for web-agent
resource "google_service_account" "web_agent" {
  account_id   = "intexuraos-web-agent-${var.environment}"
  display_name = "IntexuraOS Web Agent (${var.environment})"
  description  = "Service account for web-agent Cloud Run deployment"
}

# Service account for linear-agent
resource "google_service_account" "linear_agent" {
  account_id   = "intexuraos-linear-${var.environment}"
  display_name = "IntexuraOS Linear Agent (${var.environment})"
  description  = "Service account for linear-agent Cloud Run deployment"
}


# User service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "user_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.user_service.email}"
}

# PromptVault service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "promptvault_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.promptvault_service.email}"
}

# Notion service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "notion_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.notion_service.email}"
}

# WhatsApp service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "whatsapp_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.whatsapp_service.email}"
}

# Mobile Notifications service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "mobile_notifications_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.mobile_notifications_service.email}"
}

# Research Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "research_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.research_agent.email}"
}

# Commands Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "commands_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.commands_agent.email}"
}

# Actions Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "actions_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.actions_agent.email}"
}

# Data Insights Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "data_insights_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.data_insights_agent.email}"
}

# Image Service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "image_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.image_service.email}"
}

# Notes Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "notes_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.notes_agent.email}"
}

# App Settings Service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "app_settings_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app_settings_service.email}"
}

# Todos Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "todos_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.todos_agent.email}"
}

# Bookmarks Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "bookmarks_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.bookmarks_agent.email}"
}

# Calendar Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "calendar_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.calendar_agent.email}"
}

# Web Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "web_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web_agent.email}"
}

# Linear Agent: Secret Manager access
resource "google_secret_manager_secret_iam_member" "linear_agent_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.linear_agent.email}"
}

# API Docs Hub: Secret Manager access
resource "google_secret_manager_secret_iam_member" "api_docs_hub_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_docs_hub.email}"
}


# PromptVault service: Firestore access
resource "google_project_iam_member" "promptvault_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.promptvault_service.email}"
}

# Notion service: Firestore access
resource "google_project_iam_member" "notion_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.notion_service.email}"
}

# WhatsApp service: Firestore access
resource "google_project_iam_member" "whatsapp_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.whatsapp_service.email}"
}

# Mobile Notifications service: Firestore access
resource "google_project_iam_member" "mobile_notifications_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.mobile_notifications_service.email}"
}

# User service: Firestore access (for future session/token storage)
resource "google_project_iam_member" "user_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.user_service.email}"
}

# User service: Firebase Auth Admin (for creating custom tokens)
resource "google_project_iam_member" "user_service_firebase_auth" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.user_service.email}"
}

# User service: Allow signing custom tokens (service account signs on itself)
resource "google_service_account_iam_member" "user_service_token_creator" {
  service_account_id = google_service_account.user_service.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.user_service.email}"
}

# Research Agent: Firestore access
resource "google_project_iam_member" "research_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.research_agent.email}"
}

# Commands Agent: Firestore access
resource "google_project_iam_member" "commands_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.commands_agent.email}"
}

# Actions Agent: Firestore access
resource "google_project_iam_member" "actions_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.actions_agent.email}"
}

# Data Insights Agent: Firestore access
resource "google_project_iam_member" "data_insights_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.data_insights_agent.email}"
}

# Image Service: Firestore access
resource "google_project_iam_member" "image_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.image_service.email}"
}

# Notes Agent: Firestore access
resource "google_project_iam_member" "notes_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.notes_agent.email}"
}

# App Settings Service: Firestore access (for pricing configuration)
resource "google_project_iam_member" "app_settings_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.app_settings_service.email}"
}

# Todos Agent: Firestore access
resource "google_project_iam_member" "todos_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.todos_agent.email}"
}

# Bookmarks Agent: Firestore access
resource "google_project_iam_member" "bookmarks_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.bookmarks_agent.email}"
}

# Linear Agent: Firestore access
resource "google_project_iam_member" "linear_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.linear_agent.email}"
}


# All services: Cloud Logging (automatic for Cloud Run, but explicit)
resource "google_project_iam_member" "user_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.user_service.email}"
}

resource "google_project_iam_member" "promptvault_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.promptvault_service.email}"
}

# Notion service: Cloud Logging
resource "google_project_iam_member" "notion_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.notion_service.email}"
}

# WhatsApp service: Cloud Logging
resource "google_project_iam_member" "whatsapp_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.whatsapp_service.email}"
}

# WhatsApp service: Service Account Token Creator (for signing GCS URLs)
resource "google_service_account_iam_member" "whatsapp_service_token_creator" {
  service_account_id = google_service_account.whatsapp_service.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.whatsapp_service.email}"
}

# API Docs Hub: Cloud Logging
resource "google_project_iam_member" "api_docs_hub_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.api_docs_hub.email}"
}

# Mobile Notifications service: Cloud Logging
resource "google_project_iam_member" "mobile_notifications_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.mobile_notifications_service.email}"
}

# Research Agent: Cloud Logging
resource "google_project_iam_member" "research_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.research_agent.email}"
}

# Commands Agent: Cloud Logging
resource "google_project_iam_member" "commands_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.commands_agent.email}"
}

# Actions Agent: Cloud Logging
resource "google_project_iam_member" "actions_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.actions_agent.email}"
}

# Data Insights Agent: Cloud Logging
resource "google_project_iam_member" "data_insights_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.data_insights_agent.email}"
}

# Image Service: Cloud Logging
resource "google_project_iam_member" "image_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.image_service.email}"
}

# Notes Agent: Cloud Logging
resource "google_project_iam_member" "notes_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.notes_agent.email}"
}

# App Settings Service: Cloud Logging
resource "google_project_iam_member" "app_settings_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.app_settings_service.email}"
}

# Todos Agent: Cloud Logging
resource "google_project_iam_member" "todos_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.todos_agent.email}"
}

# Bookmarks Agent: Cloud Logging
resource "google_project_iam_member" "bookmarks_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.bookmarks_agent.email}"
}

# Calendar Agent: Cloud Logging
resource "google_project_iam_member" "calendar_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.calendar_agent.email}"
}

# Web Agent: Cloud Logging
resource "google_project_iam_member" "web_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.web_agent.email}"
}

# Linear Agent: Cloud Logging
resource "google_project_iam_member" "linear_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.linear_agent.email}"
}
