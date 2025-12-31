variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "github_owner" {
  description = "GitHub repository owner (organization or user)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "cloud_build_service_account_name" {
  description = "Full resource name of the Cloud Build service account to allow impersonation"
  type        = string
}
