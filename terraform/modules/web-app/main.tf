# Web App Module
# Creates a public Google Cloud Storage bucket for SPA hosting with proper routing.

resource "google_storage_bucket" "web_app" {
  name     = "${var.bucket_name}-${var.environment}"
  location = var.region
  project  = var.project_id

  # Uniform bucket-level access (required for public access)
  uniform_bucket_level_access = true

  # SPA routing: serve index.html for all paths
  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }

  # CORS configuration for API calls
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "OPTIONS"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  labels = var.labels

  # Versioning for rollback capability
  versioning {
    enabled = true
  }

  # Lifecycle rule to clean up old versions
  lifecycle_rule {
    condition {
      num_newer_versions = 5
    }
    action {
      type = "Delete"
    }
  }
}

# Make bucket publicly readable
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.web_app.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

