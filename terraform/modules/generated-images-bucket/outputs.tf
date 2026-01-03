output "bucket_name" {
  description = "Name of the generated images bucket"
  value       = google_storage_bucket.generated_images.name
}

output "bucket_url" {
  description = "URL of the generated images bucket"
  value       = google_storage_bucket.generated_images.url
}
