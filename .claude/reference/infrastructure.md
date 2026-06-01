# Infrastructure Reference

GCloud authentication, Terraform operations, and Cloud Build deployment details.

---

## Default Region

**All GCP resources are located in `europe-central2` unless specified otherwise.**

When using `gcloud` commands that require a region, always specify `--region=europe-central2`:

```bash
# Cloud Build
gcloud builds list --region=europe-central2
gcloud builds describe <BUILD_ID> --region=europe-central2
gcloud builds log <BUILD_ID> --region=europe-central2
gcloud builds triggers list --region=europe-central2
gcloud builds triggers run <TRIGGER_NAME> --region=europe-central2 --sha=<COMMIT_SHA>

# Cloud Run
gcloud run services list --region=europe-central2
gcloud run services describe <SERVICE> --region=europe-central2

# Artifact Registry
gcloud artifacts repositories list --location=europe-central2
```

**Project ID:** `intexuraos-dev-pbuchman`

**Single project for both environments.** This project is authoritative for resources serving BOTH `dev.intexuraos.cloud` (PM2 on `home-dev`) AND `intexuraos.cloud` (Cloud Run services, Cloud Functions, the GCS bucket that hosts the prod web bundle, Pub/Sub topics, secrets). The `-dev-pbuchman` suffix is legacy and does NOT imply a separate prod project — none exists. Accordingly, the only Terraform environment directory in this repo is `terraform/environments/dev/`, which owns infrastructure for both domains. Do not author a sibling `prod` environment directory unless a future migration introduces a real second project.

**Artifact Registry URL:** `europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev`

---

## GCloud Authentication

**RULE:** NEVER claim "gcloud is not authenticated" without first verifying service account credentials.

### Service Account Credentials

```
~/.config/gcloud/sa-key.json
```

### Verification Steps

1. **Check if credentials file exists:**

   ```bash
   ls -la ~/.config/gcloud/sa-key.json
   ```

2. **Activate service account if needed:**

   ```bash
   gcloud auth activate-service-account --key-file=~/.config/gcloud/sa-key.json
   ```

3. **Verify authentication:**

   ```bash
   gcloud auth list
   ```

### When to Use Service Account

- Firestore queries for investigation
- Any `gcloud` commands requiring project access
- Accessing production/dev data for debugging
- **Terraform operations** (plan, apply, destroy)

**You are NEVER "unauthenticated" if the service account key file exists.** Activate it and proceed.

---

## Terraform Operations

**RULE:** Always use the service account for Terraform operations. Never rely on browser-based authentication.

### Running Terraform Commands

**Always clear emulator env vars and set credentials inline:**

```bash
# Plan changes
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform plan

# Apply changes
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform apply

# Init (when needed)
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform init
```

**⚠️ Hook enforced:** Running bare `terraform` commands without env var clearing is blocked by `.claude/hooks/validate-terraform.sh`.

### Why Service Account Over Browser Auth

- Browser OAuth tokens expire and require re-authentication
- Service accounts provide consistent, scriptable access
- No interactive prompts that break automation

The service account `claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com` has full admin permissions for all Terraform-managed resources.

### Gotchas

- Cloud Run images managed by Cloud Build, not Terraform (uses `ignore_changes`)
- "Image not found": run `./scripts/push-missing-images.sh` for new services
- Web app: backend buckets need URL rewrite for `/` → `/index.html`

---

## Terraform-Only Resource Creation

**RULE: ALL persistent infrastructure MUST be created via Terraform. Direct CLI resource creation is FORBIDDEN.**

