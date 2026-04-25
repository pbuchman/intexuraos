terraform {
  backend "gcs" {
    bucket = "intexuraos-prod-pbuchman-terraform-state"
    prefix = "terraform/state"
  }
}
