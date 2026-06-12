output "connection_name" {
  description = "Cloud Build GitHub connection name"
  value       = google_cloudbuildv2_connection.github.name
}

output "repository_id" {
  description = "Cloud Build repository ID"
  value       = google_cloudbuildv2_repository.intexuraos.id
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

output "firestore_trigger" {
  description = "Firestore trigger name"
  value       = google_cloudbuild_trigger.firestore.name
}

output "code_worker_trigger_id" {
  description = "code-worker trigger ID"
  value       = google_cloudbuild_trigger.code_worker.trigger_id
}

output "code_worker_scheduler_job" {
  description = "code-worker daily rebuild scheduler job name"
  value       = google_cloud_scheduler_job.code_worker_daily_rebuild.name
}
