variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "services" {
  description = "Map of service configurations"
  type = map(object({
    name      = string
    app_path  = string
    port      = number
    min_scale = number
    max_scale = number
  }))
}

variable "legacy_secret_manager_enabled" {
  description = "Keep legacy per-service Secret Manager bindings during package migration"
  type        = bool
  default     = true
}

variable "secret_ids" {
  description = "Legacy individual secret IDs retained only during package migration"
  type        = map(string)
  default     = {}
}
