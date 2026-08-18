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

## GCloud Authentication And Bootstrap Boundaries

Verify the active principal and credential source before any GCP operation. Do
not infer authentication from the presence or absence of a particular file.

Prefer short-lived credentials in this order:

1. GitHub OIDC through the Terraform-managed Workload Identity Federation
   provider for protected automation;
2. operator ADC with service-account impersonation for interactive work;
3. a dedicated external bootstrap key only where federation/impersonation is
   not yet supported.

A bootstrap key must be outside the repository and outside both secret
packages, mode `0600`, narrowly scoped to one environment, and separately
rotated. The DEV renderer may access only
`INTEXURAOS_SECRET_PACKAGE_DEV`; the Hetzner provisioner and protected deploy
identity may access only `INTEXURAOS_SECRET_PACKAGE_PROD`. Runtime service
accounts, the orchestrator, and code workers do not receive Secret Manager
access.

The dedicated home-dev renderer is `ixos-home-secret-renderer-dev`; Terraform
outputs `home_dev_secret_renderer_service_account_email` and grants only
resource-level DEV accessor. Its transitional external key path is
`/home/pbuchman/.config/intexuraos/secret-renderer-sa-key.json` (mode `0600`).
Terraform must not create or store that key. Local Mac operators prefer user
ADC plus impersonation of the same service account.

Local/home-dev runtime and orchestration use two other external, non-packaged
credentials. `ixos-home-runtime-dev` has only the Hetzner-equivalent data-plane
union (Firestore, Firebase Auth, logging, Pub/Sub publish, and object access to
the three runtime buckets) and is selected from
`${HOME}/.config/intexuraos/home-runtime-sa-key.json` by `.envrc.local`.
`ixos-home-orchestrator-dev` has only repository-level Artifact Registry reader
and is fixed by the generator to
`${HOME}/.config/intexuraos/home-orchestrator-sa-key.json`, regardless of an
inherited broad credential. Neither identity has Secret Manager access; neither
key belongs in a package or code worker. Terraform manages identities/IAM, not
their external JSON keys.

Never use a credential contained in a package to fetch that package. Never put
a GCP service-account JSON key in GitHub Actions; use WIF/OIDC.

Verify without printing tokens or private-key fields:

```bash
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gcloud config get-value project
```

For a file-backed exception, validate only mode, `type`, `client_email`,
`project_id`, and `private_key_id`. Do not print the JSON.

---

## Terraform Operations

Use an explicitly selected short-lived or external administrative credential;
never rely on whatever ambient identity happens to be active. Package payloads
and versions are not Terraform inputs.

### Running Terraform Commands

Always clear emulator variables. If the selected credential is file-backed,
set `GOOGLE_APPLICATION_CREDENTIALS` to its protected external path before
running these commands:

```bash
# Plan changes
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform plan

# Apply changes
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform apply

# Init (when needed)
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform init
```

**⚠️ Hook enforced:** Running bare `terraform` commands without env var clearing is blocked by `.claude/hooks/validate-terraform.sh`.

Before `apply` or `destroy`, verify the principal, plan, project, and absence of
secret payloads in variables/state. Use least privilege and short-lived
impersonation rather than a standing full-admin service-account key.

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

Secret version publication is a controlled data-plane exception: Terraform
creates the package containers and IAM, while the approved package publisher
adds an immutable validated version outside Terraform through
`scripts/secret-package.mjs`. This prevents payload data from entering state.
It does not authorize direct creation of containers or ad hoc versions.

---

## Cloud Build & Deployment

### Build Pipeline Architecture

**CI:** `.github/workflows/ci.yml` runs `pnpm run ci` on all branches (lint, typecheck, test, build)

**Deploy:** `.github/workflows/deploy.yml` automatically deploys production to Hetzner on every push to `development` and also supports manual `workflow_dispatch` target `hetzner-prod`. The Hetzner job uses `scripts/hetzner/github-actions-deploy.sh`, syncs the checked-out commit to `/opt/intexuraos`, refreshes secrets on the VM, rebuilds the web bundle, reloads PM2/nginx, and runs direct-origin health checks.

Required GitHub configuration:

- Secret: `HETZNER_DEPLOY_SSH_PRIVATE_KEY`
- Optional variable: `HETZNER_PROD_HOST` (defaults to `162.55.210.48`)
- Protected numeric PROD package-version input/variable used by the deployment
  attestation; `latest` and aliases are forbidden

Retained-GCP access from GitHub uses OIDC/WIF, with both Terraform-managed
providers and service-account bindings restricted to immutable
repository/owner IDs, the exact repository, and `refs/heads/development`. It
must not use a stored GCP JSON key. The federated principal only triggers the
approved retained Cloud Build targets; the Hetzner job uses SSH and never
receives a Google or package credential.

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
