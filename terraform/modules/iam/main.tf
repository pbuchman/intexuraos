# IAM Module
# Creates service accounts and IAM bindings for PraxOS services.

# Service account for auth-service
resource "google_service_account" "auth_service" {
  account_id   = "praxos-auth-svc-${var.environment}"
  display_name = "PraxOS Auth Service (${var.environment})"
  description  = "Service account for auth-service Cloud Run deployment"
}

# Service account for notion-gpt-service
resource "google_service_account" "notion_gpt_service" {
  account_id   = "praxos-notion-svc-${var.environment}"
  display_name = "PraxOS Notion GPT Service (${var.environment})"
  description  = "Service account for notion-gpt-service Cloud Run deployment"
}

# Service account for api-docs-hub
resource "google_service_account" "api_docs_hub" {
  account_id   = "praxos-docs-hub-${var.environment}"
  display_name = "PraxOS API Docs Hub (${var.environment})"
  description  = "Service account for api-docs-hub Cloud Run deployment"
}

# Auth service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "auth_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.auth_service.email}"
}

# Notion GPT service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "notion_gpt_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.notion_gpt_service.email}"
}

# Notion GPT service: Firestore access
resource "google_project_iam_member" "notion_gpt_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.notion_gpt_service.email}"
}

# Auth service: Firestore access (for future session/token storage)
resource "google_project_iam_member" "auth_service_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.auth_service.email}"
}

# Both services: Cloud Logging (automatic for Cloud Run, but explicit)
resource "google_project_iam_member" "auth_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.auth_service.email}"
}

resource "google_project_iam_member" "notion_gpt_service_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.notion_gpt_service.email}"
}

# API Docs Hub: Cloud Logging
resource "google_project_iam_member" "api_docs_hub_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.api_docs_hub.email}"
}

