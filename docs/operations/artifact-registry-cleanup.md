# Artifact Registry Cleanup Runbook

This runbook is for reducing Docker image storage in Artifact Registry without deleting live Cloud Run or orchestrator images.

## Scope

- Primary target: `europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev`
- Explicit non-target for the first pass: `gcf-artifacts`

## Preflight

1. Verify GCP auth:

```bash
gcloud auth list
gcloud config get-value project
```

2. Verify current repository size:

```bash
gcloud artifacts repositories list \
  --location=europe-central2 \
  --project=intexuraos-dev-pbuchman \
  --format='table(name.basename(),sizeBytes,updateTime)'
```

3. Confirm the orchestrator host and env file:

```bash
uname -n
grep '^INTEXURAOS_CODE_WORKER_IMAGE=' ~/.code-orchestrator/env || true
```

## Export Live Images

```bash
node scripts/artifact-registry/export-live-images.mjs \
  --project=intexuraos-dev-pbuchman \
  --region=europe-central2 \
  --repository=intexuraos-dev \
  --orchestrator-env-path='~/.code-orchestrator/env' \
  --out-dir=/tmp/artifact-registry/live-$(date +%F)
```

Review:

- `/tmp/artifact-registry/live-YYYY-MM-DD/cloud-run-images.json`
- `/tmp/artifact-registry/live-YYYY-MM-DD/orchestrator-image.json`
- `/tmp/artifact-registry/live-YYYY-MM-DD/protected-digests.json`
- `/tmp/artifact-registry/live-YYYY-MM-DD/warnings.json`

## Generate Prune Plan

```bash
node scripts/artifact-registry/generate-prune-plan.mjs \
  --project=intexuraos-dev-pbuchman \
  --location=europe-central2 \
  --repository=intexuraos-dev \
  --keep-count=3 \
  --protected=/tmp/artifact-registry/live-$(date +%F)/protected-digests.json \
  --retired-packages=claude-worker,commands-router,data-insights-service,llm-orchestrator,llm-orchestrator-service \
  --out-dir=/tmp/artifact-registry/plan-$(date +%F)
```

Review:

- `/tmp/artifact-registry/plan-YYYY-MM-DD/prune-plan.json`
- `/tmp/artifact-registry/plan-YYYY-MM-DD/prune-summary.md`

## Dry Run Deletes

Retired packages only:

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan-$(date +%F)/prune-plan.json
```

Single package:

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan-$(date +%F)/prune-plan.json \
  --scope=package:code-worker
```

The CLI prints the exact `gcloud artifacts docker images delete ... --delete-tags --quiet` commands and does not execute them unless `--execute` is supplied.

## Execute Deletes

Retired packages:

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan-$(date +%F)/prune-plan.json \
  --scope=retired-packages \
  --execute \
  --batch-size=50
```

`code-worker` after confirming the orchestrator follows `code-worker:latest`:

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan-$(date +%F)/prune-plan.json \
  --scope=package:code-worker \
  --execute \
  --batch-size=50
```

## Ensure The Orchestrator Follows Latest Before Code-Worker Prune

The orchestrator should keep following `code-worker:latest` so each task pull
refreshes to the newest worker image. Before pruning `code-worker`, make sure the
env file does not pin an old digest:

```bash
grep '^INTEXURAOS_CODE_WORKER_IMAGE=' ~/.code-orchestrator/env || true
sed -i 's#^INTEXURAOS_CODE_WORKER_IMAGE=.*#INTEXURAOS_CODE_WORKER_IMAGE=europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest#' ~/.code-orchestrator/env
sudo systemctl restart intexuraos-orchestrator@pbuchman
```

Re-export live images after the restart and verify the current `latest` digest
appears in `protected-digests.json`.

## Terraform Cleanup Policies

Dry-run first:

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform init

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform plan
```

The intended steady state is:

- active cleanup policy after live digests are verified inside the newest-3 window
- global keep count of `3`
- general delete policy for images older than `86400s` (1 day)
- `code-worker` delete policy for images older than `86400s` (1 day)

If the exported prune plan shows no package with more than `3` retained digests, the live runtimes are already inside the retained window and the policy can be applied immediately.

## Verification

Immediate verification:

```bash
gcloud artifacts repositories list \
  --location=europe-central2 \
  --project=intexuraos-dev-pbuchman \
  --format='table(name.basename(),sizeBytes,updateTime)'
```

Next-day verification:

Google cleanup-policy processing is asynchronous. Re-run the repository-size command the next day to confirm the policy continued removing eligible artifacts.
