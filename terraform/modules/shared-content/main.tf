# Shared Content Module
# Creates a public Google Cloud Storage bucket for shared research HTML files.
# Files are served via the web-app module's load balancer at /share/* path.

resource "google_storage_bucket" "shared_content" {
  name     = "intexuraos-shared-content-${var.environment}"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  labels = var.labels

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.shared_content.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Research Agent: Full object access for upload/delete of shared research HTML
resource "google_storage_bucket_iam_member" "research_agent_admin" {
  count  = var.enable_research_agent_access ? 1 : 0
  bucket = google_storage_bucket.shared_content.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.research_agent_service_account}"
}