| Command                          | What It Creates        | Use Terraform Instead          |
| -------------------------------- | ---------------------- | ------------------------------ |
| `gsutil mb`                      | GCS buckets            | `google_storage_bucket`        |
| `gcloud pubsub topics create`    | Pub/Sub topics         | `google_pubsub_topic`          |
| `gcloud pubsub subscriptions`    | Pub/Sub subscriptions  | `google_pubsub_subscription`   |
| `gcloud run deploy`              | Cloud Run services     | `google_cloud_run_service`     |
| `gcloud secrets create`          | Secret Manager secrets | `google_secret_manager_secret` |
| `gcloud sql instances create`    | Cloud SQL instances    | `google_sql_database_instance` |
| `gcloud compute instances`       | Compute Engine VMs     | `google_compute_instance`      |
| `gcloud iam service-accounts`    | Service accounts       | `google_service_account`       |
| `gcloud projects add-iam-policy` | IAM bindings           | `google_*_iam_*`               |

**Why:** Terraform tracks state, enables reproducibility, version control, drift detection. CLI creates "orphan" resources invisible to IaC.

**Exception:** Truly ephemeral resources for debugging. Never new named resources.

---

## Cloud Build & Deployment

### Build Pipeline Architecture

**CI:** `.github/workflows/ci.yml` runs `pnpm run ci` on all branches (lint, typecheck, test, build)

**Deploy:** `.github/workflows/deploy.yml` automatically deploys production to Hetzner on every push to `development` and also supports manual `workflow_dispatch` target `hetzner-prod`. The Hetzner job uses `scripts/hetzner/github-actions-deploy.sh`, syncs the checked-out commit to `/opt/intexuraos`, refreshes secrets on the VM, rebuilds the web bundle, reloads PM2/nginx, and runs direct-origin health checks.

Required GitHub configuration:

- Secret: `HETZNER_DEPLOY_SSH_PRIVATE_KEY`
- Optional variable: `HETZNER_PROD_HOST` (defaults to `162.55.210.48`)

The same workflow can manually trigger only these retained GCP Cloud Build targets:

- `firestore`
- `vm-lifecycle`
- `transcription`
- `code-worker`

Migrated app/web services do not deploy through GCP Cloud Build or Cloud Run. Hetzner deployment automation is owned by `terraform/hetzner-prod` and the `scripts/hetzner/` runtime scripts.

### File Locations

| Purpose                      | File                                    |
| ---------------------------- | --------------------------------------- |
| CI workflow                  | `.github/workflows/ci.yml`              |
| Retained GCP deploy workflow | `.github/workflows/deploy.yml`          |
| Firestore pipeline           | `cloudbuild/cloudbuild-firestore.yaml`  |
| Cloud Function pipelines     | `workers/<worker>/cloudbuild.yaml`      |
| code-worker image pipeline   | `docker/code-worker/cloudbuild.yaml`    |
| Trigger definitions (TF)     | `terraform/modules/cloud-build/main.tf` |

### Adding a New Service Deployment

Do not add GCP Cloud Run or app/web Cloud Build deployment paths for migrated services. Add runtime wiring to Hetzner infrastructure/scripts instead, and keep retained GCP triggers limited to Firestore, Cloud Functions, and code-worker image rebuilds.

---

## Pub/Sub Topic Registration

**RULE:** When adding a NEW Pub/Sub topic, you MUST update THREE locations:

1. **Terraform:** `terraform/environments/dev/main.tf` — Add `module "pubsub_<topic-name>"` declaration
2. **Pub/Sub UI:** `tools/pubsub-ui/server.mjs` — Add to `TOPICS` array and `TOPIC_ENDPOINTS` mapping
3. **Test Script:** `scripts/pubsub-publish-test.mjs` — Add event template to `EVENTS` object

**Why:** The Pub/Sub UI auto-creates topics on emulator startup and provides manual testing interface. Missing registration breaks local development workflow.

**Files to update:**

- `tools/pubsub-ui/server.mjs` — TOPICS array + TOPIC_ENDPOINTS object
- `tools/pubsub-ui/index.html` — CSS styles, dropdown option, EVENT_TEMPLATES
- `tools/pubsub-ui/README.md` — Documentation tables
- `scripts/pubsub-publish-test.mjs` — Event type + usage docs
