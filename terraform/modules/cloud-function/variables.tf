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

variable "function_name" {
  description = "Cloud Function name"
  type        = string
}

variable "description" {
  description = "Cloud Function description"
  type        = string
  default     = ""
}

variable "runtime" {
  description = "Runtime for the function"
  type        = string
  default     = "nodejs22"
}

variable "entry_point" {
  description = "Entry point function name"
  type        = string
}

variable "source_bucket" {
  description = "GCS bucket containing the function source"
  type        = string
}

variable "source_object" {
  description = "GCS object path to the function source zip"
  type        = string
}

variable "service_account" {
  description = "Service account email"
  type        = string
}

variable "timeout_seconds" {
  description = "Function timeout in seconds (max 540 for gen2)"
  type        = number
  default     = 60
}

variable "available_memory" {
  description = "Memory available to the function"
  type        = string
  default     = "256M"
}

variable "max_instance_count" {
  description = "Maximum number of instances"
  type        = number
  default     = 1
}

variable "min_instance_count" {
  description = "Minimum number of instances"
  type        = number
  default     = 0
}

variable "trigger_type" {
  description = "Trigger type: 'http' or 'pubsub'"
  type        = string
  default     = "http"

  validation {
    condition     = contains(["http", "pubsub"], var.trigger_type)
    error_message = "trigger_type must be 'http' or 'pubsub'"
  }
}

variable "pubsub_topic" {
  description = "Pub/Sub topic for pubsub trigger (required when trigger_type = 'pubsub')"
  type        = string
  default     = ""
}

variable "env_vars" {
  description = "Environment variables for the function"
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secret Manager secrets to expose as environment variables (key = env var name, value = secret ID)"
  type        = map(string)
  default     = {}
}

variable "invoker_members" {
  description = "IAM members allowed to invoke the function (e.g., 'allUsers', 'serviceAccount:xxx')"
  type        = list(string)
  default     = []
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}
