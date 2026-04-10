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
}

variable "admin_ssh_source_ips" {
  description = "Source IPs allowed to SSH (port 22) to the VM"
  type        = list(string)
}

variable "domain" {
  description = "Public domain for prod"
  type        = string
  default     = "intexuraos.cloud"
}
