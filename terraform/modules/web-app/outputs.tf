output "bucket_name" {
  description = "Name of the web app bucket"
  value       = google_storage_bucket.web_app.name
}

output "bucket_url" {
  description = "URL of the web app bucket"
  value       = google_storage_bucket.web_app.url
}

output "public_url" {
  description = "Public URL for the web app"
  value       = "https://storage.googleapis.com/${google_storage_bucket.web_app.name}"
}

output "website_url" {
  description = "Website URL (custom domain format)"
  value       = "https://${google_storage_bucket.web_app.name}.storage.googleapis.com"
}

