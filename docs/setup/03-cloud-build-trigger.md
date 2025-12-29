# 03 - Cloud Build Trigger

This document describes the Cloud Build CI/CD pipeline and trigger configuration.

## Overview

IntexuraOS uses Cloud Build (2nd gen) to:

1. Detect which services are affected by changes
2. Build Docker images for affected services
3. Push images to Artifact Registry
4. Deploy affected services to Cloud Run (one pipeline per service)

CI checks (lint, typecheck, tests) run in GitHub Actions before the Cloud Build trigger starts.

## Architecture

The Cloud Build setup consists of:

1. **2nd Gen Repository Connection** - Links GitHub to GCP (created manually via Console)
2. **Webhook Trigger (development)** - Automatically triggered on push to `development` branch
3. **Manual Trigger (main)** - Disabled by default, manually triggered for production deployments

## Prerequisites

Before running Terraform, you must create the GitHub connection manually.

### Step 1: Create GitHub Connection in GCP Console

1. Go to [Cloud Build → Repositories (2nd gen)](https://console.cloud.google.com/cloud-build/repositories/2nd-gen)
2. Select your project and region (`europe-central2`)
3. Click **Create host connection**
4. Select **GitHub** as the provider
5. Enter connection name: `intexuraos-github-dev`
6. Click **Connect**
7. Complete the GitHub OAuth authorization flow
8. Grant access to your `intexuraos` repository

### Step 2: Verify Connection

After completing the OAuth flow, verify the connection:

```bash
gcloud builds connections list --region=europe-central2
```

You should see:

```
NAME                INSTALLATION_STATE
intexuraos-github-dev   COMPLETE
```

### Step 3: Add Connection Name to Terraform Variables

Add to your `terraform.tfvars`:

```hcl
github_connection_name = "github-pbuchman"
```

Or set via environment variable:

```bash
export TF_VAR_github_connection_name="github-pbuchman"
```

### Step 4: Import Connection into Terraform State

Before running `terraform apply`, import the existing connection:

```bash
cd terraform/environments/dev

# Initialize terraform first
terraform init

# Import the connection (adjust PROJECT_ID to your project)
terraform import \
  module.cloud_build.google_cloudbuildv2_connection.github \
  projects/intexuraos-dev-pbuchman/locations/europe-central2/connections/github-pbuchman
```

### Step 5: Run Terraform

```bash
terraform apply
```

Terraform will:

1. Link the `intexuraos` repository to the existing connection
2. Create the webhook trigger for `development` branch
3. Create the manual trigger for `main` branch

## Trigger Configuration

### Webhook Trigger (Development)

- **Name**: `intexuraos-dev-webhook`
- **Branch**: `development` (regex: `^development$`)
- **Event**: Push (automatic via Cloud Build GitHub App)
- **Config**: `cloudbuild/cloudbuild.yaml`

### Manual Trigger (Main)

- **Name**: `intexuraos-dev-manual`
- **Branch**: `main` (regex: `^main$`)
- **State**: Disabled (run manually)
- **Config**: `cloudbuild/cloudbuild.yaml`

## Build Pipeline Steps

The pipeline (`cloudbuild/cloudbuild.yaml`) now runs **independent per-service chains** after the shared setup:

1. `npm-ci` (node:22-slim) — installs dependencies
2. `detect-affected` (node:22) — writes `/workspace/affected.json`
3. Per-service pipelines (each waits only on `detect-affected` → build → push → deploy):
   - `user-service`: `build-user-service` → `push-user-service` → `deploy-user-service`
   - `promptvault-service`: `build-promptvault-service` → `push-promptvault-service` → `deploy-promptvault-service`
   - `notion-service`: `build-notion-service` → `push-notion-service` → `deploy-notion-service`
   - `whatsapp-service`: `build-whatsapp-service` → `push-whatsapp-service` → `deploy-whatsapp-service`
   - `api-docs-hub`: `build-api-docs-hub` → `push-api-docs-hub` → `deploy-api-docs-hub`
4. Web app: `build-web` → `deploy-web` (gated by `affected.json` or `_FORCE_DEPLOY=true`)
5. Static assets: `sync-static-assets` (runs independently; not gated by affected services)

Each pipeline stage is gated in `cloudbuild.yaml` using `/workspace/affected.json` (or `_FORCE_DEPLOY=true` to override). Deployment scripts no longer contain skip logic; the Cloud Build steps decide whether to run. There is **no shared deploy step** and no cross-service `waitFor` dependencies.

## Affected Detection Logic

The `detect-affected.mjs` script determines which services need deployment:

```
packages/common/** → all services
apps/user-service/** → user-service only
apps/promptvault-service/** → promptvault-service only
apps/notion-service/** → notion-service only (reserved)
apps/whatsapp-service/** → whatsapp-service only
apps/api-docs-hub/** → api-docs-hub only
apps/web/** → web only
package.json, package-lock.json, tsconfig*.json → all services
```

## View Build Logs

```bash
# List recent builds
gcloud builds list --limit=5 --region=europe-central2

# View specific build
gcloud builds log BUILD_ID --region=europe-central2

# Stream logs of running build
gcloud builds log BUILD_ID --stream --region=europe-central2
```

Or use the [Cloud Build Console](https://console.cloud.google.com/cloud-build/builds).

## Manual Build Trigger

### Trigger via gcloud

```bash
# Trigger the manual (main) build
gcloud builds triggers run intexuraos-dev-manual \
  --region=europe-central2 \
  --branch=main

# Trigger the webhook (development) build manually
gcloud builds triggers run intexuraos-dev-webhook \
  --region=europe-central2 \
  --branch=development
```

### Trigger via Console

1. Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers)
2. Find the trigger you want to run
3. Click **Run** → Select branch → **Run trigger**

## Troubleshooting

### "Connection not found"

If Terraform fails with "connection not found":

1. Verify the connection was created in the correct region (`europe-central2`)
2. Verify the connection name matches `github_connection_name` variable
3. Check connection status: `gcloud builds connections list --region=europe-central2`

### "INSTALLATION_STATE: PENDING_INSTALL_APP"

The GitHub App needs to be installed:

1. Go to [Cloud Build → Repositories (2nd gen)](https://console.cloud.google.com/cloud-build/repositories/2nd-gen)
2. Click on your connection
3. Complete the GitHub App installation flow

### "Permission denied" on deployment

Ensure the Cloud Build service account has the required roles:

- `roles/run.admin` - Deploy to Cloud Run
- `roles/iam.serviceAccountUser` - Act as service accounts
- `roles/artifactregistry.writer` - Push images
- `roles/logging.logWriter` - Write logs

### Build not triggering on push

1. Verify the branch pattern matches your branch name
2. Check the Cloud Build GitHub App has access to your repository
3. Verify the trigger is not disabled

## Reference

- [Cloud Build 2nd Gen Documentation](https://cloud.google.com/build/docs/automating-builds/github/connect-repo-github)
- [Cloud Build GitHub App](https://github.com/apps/google-cloud-build)
- [cloudbuild.yaml Reference](https://cloud.google.com/build/docs/build-config-file-schema)
