output "function_name" {
  description = "Cloud Function name"
  value       = google_cloudfunctions2_function.function.name
}

output "function_uri" {
  description = "Cloud Function HTTP endpoint URI"
  value       = google_cloudfunctions2_function.function.service_config[0].uri
}

output "service_account" {
  description = "Service account used by the function"
  value       = google_cloudfunctions2_function.function.service_config[0].service_account_email
}
