# WhatsApp Media Bucket Module
# Creates a private Google Cloud Storage bucket for WhatsApp media files (audio/images).
# No public access - only whatsapp-service can access via IAM; users access via signed URLs.

resource "google_storage_bucket" "whatsapp_media" {
  name     = "intexuraos-whatsapp-media-${var.environment}"
  location = var.region
  project  = var.project_id

  # Uniform bucket-level access (no ACLs, IAM only)
  uniform_bucket_level_access = true

  # Prevent accidental deletion
  force_destroy = false

  labels = var.labels

  # Versioning disabled - no version history needed for media files
  versioning {
    enabled = false
  }

  # Standard storage class
  storage_class = "STANDARD"

  # No lifecycle rules in phase 1 - media retained until user deletes message
}

# WhatsApp service: Full object access for upload/download/delete
resource "google_storage_bucket_iam_member" "whatsapp_service_admin" {
  bucket = google_storage_bucket.whatsapp_media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.whatsapp_service_account}"
}

# SRT service: Read-only access to objects (to generate signed URLs for Speechmatics)
resource "google_storage_bucket_iam_member" "srt_service_viewer" {
  bucket = google_storage_bucket.whatsapp_media.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${var.srt_service_account}"
}

# SRT service: Service Account Token Creator (for signing GCS URLs)
# This allows srt-service to sign URLs for its own service account
resource "google_service_account_iam_member" "srt_service_token_creator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.srt_service_account}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.srt_service_account}"
}

