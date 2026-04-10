terraform {
  backend "gcs" {
    bucket = "intexuraos-dev-pbuchman-terraform-state" # Same bucket as dev
    prefix = "terraform/state/prod"                    # Distinct prefix = isolated state
  }
}
