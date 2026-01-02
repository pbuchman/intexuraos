variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "project_number" {
  description = "GCP project number (for Pub/Sub service account IAM)"
  type        = string
}

variable "topic_name" {
  description = "Name for the Pub/Sub topic"
  type        = string
}

variable "push_endpoint" {
  description = "HTTPS endpoint to push messages to"
  type        = string
}

variable "push_service_account_email" {
  description = "Service account email for OIDC authentication"
  type        = string
}

variable "push_audience" {
  description = "Audience for OIDC token (usually the Cloud Run service URL)"
  type        = string
  default     = ""
}

variable "publisher_service_accounts" {
  description = "Map of service account names to emails that can publish to this topic"
  type        = map(string)
  default     = {}
}

variable "ack_deadline_seconds" {
  description = "Acknowledgement deadline in seconds (GCP allows 10-600)"
  type        = number
  default     = 60

  validation {
    condition     = var.ack_deadline_seconds >= 10 && var.ack_deadline_seconds <= 600
    error_message = "ack_deadline_seconds must be between 10 and 600 seconds (GCP Pub/Sub limit)."
  }
}

variable "message_retention_duration" {
  description = "How long to retain unacknowledged messages"
  type        = string
  default     = "604800s"
}

variable "retry_minimum_backoff" {
  description = "Minimum backoff for retries"
  type        = string
  default     = "10s"
}

variable "retry_maximum_backoff" {
  description = "Maximum backoff for retries"
  type        = string
  default     = "600s"
}

variable "max_delivery_attempts" {
  description = "Max delivery attempts before sending to DLQ"
  type        = number
  default     = 5
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}
