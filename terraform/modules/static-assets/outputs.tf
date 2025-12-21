output "bucket_name" {
  description = "Name of the static assets bucket"
  value       = google_storage_bucket.static_assets.name
}

output "public_base_url" {
  description = "Public base URL for static assets (https://storage.googleapis.com/bucket-name)"
  value       = "https://storage.googleapis.com/${google_storage_bucket.static_assets.name}"
}

