# Generated Images Bucket Module
# Creates a public Google Cloud Storage bucket for AI-generated images.
# Images are served directly via GCS public URL.
# Note: No lifecycle rule - images are deleted when associated research is unshared.

resource "google_storage_bucket" "generated_images" {
  name     = "intexuraos-images-${var.environment}"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  labels = var.labels
}

resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.generated_images.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Image Service: Full object access for upload
resource "google_storage_bucket_iam_member" "image_service_admin" {
  count  = var.enable_image_service_access ? 1 : 0
  bucket = google_storage_bucket.generated_images.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.image_service_service_account}"
}
