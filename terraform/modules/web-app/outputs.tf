output "bucket_name" {
  description = "Name of the web app bucket"
  value       = google_storage_bucket.web_app.name
}

output "bucket_url" {
  description = "URL of the web app bucket"
  value       = google_storage_bucket.web_app.url
}

output "public_url" {
  description = "Public URL for the web app (direct GCS access)"
  value       = "https://storage.googleapis.com/${google_storage_bucket.web_app.name}/index.html"
}

output "load_balancer_ip" {
  description = "Load balancer IP address (configure DNS to point to this)"
  value       = var.enable_load_balancer ? google_compute_global_address.web_app[0].address : null
}

output "website_url" {
  description = "Website URL (via load balancer if enabled, otherwise direct GCS)"
  value       = var.enable_load_balancer && var.domain != "" ? "https://${var.domain}" : "https://storage.googleapis.com/${google_storage_bucket.web_app.name}/index.html"
}

