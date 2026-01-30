output "gateway_url" {
  description = "Pre-dev gateway URL (main entry point)"
  value       = google_cloudfunctions2_function.gateway.service_config[0].uri
}

output "webhook_url" {
  description = "Pre-dev webhook URL (for GitHub)"
  value       = google_cloudfunctions2_function.webhook.service_config[0].uri
}

output "vm_service_account" {
  description = "VM service account email"
  value       = google_service_account.predev_vm.email
}

output "functions_service_account" {
  description = "Functions service account email"
  value       = google_service_account.predev_functions.email
}

output "mig_name" {
  description = "Managed Instance Group name"
  value       = local.mig_name
}

output "report_ready_url" {
  description = "Report-ready function URL (VM calls this on startup)"
  value       = google_cloudfunctions2_function.report_ready.service_config[0].uri
}
