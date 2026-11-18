variable "project_id" {
  description = "GCP project for the standalone share origin and its buckets."
  type        = string
  default     = "intexuraos-dev-pbuchman"
}

variable "region" {
  description = "GCP region for the share origin and its buckets."
  type        = string
  default     = "europe-central2"
}
