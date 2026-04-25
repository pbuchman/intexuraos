variable "project_id" {
  description = "GCP project ID for the prod environment"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-central2"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "alert_email" {
  description = "REQUIRED: email address for monitoring alerts (Slack and email channels are both provisioned)."
  type        = string
  # No default — REQUIRED in prod per INT-1538-S8.
  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be a valid email address."
  }
}

variable "slack_auth_token" {
  description = "Slack auth token (xoxb-...) for the monitoring notification channel."
  type        = string
  sensitive   = true
}

variable "slack_channel_name" {
  description = "Slack channel (e.g. #alerts) where monitoring notifications are posted."
  type        = string
  default     = "#alerts"
}
