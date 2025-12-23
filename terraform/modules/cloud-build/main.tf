# Cloud Build Module
# Creates 2nd gen repository connection, webhook-triggered build, and manual trigger.
#
# IMPORTANT: The GitHub connection must be created via GCP Console first.
# Then import it into Terraform state before running apply.
# See docs/setup/03-cloud-build-trigger.md for setup instructions.

# -----------------------------------------------------------------------------
# 2nd Gen Repository Connection
# -----------------------------------------------------------------------------

# The connection must be created manually via GCP Console first.
# Then import it: terraform import module.cloud_build.google_cloudbuildv2_connection.github projects/PROJECT_ID/locations/REGION/connections/CONNECTION_NAME
#
# The lifecycle block prevents Terraform from trying to recreate it if it already exists.
resource "google_cloudbuildv2_connection" "github" {
  project  = var.project_id
  location = var.region
  name     = var.github_connection_name

  # GitHub config is managed by the Console OAuth flow
  # This empty block is required but will be populated by the import
  github_config {}

  lifecycle {
    # Prevent Terraform from modifying or recreating the connection
    # since it was created via Console with OAuth
    ignore_changes = [github_config]
  }
}

# Link the repository to the connection
resource "google_cloudbuildv2_repository" "praxos" {
  project           = var.project_id
  location          = var.region
  name              = var.github_repo
  parent_connection = google_cloudbuildv2_connection.github.name
  remote_uri        = "https://github.com/${var.github_owner}/${var.github_repo}.git"
}

# -----------------------------------------------------------------------------
# Service Account for Cloud Build
# -----------------------------------------------------------------------------

resource "google_service_account" "cloud_build" {
  account_id   = "praxos-cloudbuild-${var.environment}"
  display_name = "PraxOS Cloud Build Service Account (${var.environment})"
  description  = "Service account for Cloud Build to deploy PraxOS services"
}

# Cloud Build needs to push to Artifact Registry
resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.project_id
  location   = var.region
  repository = "praxos-${var.environment}"
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Cloud Build needs to deploy to Cloud Run
resource "google_project_iam_member" "cloud_build_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Cloud Build needs to act as service accounts
resource "google_project_iam_member" "cloud_build_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Cloud Build needs logging
resource "google_project_iam_member" "cloud_build_logs_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Cloud Build needs to write to static assets bucket
resource "google_storage_bucket_iam_member" "cloud_build_storage_admin" {
  bucket = var.static_assets_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_build.email}"
}

resource "google_storage_bucket_iam_member" "cloud_build_web_storage_admin" {
  bucket = var.web_app_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_build.email}"
}

# -----------------------------------------------------------------------------
# Webhook Trigger for Development Branch
# -----------------------------------------------------------------------------

resource "google_cloudbuild_trigger" "webhook_dev" {
  name        = "praxos-${var.environment}-webhook"
  description = "Webhook-triggered build for ${var.github_branch} branch"
  location    = var.region

  repository_event_config {
    repository = google_cloudbuildv2_repository.praxos.id

    push {
      branch = "^${var.github_branch}$"
    }
  }

  filename = "cloudbuild/cloudbuild.yaml"

  substitutions = {
    _REGION                = var.region
    _ARTIFACT_REGISTRY_URL = var.artifact_registry_url
    _ENVIRONMENT           = var.environment
    _FORCE_DEPLOY          = "false"
  }

  service_account = google_service_account.cloud_build.id

  include_build_logs = "INCLUDE_BUILD_LOGS_WITH_STATUS"
}

# -----------------------------------------------------------------------------
# Manual Trigger (Manual invocation only)
# -----------------------------------------------------------------------------

resource "google_cloudbuild_trigger" "manual_main" {
  name        = "praxos-${var.environment}-manual"
  description = "Manual trigger - force deploys all services from ${var.github_branch}"
  location    = var.region

  # Use source_to_build for manual triggers (no automatic event)
  source_to_build {
    repository = google_cloudbuildv2_repository.praxos.id
    ref        = "refs/heads/${var.github_branch}"
    repo_type  = "GITHUB"
  }

  filename = "cloudbuild/cloudbuild.yaml"

  substitutions = {
    _REGION                = var.region
    _ARTIFACT_REGISTRY_URL = var.artifact_registry_url
    _ENVIRONMENT           = var.environment
    _FORCE_DEPLOY          = "true"
  }

  service_account = google_service_account.cloud_build.id
}
