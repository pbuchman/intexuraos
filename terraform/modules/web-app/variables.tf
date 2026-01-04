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

variable "bucket_name" {
  description = "Base name for the storage bucket"
  type        = string
  default     = "intexuraos-web"
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

variable "enable_load_balancer" {
  description = "Enable Cloud Load Balancer with CDN for SPA hosting"
  type        = bool
  default     = false
}

variable "domain" {
  description = "Domain name for the web app (e.g., app.intexuraos.com)"
  type        = string
  default     = ""
}

variable "use_custom_certificate" {
  description = "Use custom SSL certificate instead of Google-managed"
  type        = bool
  default     = false
}

variable "ssl_certificate_path" {
  description = "Path to SSL certificate file (fullchain.pem) - required if use_custom_certificate is true"
  type        = string
  default     = ""
}

variable "ssl_private_key_secret_id" {
  description = "Secret Manager secret ID containing SSL private key - required if use_custom_certificate is true"
  type        = string
  default     = ""
}

variable "shared_content_bucket_name" {
  description = "Name of the shared content bucket for /share/* path routing"
  type        = string
  default     = ""
}

variable "images_bucket_name" {
  description = "Name of the generated images bucket for /assets/* path routing"
  type        = string
  default     = ""
}

