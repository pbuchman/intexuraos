variable "project_id" {
  description = "Shared GCP project that owns retained prod async/control-plane resources."
  type        = string
  default     = "intexuraos-dev-pbuchman"
}

variable "region" {
  description = "GCP region for retained scheduler and function resources."
  type        = string
  default     = "europe-central2"
}

variable "source_environment" {
  description = "Existing Terraform environment suffix for retained GCP topics, service accounts, and jobs."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,30}[a-z0-9]$", var.source_environment))
    error_message = "source_environment must be a lowercase environment suffix such as dev, staging, or prod."
  }
}

variable "hetzner_origin" {
  description = "Public Hetzner production origin used as push endpoint prefix."
  type        = string
  default     = "https://intexuraos.cloud"

  validation {
    condition     = can(regex("^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.hetzner_origin))
    error_message = "hetzner_origin must be an HTTPS origin without a port, path, query string, or trailing slash."
  }

  validation {
    condition     = var.hetzner_origin == "https://intexuraos.cloud"
    error_message = "hetzner_origin is fixed to https://intexuraos.cloud for this production Hetzner cutover root."
  }
}

variable "activate_hetzner_async_consumers" {
  description = "When true, activates Hetzner-targeted Pub/Sub pushes and Scheduler jobs. Keep false for staging to avoid duplicate Cloud Run and Hetzner consumers."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Additional labels applied to retained async/control-plane resources."
  type        = map(string)
  default     = {}
}
