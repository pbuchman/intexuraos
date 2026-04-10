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
  default     = "cx32" # 4 vCPU, 8GB RAM, 80GB NVMe
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
  description = "Source IPs allowed to SSH (port 22) to the VM"
  type        = list(string)
  validation {
    condition     = alltrue([for ip in var.admin_ssh_source_ips : !contains(["0.0.0.0/0", "::/0"], ip)])
    error_message = "admin_ssh_source_ips must not include 0.0.0.0/0 or ::/0 — SSH must be IP-restricted."
  }
}

variable "domain" {
  description = "Public domain for prod"
  type        = string
  default     = "intexuraos.cloud"
}
