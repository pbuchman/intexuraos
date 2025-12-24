terraform {
  backend "gcs" {
    # Bucket name is set via -backend-config or terraform init
    # bucket = "intexuraos-terraform-state-dev"
    prefix = "terraform/state"
  }
}

