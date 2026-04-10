output "firestore_database_id" {
  description = "Shared Firestore database name (owned by dev env, hardcoded constant)"
  value       = local.firestore_database_id
}

output "environment" {
  description = "Environment name"
  value       = var.environment
}
