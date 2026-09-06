variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "github_owner" {
  description = "GitHub repository owner (organization or user)"
  type        = string

  validation {
    condition     = var.github_owner == "pbuchman"
    error_message = "github_owner must remain pinned to pbuchman."
  }
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string

  validation {
    condition     = var.github_repo == "intexuraos"
    error_message = "github_repo must remain pinned to intexuraos."
  }
}

variable "github_repository_owner_id" {
  description = "Immutable numeric GitHub repository owner ID"
  type        = string

  validation {
    condition     = var.github_repository_owner_id == "368465"
    error_message = "github_repository_owner_id must remain pinned to 368465."
  }
}

variable "github_repository_id" {
  description = "Immutable numeric GitHub repository ID"
  type        = string

  validation {
    condition     = var.github_repository_id == "1118959310"
    error_message = "github_repository_id must remain pinned to 1118959310."
  }
}

variable "github_ref" {
  description = "Exact Git ref allowed to exchange GitHub OIDC tokens"
  type        = string

  validation {
    condition     = var.github_ref == "refs/heads/development"
    error_message = "github_ref must remain pinned to refs/heads/development."
  }
}

variable "cloud_build_service_account_name" {
  description = "Full resource name of the Cloud Build service account to allow impersonation"
  type        = string
}
