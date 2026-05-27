variable "project_id" {
  description = "Retained shared GCP project ID for data-plane and async/control-plane resources."
  type        = string
  default     = "intexuraos-dev-pbuchman"

  validation {
    condition     = var.project_id == "intexuraos-dev-pbuchman"
    error_message = "Hetzner prod must reference the retained shared GCP project intexuraos-dev-pbuchman."
  }
}

variable "region" {
  description = "GCP region for retained resource references."
  type        = string
  default     = "europe-central2"
}

variable "environment" {
  description = "Environment label for Hetzner production migration resources."
  type        = string
  default     = "prod-hetzner"

  validation {
    condition     = var.environment == "prod-hetzner"
    error_message = "This root is only for the prod-hetzner environment."
  }
}

variable "source_environment" {
  description = "Existing Terraform environment suffix for retained GCP topics, service accounts, and jobs."
  type        = string
  default     = "dev"

  validation {
    condition     = var.source_environment == "dev"
    error_message = "This cutover currently targets retained resources owned by terraform/environments/dev."
  }
}

variable "domain" {
  description = "Public production domain served by the Hetzner VM."
  type        = string
  default     = "intexuraos.cloud"
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

variable "hetzner_location" {
  description = "Hetzner location for the prod VM and primary IPv4."
  type        = string
  default     = "nbg1"

  validation {
    condition     = length(trimspace(var.hetzner_location)) > 0
    error_message = "hetzner_location must be a non-empty Hetzner location such as nbg1."
  }
}

variable "hetzner_server_type" {
  description = "Hetzner Cloud server type for the production VM."
  type        = string
  default     = "cx32"

  validation {
    condition     = length(trimspace(var.hetzner_server_type)) > 0
    error_message = "hetzner_server_type must be non-empty."
  }
}

variable "hetzner_image" {
  description = "Hetzner image for the production VM."
  type        = string
  default     = "ubuntu-24.04"
}

variable "deploy_ssh_public_key" {
  description = "Public SSH key installed on the Hetzner VM for deployment and operations."
  type        = string
  sensitive   = true

  validation {
    condition = (
      startswith(trimspace(var.deploy_ssh_public_key), "ssh-ed25519 ") ||
      startswith(trimspace(var.deploy_ssh_public_key), "ssh-rsa ")
    )
    error_message = "deploy_ssh_public_key must be an OpenSSH public key."
  }
}

variable "admin_ssh_source_ips" {
  description = "CIDR ranges allowed to SSH to the Hetzner VM. Broad internet ranges are forbidden."
  type        = list(string)

  validation {
    condition = (
      length(var.admin_ssh_source_ips) > 0 &&
      alltrue([for source in var.admin_ssh_source_ips : can(cidrhost(source, 0))]) &&
      !contains(var.admin_ssh_source_ips, "0.0.0.0/0") &&
      !contains(var.admin_ssh_source_ips, "::/0")
    )
    error_message = "admin_ssh_source_ips must contain valid CIDR ranges and must not include 0.0.0.0/0 or ::/0."
  }
}

variable "web_source_ips" {
  description = "CIDR ranges allowed to reach HTTP and HTTPS on the Hetzner VM."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]

  validation {
    condition     = alltrue([for source in var.web_source_ips : can(cidrhost(source, 0))])
    error_message = "web_source_ips must contain valid CIDR ranges."
  }
}

variable "cloudflare_dns_api_token_secret_id" {
  description = "Retained GCP Secret Manager secret ID for the Cloudflare DNS API token used by certbot DNS-01."
  type        = string
  default     = "INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN"
}

variable "labels" {
  description = "Additional labels applied to Hetzner and retained async/control-plane resources."
  type        = map(string)
  default     = {}
}
