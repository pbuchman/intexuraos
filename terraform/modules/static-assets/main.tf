# Static Assets Module
# Creates a public Google Cloud Storage bucket for static assets (branding, logos, docs visuals).

resource "google_storage_bucket" "static_assets" {
  name     = "praxos-static-assets-${var.environment}"
  location = var.region
  project  = var.project_id

  # Uniform bucket-level access (required for public access)
  uniform_bucket_level_access = true

  # CORS configuration for cross-origin access
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  labels = var.labels

  # Lifecycle rule to manage old versions
  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }
}

# Make bucket publicly readable (anonymous access)
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.static_assets.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

