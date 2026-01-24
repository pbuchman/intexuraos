# Infrastructure Reference

GCloud authentication, Terraform operations, and Cloud Build deployment details.

---

## GCloud Authentication

**RULE:** NEVER claim "gcloud is not authenticated" without first verifying service account credentials.

### Service Account Credentials

```
~/personal/gcloud-claude-code-dev.json
```

### Verification Steps

1. **Check if credentials file exists:**

   ```bash
   ls -la ~/personal/gcloud-claude-code-dev.json
   ```

2. **Activate service account if needed:**

   ```bash
   gcloud auth activate-service-account --key-file=~/personal/gcloud-claude-code-dev.json
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

### Terraform Alias

Use `tf` command instead of `terraform`. This alias clears emulator env vars that break Terraform:

```bash
alias tf='STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform'
```

Note: The alias may not be available in spawned subshells - if `tf` is not found, the user should run commands manually.

### Commands with Service Account

```bash
# Set credentials and clear emulator env vars
GOOGLE_APPLICATION_CREDENTIALS=~/personal/gcloud-claude-code-dev.json \
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform plan

# Apply changes
GOOGLE_APPLICATION_CREDENTIALS=~/personal/gcloud-claude-code-dev.json \
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform apply
```

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
