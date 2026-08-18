# IAM Module
# Creates service accounts and IAM bindings for IntexuraOS services.

# Service account for user-service
resource "google_service_account" "user_service" {
  account_id   = "intexuraos-user-svc-${var.environment}"
  display_name = "IntexuraOS User Service (${var.environment})"
  description  = "Service account for user-service Cloud Run deployment"
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

# Service account for fishing-assistant-service
resource "google_service_account" "fishing_assistant_service" {
  account_id   = "intexuraos-fishing-${var.environment}"
  display_name = "IntexuraOS Fishing Assistant Service (${var.environment})"
  description  = "Service account for fishing-assistant-service Cloud Run deployment"
}

# Service account for research-agent
resource "google_service_account" "research_agent" {
  account_id   = "intexuraos-research-agent-${var.environment}"
  display_name = "IntexuraOS Research Agent (${var.environment})"
  description  = "Service account for research-agent Cloud Run deployment"
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

# Service account for bookmarks-agent
resource "google_service_account" "bookmarks_agent" {
  account_id   = "intexuraos-bookmarks-${var.environment}"
  display_name = "IntexuraOS Bookmarks Agent (${var.environment})"
  description  = "Service account for bookmarks-agent Cloud Run deployment"
}

# Service account for code-agent
resource "google_service_account" "code_agent" {
  account_id   = "intexuraos-code-${var.environment}"
  display_name = "IntexuraOS Code Agent (${var.environment})"
  description  = "Service account for code-agent Cloud Run deployment"
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

# Service account for intex-agent
resource "google_service_account" "intex_agent" {
  account_id   = "intexuraos-intex-agent-${var.environment}"
  display_name = "IntexuraOS Intex Agent (${var.environment})"
  description  = "Service account for intex-agent Cloud Run deployment"
}

# Legacy Cloud Run secret bindings remain address-stable during the additive
# package cutover. The cleanup stage disables all of them in one reviewed apply.
resource "google_secret_manager_secret_iam_member" "user_service_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.user_service.email}"
}

resource "google_secret_manager_secret_iam_member" "notion_service_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.notion_service.email}"
}

resource "google_secret_manager_secret_iam_member" "whatsapp_service_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.whatsapp_service.email}"
}

resource "google_secret_manager_secret_iam_member" "mobile_notifications_service_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.mobile_notifications_service.email}"
}

resource "google_secret_manager_secret_iam_member" "fishing_assistant_service_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.fishing_assistant_service.email}"
}

resource "google_secret_manager_secret_iam_member" "research_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.research_agent.email}"
}

resource "google_secret_manager_secret_iam_member" "image_service_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.image_service.email}"
}

resource "google_secret_manager_secret_iam_member" "notes_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.notes_agent.email}"
}

resource "google_secret_manager_secret_iam_member" "app_settings_service_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app_settings_service.email}"
}

resource "google_secret_manager_secret_iam_member" "bookmarks_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.bookmarks_agent.email}"
}

resource "google_secret_manager_secret_iam_member" "calendar_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.calendar_agent.email}"
}

resource "google_secret_manager_secret_iam_member" "web_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web_agent.email}"
}

resource "google_secret_manager_secret_iam_member" "linear_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.linear_agent.email}"
}

resource "google_secret_manager_secret_iam_member" "intex_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.intex_agent.email}"
}

resource "google_secret_manager_secret_iam_member" "code_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.code_agent.email}"
}

resource "google_secret_manager_secret_iam_member" "api_docs_hub_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_docs_hub.email}"
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

# Fishing Assistant Service: Firestore access
resource "google_project_iam_member" "fishing_assistant_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.fishing_assistant_service.email}"
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

# Intex Agent: Firestore access
resource "google_project_iam_member" "intex_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.intex_agent.email}"
}

# Calendar Agent: Firestore access
resource "google_project_iam_member" "calendar_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.calendar_agent.email}"
}

# Code Agent: Firestore access
resource "google_project_iam_member" "code_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.code_agent.email}"
}

# All services: Cloud Logging (automatic for Cloud Run, but explicit)
resource "google_project_iam_member" "user_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.user_service.email}"
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

# Fishing Assistant Service: Cloud Logging
resource "google_project_iam_member" "fishing_assistant_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.fishing_assistant_service.email}"
}

# Research Agent: Cloud Logging
resource "google_project_iam_member" "research_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.research_agent.email}"
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

# Intex Agent: Cloud Logging
resource "google_project_iam_member" "intex_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.intex_agent.email}"
}

# Code Agent: Cloud Logging
resource "google_project_iam_member" "code_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.code_agent.email}"
}

# Code Agent: Cloud Monitoring custom metrics
resource "google_project_iam_member" "code_agent_monitoring_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.code_agent.email}"
}

# Hellscript Agent
resource "google_service_account" "hellscript_agent" {
  account_id   = "intexuraos-hellscript-${var.environment}"
  display_name = "IntexuraOS Hellscript Agent (${var.environment})"
  description  = "Service account for hellscript-agent Cloud Run deployment"
}

resource "google_secret_manager_secret_iam_member" "hellscript_agent_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hellscript_agent.email}"
}

resource "google_project_iam_member" "hellscript_agent_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.hellscript_agent.email}"
}

resource "google_project_iam_member" "hellscript_agent_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.hellscript_agent.email}"
}

# LLM Usage Service
resource "google_service_account" "llm_usage_service" {
  account_id   = "intexuraos-llm-usage-${var.environment}"
  display_name = "IntexuraOS LLM Usage Service (${var.environment})"
  description  = "Service account for llm-usage-service Cloud Run deployment"
}

resource "google_secret_manager_secret_iam_member" "llm_usage_service_secrets" {
  for_each = var.legacy_secret_manager_enabled ? var.secret_ids : {}

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.llm_usage_service.email}"
}

resource "google_project_iam_member" "llm_usage_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.llm_usage_service.email}"
}

resource "google_project_iam_member" "llm_usage_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.llm_usage_service.email}"
}
