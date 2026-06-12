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

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

variable "cleanup_policy_dry_run" {
  description = "If true, Artifact Registry cleanup policies log but do not delete."
  type        = bool
  default     = false
}

variable "cleanup_keep_count" {
  description = "How many recent versions to keep per package."
  type        = number
  default     = 3
}

variable "cleanup_delete_older_than" {
  description = "Age threshold for deleting stale images as a protobuf Duration string."
  type        = string
  default     = "86400s"
}

variable "code_worker_cleanup_delete_older_than" {
  description = "Age threshold for deleting stale code-worker images as a protobuf Duration string."
  type        = string
  default     = "86400s"
}
