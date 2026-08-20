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
  default     = "prod"

  validation {
    condition     = var.environment == "prod"
    error_message = "This root is only for the prod environment."
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

variable "legacy_secret_manager_enabled" {
  description = "Keep legacy individual secret inventory during package cutover and rollback soak; disable only after verified rollback and at least 72 healthy hours"
  type        = bool
  default     = true
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

variable "enable_retired_async_consumer_cleanup" {
  description = "When true, runs the one-time guarded cleanup for stale prod-hetzner Scheduler jobs and Pub/Sub push subscriptions that no longer appear in the active Hetzner async maps."
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
  default     = "cx33"

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

variable "deploy_ssh_private_key_path" {
  description = "Local private SSH key path used by Terraform to bootstrap a freshly created Hetzner VM."
  type        = string
  default     = "~/.ssh/intexuraos_hetzner_deploy"

  validation {
    condition     = length(trimspace(var.deploy_ssh_private_key_path)) > 0
    error_message = "deploy_ssh_private_key_path must be non-empty."
  }
}

variable "provisioner_sa_key_path" {
  description = "Local path to the Hetzner provisioner service account key copied to the VM during Terraform bootstrap."
  type        = string
  default     = "~/.config/intexuraos/hetzner/provisioner-sa-key.json"

  validation {
    condition     = length(trimspace(var.provisioner_sa_key_path)) > 0
    error_message = "provisioner_sa_key_path must be non-empty."
  }
}

variable "runtime_sa_key_path" {
  description = "Local path to the Hetzner runtime service account key copied to the VM during Terraform bootstrap."
  type        = string
  default     = "~/.config/intexuraos/hetzner/runtime-sa-key.json"

  validation {
    condition     = length(trimspace(var.runtime_sa_key_path)) > 0
    error_message = "runtime_sa_key_path must be non-empty."
  }
}

variable "legacy_runtime_sa_bootstrap_enabled" {
  description = "Copy the legacy runtime service-account key during additive package migration. Disable only after the package renderer owns the verified credential file and at least 72 healthy hours."
  type        = bool
  default     = true
}

variable "prod_secret_package_version" {
  description = "Exact positive numeric PROD secret-package version used during a full VM bootstrap. Keep aligned with the protected GitHub Actions PROD_SECRET_PACKAGE_VERSION variable."
  type        = number
  default     = 1

  validation {
    condition = (
      var.prod_secret_package_version >= 1 &&
      floor(var.prod_secret_package_version) == var.prod_secret_package_version
    )
    error_message = "prod_secret_package_version must be a positive integer."
  }
}

variable "hetzner_bootstrap_enabled" {
  description = "When true, Terraform bootstraps a new Hetzner VM by syncing this repo, installing secrets, provisioning nginx/PM2, and loading runtime services."
  type        = bool
  default     = true
}

variable "admin_ssh_source_ips" {
  description = "CIDR ranges allowed to SSH to the Hetzner VM. Production currently allows broad SSH CIDRs and relies on hardened key-only sshd."
  type        = list(string)

  validation {
    condition = (
      length(var.admin_ssh_source_ips) > 0 &&
      alltrue([for source in var.admin_ssh_source_ips : can(cidrhost(source, 0))])
    )
    error_message = "admin_ssh_source_ips must contain valid CIDR ranges."
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
