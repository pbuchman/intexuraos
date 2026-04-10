# IntexuraOS Prod Environment (Hetzner)
# See: docs/superpowers/plans/2026-04-10-hetzner-prod-migration.md

locals {
  common_labels = {
    environment = "prod"
    managed_by  = "terraform"
    component   = "prod-hetzner"
  }

  # Shared Firestore (default) — owned by the dev environment.
  # The database name is a GCP-API-level constant, not a Terraform-managed value,
  # so downstream resources hardcode "(default)" when they need to reference it.
  # See Decision 3 in the migration plan.
  firestore_database_id = "(default)"
}
