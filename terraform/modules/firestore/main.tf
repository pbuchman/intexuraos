# Firestore Module
# Creates a Firestore database in Native mode.

resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  # ABANDON: database survives even if removed from Terraform state or on destroy
  deletion_policy = "ABANDON"

  # Point-in-time recovery (disabled — see follow-up task for PITR decision)
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"

  lifecycle {
    prevent_destroy = true
  }
}

