variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "alert_email" {
  description = "Email address for alert notifications. Set to null to disable alerts."
  type        = string
  default     = null
}

variable "slack_auth_token" {
  description = "Slack bot OAuth token (xoxb-...) for the monitoring notification channel. Set to null to skip provisioning the Slack channel."
  type        = string
  default     = null
  sensitive   = true
}

variable "slack_channel_name" {
  description = "Slack channel where monitoring notifications are posted (e.g. \"#alerts\")."
  type        = string
  default     = "#alerts"
}
