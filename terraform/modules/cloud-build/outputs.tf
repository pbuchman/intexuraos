output "connection_name" {
  description = "Cloud Build GitHub connection name"
  value       = google_cloudbuildv2_connection.github.name
}

output "repository_id" {
  description = "Cloud Build repository ID"
  value       = google_cloudbuildv2_repository.intexuraos.id
}

output "deploy_trigger_id" {
  description = "Deploy trigger ID"
  value       = google_cloudbuild_trigger.manual_main.trigger_id
}

output "deploy_trigger_name" {
  description = "Deploy trigger name"
  value       = google_cloudbuild_trigger.manual_main.name
}

output "cloud_build_service_account" {
  description = "Cloud Build service account email"
  value       = google_service_account.cloud_build.email
}

output "cloud_build_service_account_name" {
  description = "Cloud Build service account full resource name (for WIF)"
  value       = google_service_account.cloud_build.name
}

# GitHub Actions OIDC outputs - use these values for GitHub secrets
output "github_actions_workload_identity_provider" {
  description = "Workload Identity Provider for GitHub Actions (use as GCP_WORKLOAD_IDENTITY_PROVIDER secret)"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_actions_service_account" {
  description = "Service account for GitHub Actions (use as GCP_SERVICE_ACCOUNT secret)"
  value       = google_service_account.cloud_build.email
}
