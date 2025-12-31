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

# Service account for llm-orchestrator-service
resource "google_service_account" "llm_orchestrator_service" {
  account_id   = "intexuraos-llm-orch-${var.environment}"
  display_name = "IntexuraOS LLM Orchestrator Service (${var.environment})"
  description  = "Service account for llm-orchestrator-service Cloud Run deployment"
}

# Service account for commands-router
resource "google_service_account" "commands_router" {
  account_id   = "intexuraos-cmd-router-${var.environment}"
  display_name = "IntexuraOS Commands Router (${var.environment})"
  description  = "Service account for commands-router Cloud Run deployment"
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

# LLM Orchestrator service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "llm_orchestrator_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.llm_orchestrator_service.email}"
}

# Commands Router: Secret Manager access
resource "google_secret_manager_secret_iam_member" "commands_router_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.commands_router.email}"
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

# LLM Orchestrator service: Firestore access
resource "google_project_iam_member" "llm_orchestrator_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.llm_orchestrator_service.email}"
}

# Commands Router: Firestore access
resource "google_project_iam_member" "commands_router_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.commands_router.email}"
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

# LLM Orchestrator service: Cloud Logging
resource "google_project_iam_member" "llm_orchestrator_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.llm_orchestrator_service.email}"
}

# Commands Router: Cloud Logging
resource "google_project_iam_member" "commands_router_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.commands_router.email}"
}

