variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "topic_name" {
  description = "Name for the Pub/Sub topic"
  type        = string
}

variable "publisher_service_accounts" {
  description = "List of service account emails that can publish to this topic"
  type        = list(string)
  default     = []
}

variable "subscriber_service_accounts" {
  description = "List of service account emails that can subscribe to this topic"
  type        = list(string)
  default     = []
}

variable "ack_deadline_seconds" {
  description = "Acknowledgement deadline in seconds"
  type        = number
  default     = 60
}

variable "message_retention_duration" {
  description = "How long to retain unacknowledged messages"
  type        = string
  default     = "604800s" # 7 days
}

variable "retry_minimum_backoff" {
  description = "Minimum backoff for retries"
  type        = string
  default     = "10s"
}

variable "retry_maximum_backoff" {
  description = "Maximum backoff for retries"
  type        = string
  default     = "600s" # 10 minutes
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

