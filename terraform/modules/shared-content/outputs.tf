output "bucket_name" {
  description = "Name of the shared content bucket"
  value       = google_storage_bucket.shared_content.name
}

output "bucket_url" {
  description = "URL of the shared content bucket"
  value       = google_storage_bucket.shared_content.url
}
