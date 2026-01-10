variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for the bucket"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

variable "image_service_service_account" {
  description = "Service account email for image-service (for upload access)"
  type        = string
  default     = ""
}

variable "enable_image_service_access" {
  description = "Whether to grant image-service storage access (separate from service account to avoid count issues)"
  type        = bool
  default     = false
}
