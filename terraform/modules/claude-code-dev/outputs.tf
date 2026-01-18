output "service_account_email" {
  description = "Claude Code dev service account email"
  value       = google_service_account.claude_code_dev.email
}

output "service_account_id" {
  description = "Claude Code dev service account unique ID"
  value       = google_service_account.claude_code_dev.unique_id
}

output "service_account_name" {
  description = "Claude Code dev service account resource name"
  value       = google_service_account.claude_code_dev.name
}

output "granted_roles" {
  description = "List of IAM roles granted to the service account"
  value       = local.project_roles
}
