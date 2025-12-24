# 02 - Terraform Bootstrap

This document describes how to initialize and apply Terraform configuration for IntexuraOS.

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
project_id = "intexuraos-dev-yourname"

# GCP region
region = "europe-central2"

# Environment name
environment = "dev"

# Your GitHub username or organization
github_owner = "your-github-username"

# Repository name
github_repo = "intexuraos"

# Branch that triggers builds
github_branch = "development"
```

## 2. Initialize Terraform

```bash
# Set your project ID
export PROJECT_ID="intexuraos-dev-yourname"

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
- Secret Manager secrets (10 secrets: 5 Auth0, 5 WhatsApp)
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

Terraform creates empty secrets. You must populate them with actual values.

### Option A: Interactive Script (Recommended)

Use the interactive script to populate all secrets:

```bash
# From repository root
./scripts/populate-secrets.sh

# Or specify environment
./scripts/populate-secrets.sh dev
```

The script will:

1. Extract all secret names from Terraform configuration
2. Prompt for each secret value (sensitive values are hidden)
3. Skip secrets that already have values (with option to overwrite)
4. Output a complete list of populated secrets at the end

> **Important**: Save the final output - secret values won't be shown again!

### Option B: Manual Population

#### Auth0 Secrets

```bash
# Set your Auth0 configuration
export AUTH0_DOMAIN="your-tenant.auth0.com"
export AUTH0_CLIENT_ID="your-native-app-client-id"
export AUTH0_AUDIENCE="urn:intexuraos:api"

# Add secret versions (Terraform created the secrets, we add values)

# Auth0 domain - required for auth-service DAF endpoints
echo -n "${AUTH0_DOMAIN}" | \
  gcloud secrets versions add INTEXURAOS_AUTH0_DOMAIN --data-file=-

# Auth0 client ID - required for auth-service DAF endpoints
echo -n "${AUTH0_CLIENT_ID}" | \
  gcloud secrets versions add INTEXURAOS_AUTH0_CLIENT_ID --data-file=-

# Auth JWKS URL - required for JWT verification
echo -n "https://${AUTH0_DOMAIN}/.well-known/jwks.json" | \
  gcloud secrets versions add INTEXURAOS_AUTH_JWKS_URL --data-file=-

# Auth issuer - required for JWT verification
echo -n "https://${AUTH0_DOMAIN}/" | \
  gcloud secrets versions add INTEXURAOS_AUTH_ISSUER --data-file=-

# Auth audience - required for JWT verification
echo -n "${AUTH0_AUDIENCE}" | \
  gcloud secrets versions add INTEXURAOS_AUTH_AUDIENCE --data-file=-
```

> See [06-auth0.md](./06-auth0.md) for detailed Auth0 setup instructions.

### WhatsApp Business Cloud API Secrets

```bash
# Set your WhatsApp configuration (obtain from Meta Business Suite)
export WHATSAPP_VERIFY_TOKEN="your-webhook-verify-token"
export WHATSAPP_ACCESS_TOKEN="your-system-user-access-token"
export WHATSAPP_PHONE_NUMBER_ID="123456789012345"
export WHATSAPP_WABA_ID="1234567890123456"
export WHATSAPP_APP_SECRET="your-app-secret"

# WhatsApp webhook verify token
echo -n "${WHATSAPP_VERIFY_TOKEN}" | \
  gcloud secrets versions add INTEXURAOS_WHATSAPP_VERIFY_TOKEN --data-file=-

# WhatsApp access token (permanent System User token)
echo -n "${WHATSAPP_ACCESS_TOKEN}" | \
  gcloud secrets versions add INTEXURAOS_WHATSAPP_ACCESS_TOKEN --data-file=-

# WhatsApp phone number ID
echo -n "${WHATSAPP_PHONE_NUMBER_ID}" | \
  gcloud secrets versions add INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID --data-file=-

# WhatsApp Business Account ID
echo -n "${WHATSAPP_WABA_ID}" | \
  gcloud secrets versions add INTEXURAOS_WHATSAPP_WABA_ID --data-file=-

# WhatsApp app secret (for webhook signature validation)
echo -n "${WHATSAPP_APP_SECRET}" | \
  gcloud secrets versions add INTEXURAOS_WHATSAPP_APP_SECRET --data-file=-
```

> See [07-whatsapp-business-cloud-api.md](./07-whatsapp-business-cloud-api.md) for detailed WhatsApp setup instructions.

> **Note**: Per-user Notion integration tokens are stored in Firestore, not Secret Manager.
> There is no app-level Notion API key in this architecture.

## 6. Verify Outputs

```bash
terraform output
```

Expected outputs:

```
artifact_registry_url = "europe-central2-docker.pkg.dev/intexuraos-dev-yourname/intexuraos-dev"
auth_service_url = "https://intexuraos-auth-service-xxxxx-ew.a.run.app"
promptvault_service_url = "https://intexuraos-promptvault-service-xxxxx-ew.a.run.app"
firestore_database = "(default)"
service_accounts = {
  auth_service = "intexuraos-auth-svc-dev@intexuraos-dev-yourname.iam.gserviceaccount.com"
  promptvault_service = "intexuraos-pv-svc-dev@intexuraos-dev-yourname.iam.gserviceaccount.com"
  notion_service = "intexuraos-notion-svc-dev@intexuraos-dev-yourname.iam.gserviceaccount.com"
}
```

## 7. Initial Image Push (Required)

Cloud Run services require an initial image. Build and push from repository root:

```bash
# Set variables
export REGION="europe-central2"
export PROJECT_ID="intexuraos-dev-yourname"

# Build and push auth-service (--platform for Cloud Run compatibility on Apple Silicon)
docker build --platform linux/amd64 -f apps/auth-service/Dockerfile \
  -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/auth-service:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/auth-service:latest

# Build and push promptvault-service
docker build --platform linux/amd64 -f apps/promptvault-service/Dockerfile \
  -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/promptvault-service:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/promptvault-service:latest

# Build and push notion-service
docker build --platform linux/amd64 -f apps/notion-service/Dockerfile \
  -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/notion-service:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/notion-service:latest

# Build and push whatsapp-service
docker build --platform linux/amd64 -f apps/whatsapp-service/Dockerfile \
  -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/whatsapp-service:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/whatsapp-service:latest

# Build and push api-docs-hub
docker build --platform linux/amd64 -f apps/api-docs-hub/Dockerfile \
  -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/api-docs-hub:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev/api-docs-hub:latest
```

> **Important**:
>
> - Run from repository root. The `.` at the end specifies the build context.
> - Use `--platform linux/amd64` when building on Apple Silicon (M1/M2/M3) for Cloud Run compatibility.

## Troubleshooting

### "Repository mapping does not exist" (Cloud Build Trigger)

This is expected on first run. You must manually connect your GitHub repository to Cloud Build:

1. Visit the URL shown in the error (or go to Cloud Build > Triggers > Connect Repository)
2. Select "GitHub (Cloud Build GitHub App)"
3. Authenticate with GitHub and select your repository
4. After connecting, re-run `terraform apply`

See [03-cloud-build-trigger.md](./03-cloud-build-trigger.md) for detailed instructions.

### "Image not found" (Cloud Run)

Build and push the required images using the commands in Step 7 before running `terraform apply`.

### "Container manifest type must support amd64/linux"

This happens when building on Apple Silicon (M1/M2/M3). Always use `--platform linux/amd64`:

```bash
docker build --platform linux/amd64 -f apps/<service>/Dockerfile -t <tag> .
```

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
