# 03 - Cloud Build Trigger

This document describes the Cloud Build CI/CD pipeline and trigger configuration.

## Overview

PraxOS uses Cloud Build (2nd gen) to:

1. Run CI checks (lint, typecheck, test)
2. Detect which services are affected by changes
3. Build Docker images for affected services
4. Deploy affected services to Cloud Run

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
5. Enter connection name: `praxos-github-dev`
6. Click **Connect**
7. Complete the GitHub OAuth authorization flow
8. Grant access to your `praxos` repository

### Step 2: Verify Connection

After completing the OAuth flow, verify the connection:

```bash
gcloud builds connections list --region=europe-central2
```

You should see:

```
NAME                INSTALLATION_STATE
praxos-github-dev   COMPLETE
```

### Step 3: Add Connection Name to Terraform Variables

Add to your `terraform.tfvars`:

```hcl
github_connection_name = "praxos-github-dev"
```

Or set via environment variable:

```bash
export TF_VAR_github_connection_name="praxos-github-dev"
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
  projects/praxos-dev-pbuchman/locations/europe-central2/connections/praxos-github-dev
```

### Step 5: Run Terraform

```bash
terraform apply
```

Terraform will:

1. Link the `praxos` repository to the existing connection
2. Create the webhook trigger for `development` branch
3. Create the manual trigger for `main` branch

## Trigger Configuration

### Webhook Trigger (Development)

- **Name**: `praxos-dev-webhook`
- **Branch**: `development` (regex: `^development$`)
- **Event**: Push (automatic via Cloud Build GitHub App)
- **Config**: `cloudbuild/cloudbuild.yaml`

### Manual Trigger (Main)

- **Name**: `praxos-dev-manual`
- **Branch**: `main` (regex: `^main$`)
- **State**: Disabled (run manually)
- **Config**: `cloudbuild/cloudbuild.yaml`

## Build Pipeline Steps

The pipeline (`cloudbuild/cloudbuild.yaml`) executes:

| Step                | Description                             | Duration |
| ------------------- | --------------------------------------- | -------- |
| 1. node-version     | Print Node.js version                   | ~1s      |
| 2. npm-ci           | Install dependencies                    | ~30s     |
| 3. npm-run-ci       | Run lint, typecheck, tests              | ~60s     |
| 4. detect-affected  | Determine which services changed        | ~2s      |
| 5. build-\*-service | Build Docker images (if affected)       | ~60s     |
| 6. push-\*-service  | Push to Artifact Registry (if affected) | ~30s     |
| 7. deploy-affected  | Deploy to Cloud Run                     | ~60s     |

## Affected Detection Logic

The `detect-affected.mjs` script determines which services need deployment:

```
packages/common/** → all services
packages/domain/** → all services
packages/infra/** → all services
apps/auth-service/** → auth-service only
apps/promptvault-service/** → promptvault-service only
apps/whatsapp-service/** → whatsapp-service only
apps/api-docs-hub/** → api-docs-hub only
package.json, package-lock.json → all services
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
gcloud builds triggers run praxos-dev-manual \
  --region=europe-central2 \
  --branch=main

# Trigger the webhook (development) build manually
gcloud builds triggers run praxos-dev-webhook \
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
