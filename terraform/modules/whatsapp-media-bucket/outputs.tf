output "bucket_name" {
  description = "Name of the WhatsApp media bucket"
  value       = google_storage_bucket.whatsapp_media.name
}

output "bucket_url" {
  description = "GCS URL of the bucket (gs://...)"
  value       = "gs://${google_storage_bucket.whatsapp_media.name}"
}

