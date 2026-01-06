# 1-5 Terraform & Deployment Config

Configure infrastructure and CI/CD for the service.

## Tasks

- [ ] Add service account to IAM module
- [ ] Create Cloud Run module in `terraform/environments/dev/main.tf`
- [ ] Add CloudBuild trigger in `cloudbuild/cloudbuild.yaml`
- [ ] Create `cloudbuild/scripts/deploy-notes-service.sh`
- [ ] Add to `scripts/dev.mjs` (pick next port, e.g., 8113)
- [ ] Add to `.envrc.local.example`
- [ ] Run `terraform fmt -recursive && terraform validate`

## Terraform Module

```hcl
module "notes_service" {
  source = "../../modules/cloud-run-service"

  project_id    = var.project_id
  region        = var.region
  service_name  = "intexuraos-notes-service"
  image         = "${var.region}-docker.pkg.dev/${var.project_id}/intexuraos/intexuraos-notes-service:latest"

  service_account_email = module.iam.service_accounts["notes-service"]

  env_vars = {
    NODE_ENV = "production"
  }

  secrets = {
    INTEXURAOS_AUTH_JWKS_URL     = "INTEXURAOS_AUTH_JWKS_URL"
    INTEXURAOS_AUTH_ISSUER       = "INTEXURAOS_AUTH_ISSUER"
    INTEXURAOS_AUTH_AUDIENCE     = "INTEXURAOS_AUTH_AUDIENCE"
    INTEXURAOS_INTERNAL_AUTH_KEY = "INTEXURAOS_INTERNAL_AUTH_KEY"
  }
}
```

## Required Env Vars

```typescript
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_KEY',
];
```
