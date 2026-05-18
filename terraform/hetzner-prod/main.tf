data "google_project" "retained" {
  project_id = var.project_id
}

locals {
  common_labels = merge({
    environment = var.environment
    managed_by  = "terraform"
    project     = "intexuraos"
    component   = "hetzner-prod"
  }, var.extra_labels)

  retained_gcp = {
    project_id                         = data.google_project.retained.project_id
    project_number                     = data.google_project.retained.number
    firestore_database_id              = "(default)"
    cloudflare_dns_api_token_secret_id = var.cloudflare_dns_api_token_secret_id
  }
}
