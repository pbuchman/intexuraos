# IAM Module
# Creates service accounts and IAM bindings for IntexuraOS services.

# Service account for auth-service
resource "google_service_account" "auth_service" {
  account_id   = "intexuraos-auth-svc-${var.environment}"
  display_name = "IntexuraOS Auth Service (${var.environment})"
  description  = "Service account for auth-service Cloud Run deployment"
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


# Auth service: Secret Manager access
resource "google_secret_manager_secret_iam_member" "auth_service_secrets" {
  for_each = var.secret_ids

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.auth_service.email}"
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

