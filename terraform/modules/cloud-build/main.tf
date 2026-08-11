# Cloud Build Module
# Creates the GitHub repository connection and retained GCP deployment triggers.
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
  description  = "Service account for retained Firestore, Cloud Function, and code-worker builds"
}

# Cloud Build needs to push to Artifact Registry
resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.project_id
  location   = var.region
  repository = "intexuraos-${var.environment}"
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Cloud Functions Gen2 deploys update Cloud Run-backed services.
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

# Cloud Build needs retained secret access for function deploy and migrations.
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

locals {
  cloud_function_workers = [
    "transcription",
  ]
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
# Individual triggers for retained Cloud Function workers (transcription).
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
# code-worker Docker Image Trigger
# -----------------------------------------------------------------------------
# Individual trigger for code-worker Docker image (build+push only, no deploy).
# Does not trigger on git push — invoked via GitHub Actions workflow.

resource "google_cloudbuild_trigger" "code_worker" {
  name        = "code-worker"
  description = "Build and push code-worker Docker image"
  location    = var.region

  source_to_build {
    repository = google_cloudbuildv2_repository.intexuraos.id
    ref        = "refs/heads/${var.github_branch}"
    repo_type  = "GITHUB"
  }

  ignored_files = ["**"]
  filename      = "docker/code-worker/cloudbuild.yaml"

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

# -----------------------------------------------------------------------------
# code-worker Daily Rebuild Schedule
# -----------------------------------------------------------------------------
# Rebuilds the code-worker image daily to pick up the latest worker CLI releases.
# Anthropic's peak release window is 3-6 PM PST (23:00-02:00 UTC).
# Schedule: 4 AM UTC (8 PM PST) — after the release window closes.

resource "google_cloud_scheduler_job" "code_worker_daily_rebuild" {
  name        = "code-worker-daily-rebuild-${var.environment}"
  description = "Daily rebuild of code-worker Docker image to pick up latest worker CLIs"
  schedule    = "0 4 * * *"
  time_zone   = "UTC"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "https://cloudbuild.googleapis.com/v1/projects/${var.project_id}/locations/${var.region}/triggers/${google_cloudbuild_trigger.code_worker.trigger_id}:run"
    body = base64encode(jsonencode({
      source = {
        branchName = var.github_branch
      }
    }))
    headers = {
      "Content-Type" = "application/json"
    }

    oauth_token {
      service_account_email = google_service_account.cloud_build.email
    }
  }

  retry_config {
    retry_count          = 2
    max_retry_duration   = "120s"
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
  }

  depends_on = [
    google_cloudbuild_trigger.code_worker,
    google_project_iam_member.cloud_build_scheduler,
  ]
}

# Cloud Build SA needs permission to run triggers via the API
resource "google_project_iam_member" "cloud_build_scheduler" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.editor"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
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
