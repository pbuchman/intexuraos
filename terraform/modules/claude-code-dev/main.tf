# Claude Code Dev Service Account Module
# Creates a service account for local development with Claude Code CLI.
# This service account provides admin access for development workflows
# including terraform operations, Firestore queries, and resource management.
#
# IMPORTANT: Key management is external to Terraform.
# After the service account is created, manually generate a key via:
#   gcloud iam service-accounts keys create ~/personal/gcloud-claude-code-dev.json \
#     --iam-account=claude-code-dev@${project_id}.iam.gserviceaccount.com
#
# Keys should be stored securely outside of version control.

resource "google_service_account" "claude_code_dev" {
  account_id   = "claude-code-dev"
  display_name = "claude-code-dev"
  description  = "Service account for Claude Code development"
}

# Project-level IAM roles for full terraform management capabilities
locals {
  project_roles = [
    "roles/artifactregistry.admin",
    "roles/cloudbuild.connectionAdmin",
    "roles/cloudscheduler.admin",
    "roles/compute.admin",
    "roles/firebase.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.workloadIdentityPoolAdmin",
    "roles/logging.admin",
    "roles/monitoring.admin",
    "roles/pubsub.admin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/run.admin",
    "roles/secretmanager.admin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/storage.objectAdmin",
  ]
}

resource "google_project_iam_member" "claude_code_dev_roles" {
  for_each = toset(local.project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.claude_code_dev.email}"
}
