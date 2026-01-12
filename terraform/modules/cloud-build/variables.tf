variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for runtime resources (Cloud Run, etc.)"
  type        = string
}

variable "build_region" {
  description = "GCP region for Cloud Build workers (triggers, connection). Can differ from region for cost optimization."
  type        = string
  default     = null
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "github_owner" {
  description = "GitHub repository owner"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "github_branch" {
  description = "GitHub branch to trigger builds"
  type        = string
}

variable "github_connection_name" {
  description = "Name of the Cloud Build GitHub connection (created manually via GCP Console)"
  type        = string
}

variable "artifact_registry_url" {
  description = "Artifact Registry URL"
  type        = string
}

variable "static_assets_bucket" {
  description = "Name of the GCS bucket for static assets"
  type        = string
}

variable "web_app_bucket" {
  description = "Name of the GCS bucket for the web app"
  type        = string
}

