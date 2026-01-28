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
resource "google_cloudbuildv2_repository" "intexuraos" {
  project           = var.project_id
  location          = var.region
  name              = "${var.github_owner}-${var.github_repo}"
  parent_connection = google_cloudbuildv2_connection.github.name
  remote_uri        = "https://github.com/${var.github_owner}/${var.github_repo}.git"
}

# -----------------------------------------------------------------------------
# Service Account for Cloud Build
# -----------------------------------------------------------------------------

resource "google_service_account" "cloud_build" {
  account_id   = "intexuraos-cloudbuild-${var.environment}"
  display_name = "IntexuraOS Cloud Build Service Account (${var.environment})"
  description  = "Service account for Cloud Build to deploy IntexuraOS services"
}

# Cloud Build needs to push to Artifact Registry
resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.project_id
  location   = var.region
  repository = "intexuraos-${var.environment}"
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

# Cloud Build needs to access secrets for web build (INTEXURAOS_* env vars)
resource "google_project_iam_member" "cloud_build_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}


# Cloud Build needs to trigger builds via API (for GitHub Actions integration)
resource "google_project_iam_member" "cloud_build_builds_editor" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.editor"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Cloud Build needs Firebase Admin to deploy Firestore indexes and rules
resource "google_project_iam_member" "cloud_build_firebase_admin" {
  project = var.project_id
  role    = "roles/firebase.admin"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Cloud Build needs to deploy Cloud Functions
resource "google_project_iam_member" "cloud_build_functions_developer" {
  project = var.project_id
  role    = "roles/cloudfunctions.developer"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

# -----------------------------------------------------------------------------
# Cloud Build Trigger (invoked by GitHub Actions)
# -----------------------------------------------------------------------------
# Note: No automatic push trigger - deployments are controlled via GitHub Actions
# workflow (.github/workflows/deploy.yml) which calls this trigger.

resource "google_cloudbuild_trigger" "manual_main" {
  name        = "intexuraos-${var.environment}-deploy"
  description = "Deploy trigger - builds and deploys all services unconditionally"
  location    = var.region

  source_to_build {
    repository = google_cloudbuildv2_repository.intexuraos.id
    ref        = "refs/heads/${var.github_branch}"
    repo_type  = "GITHUB"
  }

  filename = "cloudbuild/cloudbuild.yaml"

  substitutions = {
    _REGION                  = var.region
    _ARTIFACT_REGISTRY_URL   = var.artifact_registry_url
    _ENVIRONMENT             = var.environment
    _FUNCTIONS_SOURCE_BUCKET = var.functions_source_bucket
  }

  service_account = google_service_account.cloud_build.id
}

# -----------------------------------------------------------------------------
# Per-Service Triggers
# -----------------------------------------------------------------------------
# Individual service triggers invoked by GitHub Actions (INDIVIDUAL strategy).
# They deploy a single service without triggering on git push.
# The `ignored_files = ["**"]` pattern ensures no automatic execution.

locals {
  # Docker-based services (build + deploy)
  docker_services = [
    "user-service",
    "notion-service",
    "whatsapp-service",
    "api-docs-hub",
    "mobile-notifications-service",
    "research-agent",
    "commands-agent",
    "actions-agent",
    "data-insights-agent",
    "image-service",
    "notes-agent",
    "todos-agent",
    "bookmarks-agent",
    "app-settings-service",
    "calendar-agent",
    "linear-agent",
    "web-agent",
    "code-agent",
  ]

  # Cloud Function workers (zip + upload to GCS)
  cloud_function_workers = [
    "vm-lifecycle",
    "log-cleanup",
  ]
}

# Individual triggers for Docker-based services
resource "google_cloudbuild_trigger" "service" {
  for_each = toset(local.docker_services)

  name        = each.key
  description = "Deploy ${each.key} only"
  location    = var.region

  source_to_build {
    repository = google_cloudbuildv2_repository.intexuraos.id
    ref        = "refs/heads/${var.github_branch}"
    repo_type  = "GITHUB"
  }

  # Ignore all files to prevent automatic triggering on push
  ignored_files = ["**"]

  filename = "apps/${each.key}/cloudbuild.yaml"

  substitutions = {
    _REGION                = var.region
    _ARTIFACT_REGISTRY_URL = var.artifact_registry_url
    _ENVIRONMENT           = var.environment
  }

  service_account = google_service_account.cloud_build.id

  lifecycle {
    # GCP API normalizes ignored_files=["**"] to null, causing perpetual drift
    ignore_changes = [ignored_files]
  }
}

# Web trigger (special: pnpm build + secrets)
resource "google_cloudbuild_trigger" "web" {
  name        = "web"
  description = "Deploy web frontend only"
  location    = var.region

  source_to_build {
    repository = google_cloudbuildv2_repository.intexuraos.id
    ref        = "refs/heads/${var.github_branch}"
    repo_type  = "GITHUB"
  }

  ignored_files = ["**"]

  filename = "apps/web/cloudbuild.yaml"

  substitutions = {
    _REGION      = var.region
    _ENVIRONMENT = var.environment
  }

  service_account = google_service_account.cloud_build.id

  lifecycle {
    # GCP API normalizes ignored_files=["**"] to null, causing perpetual drift
    ignore_changes = [ignored_files]
  }
}

# Firestore migrations trigger
resource "google_cloudbuild_trigger" "firestore" {
  name        = "firestore"
  description = "Deploy Firestore migrations only"
  location    = var.region

  source_to_build {
    repository = google_cloudbuildv2_repository.intexuraos.id
    ref        = "refs/heads/${var.github_branch}"
    repo_type  = "GITHUB"
  }

  ignored_files = ["**"]

  filename = "cloudbuild/cloudbuild-firestore.yaml"

  service_account = google_service_account.cloud_build.id

  lifecycle {
    # GCP API normalizes ignored_files=["**"] to null, causing perpetual drift
    ignore_changes = [ignored_files]
  }
}

# -----------------------------------------------------------------------------
# Cloud Function Worker Triggers
# -----------------------------------------------------------------------------
# Individual triggers for Cloud Function workers (vm-lifecycle, log-cleanup).
# These deploy function source to GCS without triggering on git push.

resource "google_cloudbuild_trigger" "worker" {
  for_each = toset(local.cloud_function_workers)

  name        = each.key
  description = "Deploy ${each.key} Cloud Function"
  location    = var.region

  source_to_build {
    repository = google_cloudbuildv2_repository.intexuraos.id
    ref        = "refs/heads/${var.github_branch}"
    repo_type  = "GITHUB"
  }

  ignored_files = ["**"]

  filename = "workers/${each.key}/cloudbuild.yaml"

  substitutions = {
    _REGION                  = var.region
    _ENVIRONMENT             = var.environment
    _FUNCTIONS_SOURCE_BUCKET = var.functions_source_bucket
  }

  service_account = google_service_account.cloud_build.id

  lifecycle {
    # GCP API normalizes ignored_files=["**"] to null, causing perpetual drift
    ignore_changes = [ignored_files]
  }
}

# Cloud Build needs to write to functions source bucket
resource "google_storage_bucket_iam_member" "cloud_build_functions_storage" {
  bucket = var.functions_source_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_build.email}"
}

# -----------------------------------------------------------------------------
# Workload Identity Federation (GitHub Actions → GCP)
# -----------------------------------------------------------------------------
# Allows GitHub Actions to authenticate to GCP without service account keys.
# See: https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions-${var.environment}"
  display_name              = "GitHub Actions (${var.environment})"
  description               = "Workload Identity Pool for GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub Provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  attribute_condition = "assertion.repository == '${var.github_owner}/${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Allow GitHub Actions to impersonate the Cloud Build service account
resource "google_service_account_iam_member" "github_actions_wif" {
  service_account_id = google_service_account.cloud_build.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_owner}/${var.github_repo}"
}
