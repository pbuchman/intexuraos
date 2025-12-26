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

variable "whatsapp_service_account" {
  description = "WhatsApp service account email for bucket access"
  type        = string
}

variable "srt_service_account" {
  description = "SRT service account email for read-only bucket access (to generate signed URLs)"
  type        = string
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

