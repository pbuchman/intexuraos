# 02 - Terraform Bootstrap

This document describes how to initialize and apply Terraform configuration for PraxOS.

## Prerequisites

- GCP project created (see [01-gcp-project.md](./01-gcp-project.md))
- Terraform CLI installed (version >= 1.5.0)
- `gcloud` authenticated with project owner/editor permissions

## 1. Configure Terraform Variables

```bash
cd terraform/environments/dev

# Copy example tfvars
cp terraform.tfvars.example terraform.tfvars

# Edit with your values
vim terraform.tfvars
```

Required variables in `terraform.tfvars`:

```hcl
# Your GCP project ID
project_id = "praxos-dev-yourname"

# GCP region
region = "europe-central2"

# Environment name
environment = "dev"

# Your GitHub username or organization
github_owner = "your-github-username"

# Repository name
github_repo = "praxos"

# Branch that triggers builds
github_branch = "development"
```

## 2. Initialize Terraform

```bash
# Set your project ID
export PROJECT_ID="praxos-dev-yourname"

# Initialize with backend configuration
terraform init \
  -backend-config="bucket=${PROJECT_ID}-terraform-state"
```

Expected output:

```
Initializing modules...
Initializing the backend...
Initializing provider plugins...
Terraform has been successfully initialized!
```

## 3. Review the Plan

```bash
terraform plan
```

Review the plan carefully. It should create:

- Artifact Registry repository
- Firestore database
- Secret Manager secrets (3 secrets)
- Service accounts (3 accounts)
- IAM bindings
- Cloud Run services (2 services)
- Cloud Build trigger

## 4. Apply Configuration

```bash
terraform apply
```

Type `yes` when prompted.

This will take several minutes. The longest steps are usually:

- Firestore database creation
- Cloud Run service initial deployment

## 5. Populate Secrets

Terraform creates empty secrets. You must populate them manually:

```bash
# Set your Auth0 configuration
export AUTH0_DOMAIN="your-tenant.auth0.com"
export AUTH0_AUDIENCE="https://api.praxos.app"

# Add secret versions
echo -n "https://${AUTH0_DOMAIN}/.well-known/jwks.json" | \
  gcloud secrets versions add PRAXOS_AUTH_JWKS_URL --data-file=-

echo -n "https://${AUTH0_DOMAIN}/" | \
  gcloud secrets versions add PRAXOS_AUTH_ISSUER --data-file=-

echo -n "${AUTH0_AUDIENCE}" | \
  gcloud secrets versions add PRAXOS_AUTH_AUDIENCE --data-file=-
```

> **Note**: Per-user Notion integration tokens are stored in Firestore, not Secret Manager.
> There is no app-level Notion API key in this architecture.

## 6. Verify Outputs

```bash
terraform output
```

Expected outputs:

```
artifact_registry_url = "europe-central2-docker.pkg.dev/praxos-dev-yourname/praxos-dev"
auth_service_url = "https://praxos-auth-service-xxxxx-ew.a.run.app"
notion_gpt_service_url = "https://praxos-notion-gpt-service-xxxxx-ew.a.run.app"
firestore_database = "(default)"
service_accounts = {
  auth_service = "praxos-auth-svc-dev@praxos-dev-yourname.iam.gserviceaccount.com"
  notion_gpt_service = "praxos-notion-svc-dev@praxos-dev-yourname.iam.gserviceaccount.com"
}
```

## 7. Initial Image Push (Required)

Cloud Run services require an initial image. Push a placeholder:

```bash
# Build and push auth-service
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/praxos-dev/auth-service:latest \
  -f apps/auth-service/Dockerfile .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/praxos-dev/auth-service:latest

# Build and push notion-gpt-service
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/praxos-dev/notion-gpt-service:latest \
  -f apps/notion-gpt-service/Dockerfile .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/praxos-dev/notion-gpt-service:latest
```

Or wait for the first Cloud Build trigger to push images.

## Troubleshooting

### "Error creating Firestore database"

Firestore can only be created once per project. If you get this error, the database may already exist.

### "Secret version not found"

Secrets are created empty. Populate them with the commands in Step 5.

### "Permission denied"

Ensure you have Owner or Editor role on the project.

## Summary

After completing these steps, you should have:

- [x] Terraform initialized with GCS backend
- [x] All infrastructure resources created
- [x] Secrets populated with Auth0 configuration
- [x] Initial images pushed (or pending first build)

## Next Step

→ [03-cloud-build-trigger.md](./03-cloud-build-trigger.md)
