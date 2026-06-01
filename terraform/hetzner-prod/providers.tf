provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
}

# The Hetzner provider reads HCLOUD_TOKEN from the environment.
provider "hcloud" {}
