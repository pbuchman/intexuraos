variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "zone" {
  description = "GCP zone for VM"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "functions_source_bucket" {
  description = "GCS bucket for Cloud Functions source"
  type        = string
}

variable "internal_auth_token_secret_id" {
  description = "Secret Manager ID for internal auth token"
  type        = string
}

variable "github_webhook_secret_id" {
  description = "Secret Manager ID for GitHub webhook secret"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository (owner/repo)"
  type        = string
  default     = "pbuchman/intexuraos"
}
