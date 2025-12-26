variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
}

variable "service_account" {
  description = "Service account email"
  type        = string
}

variable "image" {
  description = "Container image URL"
  type        = string
}

variable "port" {
  description = "Container port"
  type        = number
  default     = 8080
}

variable "min_scale" {
  description = "Minimum number of instances"
  type        = number
  default     = 0
}

variable "max_scale" {
  description = "Maximum number of instances"
  type        = number
  default     = 10
}

variable "cpu" {
  description = "CPU limit"
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit"
  type        = string
  default     = "512Mi"
}

variable "secrets" {
  description = "Map of environment variable name to Secret Manager secret ID"
  type        = map(string)
  default     = {}
}

variable "env_vars" {
  description = "Map of plain environment variables"
  type        = map(string)
  default     = {}
}

variable "allow_unauthenticated" {
  description = <<-EOT
    Allow unauthenticated access (public) to the service.

    Default: true - External callers (e.g., Meta webhooks) don't send IAM auth headers.
    Services implement their own auth (JWT, webhook signatures).

    Set to false only for internal-only services that require IAM authentication.
  EOT
  type        = bool
  default     = true
}

variable "invoker_service_accounts" {
  description = <<-EOT
    List of service account emails allowed to invoke this service.
    Used for internal service-to-service communication with Google-signed ID tokens.
    Only effective when allow_unauthenticated = false.
  EOT
  type        = list(string)
  default     = []
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

