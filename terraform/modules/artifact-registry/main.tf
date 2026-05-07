# Artifact Registry Module
# Creates a Docker repository for Cloud Run service images.

resource "google_artifact_registry_repository" "intexuraos" {
  location               = var.region
  repository_id          = "intexuraos-${var.environment}"
  description            = "Docker repository for IntexuraOS ${var.environment} services"
  format                 = "DOCKER"
  labels                 = var.labels
  cleanup_policy_dry_run = var.cleanup_policy_dry_run

  cleanup_policies {
    id     = "delete-stale-images"
    action = "DELETE"

    condition {
      older_than = var.cleanup_delete_older_than
      tag_state  = "ANY"
    }
  }

  cleanup_policies {
    id     = "delete-stale-code-worker"
    action = "DELETE"

    condition {
      older_than            = var.code_worker_cleanup_delete_older_than
      package_name_prefixes = ["code-worker"]
      tag_state             = "ANY"
    }
  }

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = var.cleanup_keep_count
    }
  }
}
