output "connection_name" {
  description = "Cloud Build GitHub connection name"
  value       = google_cloudbuildv2_connection.github.name
}

output "repository_id" {
  description = "Cloud Build repository ID"
  value       = google_cloudbuildv2_repository.intexuraos.id
}

output "webhook_trigger_id" {
  description = "Webhook trigger ID for development branch"
  value       = google_cloudbuild_trigger.webhook_dev.trigger_id
}

output "webhook_trigger_name" {
  description = "Webhook trigger name"
  value       = google_cloudbuild_trigger.webhook_dev.name
}

output "manual_trigger_id" {
  description = "Manual trigger ID for main branch"
  value       = google_cloudbuild_trigger.manual_main.trigger_id
}

output "manual_trigger_name" {
  description = "Manual trigger name"
  value       = google_cloudbuild_trigger.manual_main.name
}

output "cloud_build_service_account" {
  description = "Cloud Build service account email"
  value       = google_service_account.cloud_build.email
}
