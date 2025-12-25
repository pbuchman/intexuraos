# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

# Root outputs are intentionally minimal.
# Environment-level outputs live in `terraform/environments/dev/main.tf`.

output "project_id" {
  description = "GCP project ID"
  value       = var.project_id
}

output "region" {
  description = "GCP region"
  value       = var.region
}
