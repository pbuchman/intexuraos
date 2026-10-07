terraform {
  backend "gcs" {
    bucket = "intexuraos-dev-pbuchman-terraform-state"
    prefix = "terraform/state"
  }
}

