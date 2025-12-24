# 01 - GCP Project Setup

This document describes how to create and configure a GCP project for IntexuraOS development.

## Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated

## 1. Create a New Project

### Option A: Using gcloud CLI (Recommended)

```bash
# Set your project ID (must be globally unique)
export PROJECT_ID="intexuraos-dev-$(whoami | tr '.' '-')"

# Create the project
gcloud projects create $PROJECT_ID --name="IntexuraOS Dev"

# Set as active project
gcloud config set project $PROJECT_ID

# Link billing account (get your billing account ID first)
gcloud billing accounts list
export BILLING_ACCOUNT="YOUR_BILLING_ACCOUNT_ID"
gcloud billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT
```

### Option B: Using GCP Console

1. Go to [GCP Console](https://console.cloud.google.com/)
2. Click project dropdown → "New Project"
3. Enter project name: `IntexuraOS Dev`
4. Note the generated Project ID
5. Link billing in "Billing" section

## 2. Enable Required APIs

```bash
# Enable all required APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  compute.googleapis.com
```

## 3. Create Terraform State Bucket

Terraform needs a GCS bucket to store state. Create it before running Terraform.

```bash
# Set region (match your terraform.tfvars)
export REGION="europe-central2"

# Create bucket for Terraform state
gsutil mb -l $REGION gs://${PROJECT_ID}-terraform-state

# Enable versioning for state protection
gsutil versioning set on gs://${PROJECT_ID}-terraform-state
```

## 4. Configure Default Region

```bash
gcloud config set run/region $REGION
gcloud config set compute/region $REGION
```

## 5. Verify Setup

```bash
# Check project is set correctly
gcloud config get project

# Check APIs are enabled
gcloud services list --enabled

# Check bucket exists
gsutil ls gs://${PROJECT_ID}-terraform-state
```

## Summary

After completing these steps, you should have:

- [x] GCP project created and selected
- [x] Billing linked
- [x] Required APIs enabled
- [x] Terraform state bucket created

## Next Step

→ [02-terraform-bootstrap.md](./02-terraform-bootstrap.md)
