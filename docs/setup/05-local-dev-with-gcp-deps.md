# 05 - Local Development with GCP Dependencies

This document describes how to run IntexuraOS services locally while using GCP Firestore and Secret Manager.

## Overview

Local uses:

- **Local services**: Node.js processes via `docker-compose` or `ppnpm run dev`
- **Remote Firestore**: Dev project's Firestore database
- **Remote Secret Manager**: Dev project's secrets (or local .env override)

## Prerequisites

- GCP project set up (see [01-gcp-project.md](./01-gcp-project.md))
- Terraform applied (see [02-terraform-bootstrap.md](./02-terraform-bootstrap.md))
- `gcloud` CLI authenticated

## 1. Authenticate with GCP

Application Default Credentials (ADC) allows local code to access GCP services.

```bash
# Login and set up ADC
gcloud auth application-default login

# Set project
gcloud config set project YOUR_PROJECT_ID

# Verify
gcloud auth application-default print-access-token
```

## 2. Required IAM Roles for Local Development

Your user account needs these roles on the dev project:

| Role                                 | Purpose              |
| ------------------------------------ | -------------------- |
| `roles/datastore.user`               | Read/write Firestore |
| `roles/secretmanager.secretAccessor` | Read secrets         |

Grant roles:

```bash
export PROJECT_ID="your-project-id"
export USER_EMAIL="your-email@example.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="user:$USER_EMAIL" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="user:$USER_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```

## 3. Local Environment Configuration

Create `.env.local` in the repository root (gitignored):

```bash
# .env.local - Local environment
# DO NOT COMMIT THIS FILE

# GCP Project (for Firestore and Secret Manager)
INTEXURAOS_GCP_PROJECT_ID=your-project-id

# Auth configuration (can use secrets or direct values for local)
# Option A: Direct values (faster, no GCP calls)
INTEXURAOS_AUTH_JWKS_URL=https://your-tenant.auth0.com/.well-known/jwks.json
INTEXURAOS_AUTH_ISSUER=https://your-tenant.auth0.com/
INTEXURAOS_AUTH_AUDIENCE=urn:intexuraos:api

# Option B: Use Secret Manager (comment out Option A)
# AUTH_USE_SECRET_MANAGER=true

# Service ports (defaults)
AUTH_SERVICE_PORT=8080
PROMPTVAULT_SERVICE_PORT=8081

# Logging
LOG_LEVEL=debug
```

## 4. Run Services Locally

### Option A: Using pnpm scripts

```bash
# Terminal 1: Auth service
cd apps/user-service
ppnpm run dev

# Terminal 2: PromptVault service
cd apps/promptvault-service
ppnpm run dev
```

### Option B: Using Docker Compose

```bash
# Build and start all services
docker compose -f docker/docker-compose.yaml up --build

# Or in detached mode
docker compose -f docker/docker-compose.yaml up -d --build

# View logs
docker compose -f docker/docker-compose.yaml logs -f

# Stop
docker compose -f docker/docker-compose.yaml down
```

## 5. Verify Local Setup

```bash
# Check auth service health
curl http://localhost:8080/health | jq

# Check notion-gpt service health
curl http://localhost:8081/health | jq

# View OpenAPI docs
open http://localhost:8080/docs
open http://localhost:8081/docs
```

## 6. Testing

Tests use **in-memory fake repositories** via dependency injection—no external services required:

```bash
ppnpm run test          # Run all tests
ppppnpm run test:coverage # Run with coverage report
ppnpm run ci            # Full CI pipeline
```

## Project Structure for Local Development

```
intexuraos/
├── .env.local          # Local environment (gitignored)
├── docker/
│   └── docker-compose.yaml
├── apps/
│   ├── user-service/
│   │   └── .env        # Service-specific overrides (gitignored)
│   └── promptvault-service/
│       └── .env        # Service-specific overrides (gitignored)
```

## Secrets Handling

**DO NOT commit secrets to the repository.**

For local development, you have two options:

### Option 1: Direct Environment Variables (Recommended)

Set auth values directly in `.env.local`. Faster, no GCP calls on startup.

### Option 2: Secret Manager Integration

If you need to test Secret Manager integration:

```javascript
// Code automatically uses Secret Manager when:
// - Running on Cloud Run (has service account)
// - GOOGLE_APPLICATION_CREDENTIALS is set
// - ADC is configured (gcloud auth application-default login)
```

## Troubleshooting

### "Could not load the default credentials"

Run:

```bash
gcloud auth application-default login
```

### "Permission denied" on Firestore

Ensure your user has `roles/datastore.user` on the project.

### Services can't connect to each other

In Docker Compose, services use container names as hostnames.
In local dev, services run on different ports on localhost.

### Environment variables not loading

Check that `.env.local` exists and is in the correct location.
For Docker, ensure `env_file` is configured in `docker-compose.yaml`.

### Terraform hangs on "Initializing the backend..."

If you use local GCP emulators (Firestore, Storage, Pub/Sub), the emulator environment variables interfere with Terraform's GCS backend.

**Cause:** `STORAGE_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, or `PUBSUB_EMULATOR_HOST` redirects Terraform to non-existent local emulators instead of real GCP.

**Solution:** Use a `tf` alias that unsets emulator variables:

```bash
# Add to ~/.zshrc or ~/.bashrc
alias tf='STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform'
```

Then use `tf init`, `tf plan`, `tf apply` instead of `terraform`.

## Summary

After completing these steps, you can:

- [x] Run services locally with `ppnpm run dev` or Docker Compose
- [x] Connect to dev Firestore database
- [x] Access secrets via ADC or direct environment variables
- [x] Test API endpoints locally

## Development Workflow

1. Make code changes
2. Run `ppnpm run ci` to validate
3. Test locally with `ppnpm run dev`
4. Push to `development` branch
5. Cloud Build automatically deploys
