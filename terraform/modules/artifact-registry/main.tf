# Artifact Registry Module
# Creates a Docker repository for Cloud Run service images.

resource "google_artifact_registry_repository" "intexuraos" {
  location      = var.region
  repository_id = "intexuraos-${var.environment}"
  description   = "Docker repository for IntexuraOS ${var.environment} services"
  format        = "DOCKER"
  labels        = var.labels

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }
}

