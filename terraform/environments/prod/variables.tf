variable "project_id" {
  description = "GCP project ID (MUST match dev environment — shared Firestore)"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-central2"
}

variable "environment" {
  description = "Environment name (literal string 'prod')"
  type        = string
  default     = "prod"
  validation {
    condition     = var.environment == "prod"
    error_message = "This root module is hardcoded for prod."
  }
}

variable "hetzner_location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "nbg1" # Nuremberg — closest to europe-central2
}

variable "hetzner_server_type" {
  description = "Hetzner server type"
  type        = string
  default     = "cx33" # 4 vCPU Intel, 8GB RAM, 80GB NVMe, ~EUR 6.49/month (nbg1)
}

variable "deploy_ssh_public_key" {
  description = "Public SSH key for the deploy user on Hetzner VM"
  type        = string
  validation {
    condition     = length(trimspace(var.deploy_ssh_public_key)) > 0
    error_message = "deploy_ssh_public_key must not be empty — the VM would be inaccessible without an SSH key."
  }
}

variable "admin_ssh_source_ips" {
  description = "CIDR blocks allowed to SSH into the Hetzner VM (port 22). Default: restricted to nothing — operator MUST supply their IPs."
  type        = list(string)
  validation {
    condition     = length(var.admin_ssh_source_ips) > 0
    error_message = "admin_ssh_source_ips must contain at least one CIDR — the VM would be inaccessible without SSH."
  }
}

variable "domain" {
  description = "Public domain for prod"
  type        = string
  default     = "intexuraos.cloud"
}
