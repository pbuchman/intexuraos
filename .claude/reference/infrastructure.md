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

**Deploy:** `.github/workflows/deploy.yml` triggers on push to `development` branch only:

1. Runs `.github/scripts/smart-dispatch.mjs` to analyze changes
2. Triggers Cloud Build based on strategy:
   - **MONOLITH** — Rebuild all (>3 affected OR global change) → `intexuraos-dev-deploy` trigger
   - **INDIVIDUAL** — Rebuild affected only (≤3) → `<service>` triggers in parallel
   - **NONE** — No deployable changes, skip

**Manual override:** `workflow_dispatch` with `force_strategy: monolith` to rebuild all

**Global Triggers** (force MONOLITH): `terraform/`, `cloudbuild/cloudbuild.yaml`, `cloudbuild/scripts/`, `pnpm-lock.yaml`, `tsconfig.base.json`

### File Locations

| Purpose                  | File                                     |
| ------------------------ | ---------------------------------------- |
| CI workflow              | `.github/workflows/ci.yml`               |
| Deploy workflow          | `.github/workflows/deploy.yml`           |
| Smart dispatch           | `.github/scripts/smart-dispatch.mjs`     |
| Main pipeline (all)      | `cloudbuild/cloudbuild.yaml`             |
| Per-service pipeline     | `apps/<service>/cloudbuild.yaml`         |
| Deploy scripts           | `cloudbuild/scripts/deploy-<service>.sh` |
| Trigger definitions (TF) | `terraform/modules/cloud-build/main.tf`  |

### Adding a New Service to Cloud Build

1. Add build+deploy steps to `cloudbuild/cloudbuild.yaml`
2. Create `apps/<service>/cloudbuild.yaml`
3. Create `cloudbuild/scripts/deploy-<service>.sh`
4. Add to `docker_services` in `terraform/modules/cloud-build/main.tf`
5. Add to `SERVICES` array in `.github/scripts/smart-dispatch.mjs`

**First deployment:** Service must exist in Terraform before Cloud Build can deploy. Run `./scripts/push-missing-images.sh` for new services.

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
