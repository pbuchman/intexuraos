terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
}

# hcloud provider reads HCLOUD_TOKEN from the environment
provider "hcloud" {}
