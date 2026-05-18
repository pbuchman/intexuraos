# Hetzner Migration Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale Hetzner migration work with a current implementation plan that moves production compute from GCP Cloud Run to Hetzner while keeping the previously accepted retained-GCP assumptions.

**Architecture:** Production app compute moves to one Hetzner VM running Node services under PM2 behind nginx. GCP remains the system of record for Firestore, Pub/Sub topics, Secret Manager, Cloud Storage buckets, Cloud Functions, Artifact Registry/code-worker, and the shared project `intexuraos-dev-pbuchman`. Terraform gets a new provider-isolated Hetzner root at `terraform/hetzner-prod/` plus the minimum retained-GCP resources needed to route Pub/Sub and Cloud Scheduler traffic to `https://intexuraos.cloud`.

**Tech Stack:** Terraform `>= 1.5`, `hashicorp/google ~> 5.0`, `hetznercloud/hcloud ~> 1.45`, Ubuntu 24.04, Node.js 22, pnpm, PM2, nginx, certbot DNS-01 via Cloudflare, Google OIDC JWT verification at the nginx edge.

---

## Planning Outcome

- Parent issue: INT-1632
- Closed stale PR: https://github.com/pbuchman/intexuraos/pull/1747
- New planning branch: `plan/int-1632-hetzner-migration-refresh`
- Current date used for the audit: 2026-05-17

## Migration Assumptions

The stale INT-750 assumptions remain valid where they define what moves and what stays:

- Move to Hetzner: public production HTTP entrypoint, backend app processes, PM2 runtime, nginx TLS termination, nginx API/internal route fan-out, web SPA serving, and deployment/reload automation.
- Retain in GCP: Firestore `(default)`, Pub/Sub topics, Secret Manager, GCS buckets, Cloud Functions, Artifact Registry, Cloud Build triggers needed for retained workers and code-worker, Firebase/Auth0 integration data, and the single project `intexuraos-dev-pbuchman`.
- Retain outside this migration: `workers/orchestrator` remains a VM-hosted worker process managed separately from Cloud Run and Cloud Functions.
- Do not create a second GCP project or sibling `terraform/environments/prod`. Current project rules say `terraform/environments/dev/` is the only GCP environment root because both domains share one GCP project. Use `terraform/hetzner-prod/` for Hetzner-specific resources and retained-GCP references.

## Current-State Audit

### Services To Run On Hetzner

The current repo has 22 Dockerized app services plus the static web frontend. These must be represented in the Hetzner PM2 config, nginx routing, deployment workflow, service URL env, and smoke tests.

| Service | Port | Public API Prefix | Notes |
| --- | ---: | --- | --- |
| `user-service` | 8110 | `/api/user` | Auth, OAuth, user data |
| `notion-service` | 8112 | `/api/notion` | Notion integration |
| `whatsapp-service` | 8113 | `/api/whatsapp` | External webhook plus Pub/Sub push handlers |
| `mobile-notifications-service` | 8114 | `/api/notifications` | Digest scheduler target |
| `research-agent` | 8116 | `/api/research` | Long-running LLM routes and Pub/Sub workers |
| `commands-agent` | 8117 | `/api/commands` | WhatsApp command ingestion |
| `actions-agent` | 8118 | `/api/actions` | Action queue processing |
| `fishing-assistant-service` | 8119 | `/api/fishing-assistant` | Replaces stale `data-insights-agent` assumption |
| `image-service` | 8120 | `/api/images` | Uses retained generated-images GCS bucket |
| `notes-agent` | 8121 | `/api/notes` | CRUD service |
| `app-settings-service` | 8122 | `/api/settings` | Startup dependency for many services |
| `todos-agent` | 8123 | `/api/todos` | Pub/Sub todos processing |
| `bookmarks-agent` | 8124 | `/api/bookmarks` | Pub/Sub enrich and summarize |
| `calendar-agent` | 8125 | `/api/calendar` | Calendar preview Pub/Sub target |
| `linear-agent` | 8126 | `/api/linear` | Scheduler sync/prune targets |
| `web-agent` | 8127 | `/api/web` | Cloudflare Browser Rendering secrets retained in GCP |
| `code-agent` | 8128 | `/api/code` | Code task UI/API, schedulers, PR triage |
| `chat-agent` | 8129 | `/api/chat` | OpenAI and guest session secret |
| `cron-agent` | 8130 | `/api/cron-agent` | Scheduler tick target |
| `hellscript-agent` | 8131 | `/api/hellscript-agent` | Thought buffer service |
| `llm-usage-service` | 8132 | `/api/llm-usage` | Orchestrator usage webhook target |
| `api-docs-hub` | 8133 | not in web manifest | Now active in PM2 and Cloud Run; include in Hetzner PM2 and expose only if needed |

### Workers And Retained Compute

| Worker | Current Deployment | Migration Disposition |
| --- | --- | --- |
| `workers/transcription` | Cloud Function Gen2 | Retain in GCP; keep Pub/Sub `audio-stored` push to the function |
| `workers/vm-lifecycle` | Cloud Function Gen2 | Retain in GCP; scheduler jobs keep calling function URIs |
| `workers/orchestrator` | VM-hosted service outside Cloud Run | Retain as-is; ensure code-agent public/internal URLs still work after cutover |
| `docker/code-worker` | Artifact Registry image, no Cloud Run deploy | Retain in GCP Artifact Registry and Cloud Build trigger |

### Stale PR Gaps To Correct

- PR #1747 referenced `data-insights-agent`; current repo has `fishing-assistant-service`.
- PR #1747 treated `api-docs-hub` as optional; current repo runs it in PM2, Terraform, Cloud Build, and deploy workflows.
- PR #1747 nginx route names do not match the current web manifest for `/api/notifications`, `/api/fishing-assistant`, `/api/images`, `/api/settings`, `/api/cron-agent`, and `/api/hellscript-agent`.
- PR #1747 Pub/Sub coverage predates `pr-triage`, `audio-stored` explicit DLQ handling, transcription worker refactor, and current scheduler jobs.
- PR #1747 used a specific Hetzner primary IP datacenter in one version. The refreshed plan must keep primary IP and server placement aligned by using `location` consistently or deriving the datacenter from the same input.
- PR #1747 temporarily removed monitoring in one commit and then restored it. The refreshed plan keeps monitoring unchanged until an explicit post-cutover observability cleanup.

## Endpoint Changes

### Modified

- Public API traffic for all web-manifest prefixes moves from Cloud Run URLs to nginx on `https://intexuraos.cloud/api/*`.
- Pub/Sub push subscriptions that target app handlers get Hetzner-targeted subscriptions with `push_endpoint = https://intexuraos.cloud/internal/*` and OIDC `audience = https://intexuraos.cloud`.
- Cloud Scheduler jobs that target app handlers get Hetzner-targeted HTTP targets with OIDC `audience = https://intexuraos.cloud`.
- Web bundle service URLs resolve to the public Hetzner domain paths after cutover.

### Created

- `terraform/hetzner-prod/**` as a Hetzner-focused Terraform root with isolated state.
- Hetzner VM, firewall, SSH key, stable IPv4, nginx config, PM2 config, secret loader, deploy scripts, and rollback runbook.
- `/healthz` on nginx for public uptime checks.

### Removed

- Stale PR #1747 is closed and must not be used as the implementation branch.
- Stale `data-insights-agent` PM2/nginx/env wiring from PR #1747 is not carried forward.

### Unchanged

- Firestore, Pub/Sub topics, Secret Manager secrets, GCS data buckets, Cloud Functions, Artifact Registry, code-worker image build, and current Cloud Run resources remain available during migration and rollback.
- Public web hash routes remain hash-based.
- Dev PM2 config `ecosystem.config.cjs` remains the dev environment source of truth.

## Parallel Subtask Contracts

All child issues are direct children of INT-1632 and can be executed in parallel. They share only the contracts listed here; no child issue depends on another child finishing first.

Shared constants for all workers:

- Public origin: `https://intexuraos.cloud`
- GCP project: `intexuraos-dev-pbuchman`
- Service route source of truth: `apps/web/service-manifest.json`
- Dev service runtime source of truth: `ecosystem.config.cjs`
- Current Terraform inventory source of truth: `terraform/environments/dev/main.tf` plus `terraform/environments/dev/pubsub_pr_triage.tf`
- Pub/Sub and Scheduler OIDC audience for Hetzner-targeted requests: `https://intexuraos.cloud`

| Child Issue | Boundary | Owned Files | Contract |
| --- | --- | --- | --- |
| INT-1633: https://linear.app/pbuchman/issue/INT-1633/plan-hetzner-terraform-foundation-and-retained-gcp-resources | Terraform foundation and retained GCP references | `terraform/hetzner-prod/**`; narrow retained-resource additions in `terraform/environments/dev/main.tf` | Exposes Hetzner IP/host outputs; preserves retained GCP data resources; aligns server and primary IP location |
| INT-1634: https://linear.app/pbuchman/issue/INT-1634/plan-hetzner-runtime-pm2-nginx-secrets-and-edge-auth | Hetzner runtime and edge | `scripts/hetzner/**`, `ecosystem.config.prod.cjs` | Exposes PM2 services on ports 8110-8133; nginx implements public and internal routes; secret loader produces prod env safely |
| INT-1635: https://linear.app/pbuchman/issue/INT-1635/plan-gcp-async-control-plane-for-hetzner-cutover | Pub/Sub, Scheduler, Cloud Functions continuity | `terraform/hetzner-prod/pubsub.tf`, `terraform/hetzner-prod/scheduler.tf`, `terraform/hetzner-prod/functions.tf` if split | Exposes app push and scheduler traffic to `https://intexuraos.cloud/internal/*`; keeps retained Cloud Functions on GCP |
| INT-1636: https://linear.app/pbuchman/issue/INT-1636/plan-web-frontend-static-assets-dns-and-external-integrations | Web frontend and public cutover | `apps/web/**` only if required; DNS/webhook runbook docs | Exposes SPA and service URLs through Hetzner; keeps `/share/*` and `/images/*` backed by retained GCS buckets |
| INT-1637: https://linear.app/pbuchman/issue/INT-1637/plan-hetzner-deployment-workflow-rollback-and-migration-self-review | Deploy workflow, rollback, final self-review | `.github/workflows/deploy.yml`, `.github/scripts/smart-dispatch.mjs`, `cloudbuild/scripts/**`, runbooks | Exposes a deploy/cutover/rollback procedure and final service/resource disposition checklist |

## Implementation Tasks

### Task 1: Preserve Stale-PR Context

**Files:**
- No repository file changes.

- [ ] **Step 1: Confirm stale PR is closed**

Run:

```bash
gh pr view 1747 --json state,url,title
```

Expected: `state` is `CLOSED`, title is `Hetzner prod env scaffold (INT-750)`, and URL is `https://github.com/pbuchman/intexuraos/pull/1747`.

- [ ] **Step 2: Keep PR #1747 as reference material only**

Use these PR #1747 files as reference inputs, not as files to merge directly:

```text
terraform/hetzner-prod/**
scripts/hetzner/**
ecosystem.config.prod.cjs
docs/superpowers/plans/2026-04-10-hetzner-prod-migration.md
```

Expected: the new implementation branch is created fresh from current `development`, not from `feature/hetzner-prod-scaffold-int-750`.

### Task 2: Build The Terraform Foundation

**Files:**
- Create: `terraform/hetzner-prod/providers.tf`
- Create: `terraform/hetzner-prod/backend.tf`
- Create: `terraform/hetzner-prod/variables.tf`
- Create: `terraform/hetzner-prod/main.tf`
- Create: `terraform/hetzner-prod/hetzner.tf`
- Create: `terraform/hetzner-prod/outputs.tf`
- Create: `terraform/hetzner-prod/terraform.tfvars.example`
- Modify: `terraform/environments/dev/main.tf` only if a retained GCP secret shell or output is required

- [ ] **Step 1: Create provider-isolated Hetzner root**

Use this provider shape:

```hcl
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
}

provider "hcloud" {}
```

Expected: no provider block assumes a second GCP project.

- [ ] **Step 2: Isolate Terraform state**

Use the existing GCS backend bucket with a distinct prefix:

```hcl
terraform {
  backend "gcs" {
    bucket = "intexuraos-dev-pbuchman-terraform-state"
    prefix = "terraform/state/prod-hetzner"
  }
}
```

Expected: the Hetzner root cannot share the same state object as `terraform/environments/dev`.

- [ ] **Step 3: Define Hetzner placement safely**

Use a single location variable for server and primary IP placement unless there is a verified reason to expose a datacenter variable:

```hcl
variable "hetzner_location" {
  description = "Hetzner location for the prod VM and primary IP."
  type        = string
  default     = "nbg1"
}

resource "hcloud_primary_ip" "prod_ipv4" {
  name          = "intexuraos-prod-ipv4"
  type          = "ipv4"
  assignee_type = "server"
  auto_delete   = false
  location      = var.hetzner_location
  labels        = local.common_labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_server" "prod" {
  name        = "intexuraos-prod"
  server_type = var.hetzner_server_type
  image       = "ubuntu-24.04"
  location    = var.hetzner_location
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  lifecycle {
    prevent_destroy = true
  }
}
```

Expected: no `nbg1-dc3` hardcoding unless the same value drives both server and IP placement.

- [ ] **Step 4: Add lifecycle protection**

Add `prevent_destroy = true` to the Hetzner server and stable primary IP, and keep retained GCP data resources out of this root unless they are read-only data references or additive subscription/job resources.

Expected: `terraform plan` does not propose destroying Firestore, GCS buckets, Pub/Sub topics, Secret Manager secrets, or existing Cloud Run services.

- [ ] **Step 5: Verify Terraform foundation**

Run from `terraform/hetzner-prod`:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
terraform init

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
terraform validate

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
terraform plan
```

Expected: provider init succeeds, validation passes, and plan contains only expected Hetzner/additive retained-GCP resources.

### Task 3: Build Hetzner Runtime And Nginx Edge

**Files:**
- Create: `ecosystem.config.prod.cjs`
- Create: `scripts/hetzner/provision.sh`
- Create: `scripts/hetzner/load-secrets.sh`
- Create: `scripts/hetzner/deploy-nginx.sh`
- Create: `scripts/hetzner/install-nginx-and-cert.sh`
- Create: `scripts/hetzner/nginx/intexuraos.conf`
- Create: `scripts/hetzner/nginx/jwt-verify.lua`
- Create: `docs/operations/hetzner-prod-runbook.md`

- [ ] **Step 1: Generate the PM2 service list from current sources**

Use this exact service/port set:

```text
app-settings-service:8122
notion-service:8112
whatsapp-service:8113
mobile-notifications-service:8114
fishing-assistant-service:8119
notes-agent:8121
bookmarks-agent:8124
code-agent:8128
cron-agent:8130
hellscript-agent:8131
llm-usage-service:8132
user-service:8110
commands-agent:8117
actions-agent:8118
research-agent:8116
todos-agent:8123
image-service:8120
calendar-agent:8125
linear-agent:8126
chat-agent:8129
web-agent:8127
api-docs-hub:8133
```

Expected: `data-insights-agent` is absent and `api-docs-hub` is present.

- [ ] **Step 2: Create prod PM2 config**

`ecosystem.config.prod.cjs` must:

```javascript
if (process.env.INTEXURAOS_ENVIRONMENT !== 'prod') {
  throw new Error('Refusing to start PM2 without INTEXURAOS_ENVIRONMENT=prod');
}
```

Expected: PM2 refuses to start with dev env material, does not set `PUBSUB_EMULATOR_HOST`, and uses `GOOGLE_APPLICATION_CREDENTIALS=/home/deploy/sa-key.json`.

- [ ] **Step 3: Create nginx public API routes**

Routes must match `apps/web/service-manifest.json`:

```text
/api/user -> user-service
/api/whatsapp -> whatsapp-service
/api/notion -> notion-service
/api/notifications -> mobile-notifications-service
/api/fishing-assistant -> fishing-assistant-service
/api/research -> research-agent
/api/commands -> commands-agent
/api/actions -> actions-agent
/api/notes -> notes-agent
/api/todos -> todos-agent
/api/bookmarks -> bookmarks-agent
/api/calendar -> calendar-agent
/api/chat -> chat-agent
/api/linear -> linear-agent
/api/code -> code-agent
/api/images -> image-service
/api/web -> web-agent
/api/settings -> app-settings-service
/api/cron-agent -> cron-agent
/api/hellscript-agent -> hellscript-agent
/api/llm-usage -> llm-usage-service
```

Expected: no route uses stale `/api/mobile-notifications`, `/api/image`, or `/api/app-settings` unless the web manifest is intentionally changed in the same implementation.

- [ ] **Step 4: Create nginx internal route fan-out**

The `/internal/*` route must verify Google OIDC JWTs before proxying, then fan out at least these prefixes:

```text
/internal/whatsapp/ -> whatsapp-service
/internal/actions/ -> actions-agent
/internal/llm/ -> research-agent
/internal/commands -> commands-agent
/internal/calendar/ -> calendar-agent
/internal/bookmarks/ -> bookmarks-agent
/internal/todos/ -> todos-agent
/internal/code/ -> code-agent
/internal/code-tasks/ -> code-agent
/internal/webhooks/ -> code-agent
/internal/logs -> code-agent
/internal/turn-metrics -> code-agent
/internal/merge-conflicts/ -> code-agent
/internal/merge-queue/ -> code-agent
/internal/execution-memory/ -> code-agent
/internal/archive-stale-groups -> code-agent
/internal/auto-archive-merged-tasks -> code-agent
/internal/linear/ -> linear-agent or code-agent according to the current route owner
/internal/cron/ -> cron-agent
/internal/notifications/ -> mobile-notifications-service
/internal/retry-pending -> commands-agent
/internal/drain-queue -> code-agent
```

Expected: every Pub/Sub and Scheduler path listed in Task 4 has an nginx target.

- [ ] **Step 5: Verify runtime scripts**

Run:

```bash
shellcheck scripts/hetzner/*.sh
node -c ecosystem.config.prod.cjs
```

Expected: shellcheck passes and the PM2 config parses.

### Task 4: Build Retained GCP Async Control Plane

**Files:**
- Create or modify: `terraform/hetzner-prod/pubsub.tf`
- Create or modify: `terraform/hetzner-prod/scheduler.tf`
- Create or modify: `terraform/hetzner-prod/functions.tf` only if function references are split from scheduler/pubsub

- [ ] **Step 1: Add Hetzner-targeted Pub/Sub push subscriptions**

Create additive prod-Hetzner subscriptions for every app push handler:

| Topic | Push endpoint | Handler |
| --- | --- | --- |
| `intexuraos-whatsapp-send-dev` | `/internal/whatsapp/pubsub/send-message` | `whatsapp-service` |
| `intexuraos-whatsapp-media-cleanup-dev` | `/internal/whatsapp/pubsub/media-cleanup` | `whatsapp-service` |
| `intexuraos-whatsapp-webhook-process-dev` | `/internal/whatsapp/pubsub/process-webhook` | `whatsapp-service` |
| `intexuraos-srt-transcription-completed-dev` | `/internal/whatsapp/pubsub/transcription-completed` | `whatsapp-service` |
| `intexuraos-transcription-completed-dev` | `/internal/whatsapp/pubsub/transcription-completed` | `whatsapp-service` |
| `intexuraos-commands-ingest-dev` | `/internal/commands` | `commands-agent` |
| `intexuraos-actions-queue-dev` | `/internal/actions/process` | `actions-agent` |
| `intexuraos-research-process-dev` | `/internal/llm/pubsub/process-research` | `research-agent` |
| `intexuraos-llm-analytics-dev` | `/internal/llm/pubsub/report-analytics` | `research-agent` |
| `intexuraos-llm-call-dev` | `/internal/llm/pubsub/process-llm-call` | `research-agent` |
| `intexuraos-calendar-preview-dev` | `/internal/calendar/generate-preview` | `calendar-agent` |
| `intexuraos-bookmark-enrich-dev` | `/internal/bookmarks/pubsub/enrich` | `bookmarks-agent` |
| `intexuraos-bookmark-summarize-dev` | `/internal/bookmarks/pubsub/summarize` | `bookmarks-agent` |
| `intexuraos-todos-processing-dev` | `/internal/todos/pubsub/todos-processing` | `todos-agent` |
| `intexuraos-approval-reply-dev` | `/internal/actions/approval-reply` | `actions-agent` |
| `intexuraos-pr-triage-dev` | `/internal/code/pubsub/pr-triage` | `code-agent` |

Expected: each push endpoint is `https://intexuraos.cloud` plus the path, and each OIDC audience is exactly `https://intexuraos.cloud`.

- [ ] **Step 2: Keep transcription Cloud Function routing on GCP**

Keep `intexuraos-audio-stored-dev` pushing to `module.function_transcription.function_uri` unless a separate migration decision moves transcription compute.

Expected: the transcription function remains deployable by `cloudbuild/scripts/deploy-function.sh transcription`.

- [ ] **Step 3: Add Hetzner-targeted Cloud Scheduler jobs**

Create additive prod-Hetzner jobs for these app endpoints:

| Current Job | Hetzner Target |
| --- | --- |
| `mobile-notifications-digest-yesterday-dev` | `/internal/notifications/digest/run-yesterday` |
| `intexuraos-linear-sync-hourly-dev` | `/internal/linear/sync-all` |
| `intexuraos-linear-issues-prune-hourly-dev` | `/internal/linear/prune-issues` |
| `intexuraos-cron-agent-tick-dev` | `/internal/cron/tick` |
| `intexuraos-retry-pending-commands-dev` | `/internal/retry-pending` |
| `intexuraos-retry-pending-actions-dev` | `/internal/actions/retry-pending` |
| `intexuraos-drain-task-queue-dev` | `/internal/drain-queue` |
| `intexuraos-merge-conflict-reconcile-dev` | `/internal/merge-conflicts/reconcile` |
| `intexuraos-merge-queue-tick-dev` | `/internal/merge-queue/tick` |
| `intexuraos-code-tasks-zombie-sweep-dev` | `/internal/code/detect-zombies` |
| `intexuraos-archive-stale-groups-dev` | `/internal/archive-stale-groups` |
| `intexuraos-auto-archive-merged-tasks-dev` | `/internal/auto-archive-merged-tasks` |
| `intexuraos-execution-memory-process-dev` | `/internal/execution-memory/process` |
| `intexuraos-execution-memory-sweep-errored-dev` | `/internal/execution-memory/sweep-errored` |
| `intexuraos-execution-memory-prune-stale-dev` | `/internal/execution-memory/prune-stale` |

Expected: scheduler OIDC audience is `https://intexuraos.cloud`, and old Cloud Run-targeted jobs have a named pause/remove step in the cutover runbook.

- [ ] **Step 4: Keep non-app scheduler jobs on GCP**

Keep these scheduler flows on their current retained targets:

```text
intexuraos-vm-start-dev -> Cloud Function URI
intexuraos-vm-stop-dev -> Cloud Function URI
code-worker-daily-rebuild-dev -> Cloud Build trigger API
```

Expected: no Hetzner nginx route is required for those jobs.

- [ ] **Step 5: Verify async resources**

Run after apply:

```bash
gcloud pubsub subscriptions list --project=intexuraos-dev-pbuchman \
  --format='value(name,pushConfig.pushEndpoint,pushConfig.oidcToken.audience)'

gcloud scheduler jobs list --location=europe-central2 --project=intexuraos-dev-pbuchman \
  --format='value(name,httpTarget.uri,httpTarget.oidcToken.audience)'
```

Expected: every Hetzner-targeted subscription/job uses `https://intexuraos.cloud`, and retained function/build jobs keep their current GCP API/Function targets.

### Task 5: Build Web And External Cutover

**Files:**
- Modify: `apps/web/service-manifest.json` only if service route prefixes intentionally change
- Modify: `apps/web/src/config.generated.ts` only through `pnpm run generate:service-wiring`
- Modify: `apps/web/cloudbuild.yaml` only if the web build stops reading Cloud Run service URLs
- Modify: `docs/operations/hetzner-prod-runbook.md`

- [ ] **Step 1: Keep service manifest as the route source**

If no public API prefixes change, leave `apps/web/service-manifest.json` unchanged.

Expected: web runtime config and nginx route config use the same public prefixes.

- [ ] **Step 2: Decide web URL injection mode**

Use one of these two explicit modes:

```text
Mode A: build web on Hetzner with INTEXURAOS_*_URL values set to https://intexuraos.cloud/api/*
Mode B: keep Cloud Build web build but replace gcloud run describe-derived URLs with domain path URLs for Hetzner production
```

Expected: production web bundles no longer require Cloud Run `run.app` URLs after cutover.

- [ ] **Step 3: Keep retained GCS public assets reachable**

Nginx must serve the built web SPA files copied to the Hetzner VM and continue serving retained GCS-backed public assets:

```text
SPA static files -> /var/www/intexuraos with try_files $uri $uri/ /index.html
/share/* -> retained shared content bucket
/images/* -> retained generated images bucket
```

Expected: the SPA loads directly from Hetzner nginx after DNS flips, and generated images and shared research HTML continue to load from the retained buckets.

- [ ] **Step 4: Prepare external integration cutover checklist**

Document concrete checks for:

```text
Cloudflare DNS A/AAAA records and TTL
Auth0 allowed callback/logout/web origins
Firebase authorized domains
WhatsApp webhook callback verification
GitHub webhook endpoint for code-agent
Linear webhook endpoint if configured
Notion webhook endpoint if configured
Any IP allowlists that reference the old GCP load balancer IP
```

Expected: the operator can run the checklist without searching the codebase during cutover.

### Task 6: Build Deployment, Rollback, And Final Self-Review

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/scripts/smart-dispatch.mjs`
- Modify: `cloudbuild/scripts/**` only where deployment-routing changes require it
- Create: `docs/operations/hetzner-prod-runbook.md`
- Create: `docs/operations/hetzner-prod-self-review.md`

- [ ] **Step 1: Add a Hetzner deployment path**

The deployment path must:

```text
install dependencies
build TypeScript packages
build web assets with Hetzner URL env
sync repo or release artifact to /opt/intexuraos
run scripts/hetzner/load-secrets.sh without printing secrets
pm2 reload ecosystem.config.prod.cjs --update-env
sudo nginx -t
sudo systemctl reload nginx
```

Expected: the current Cloud Run deployment path remains available until rollback is no longer needed.

- [ ] **Step 2: Add cutover freeze and duplicate-processing controls**

Before DNS cutover, pause or disable old Cloud Run-targeted Pub/Sub subscriptions and app-targeted Scheduler jobs that would otherwise double-process messages after the domain points at Hetzner.

Expected: WhatsApp outbound, LLM usage billing, PR triage, execution memory jobs, and code task queue jobs have no duplicate app-targeted delivery after cutover.

- [ ] **Step 3: Add rollback commands**

The rollback runbook must include:

```text
restore Cloudflare DNS A record to the GCP load balancer IP
resume old Cloud Run-targeted Pub/Sub subscriptions
resume old Cloud Run-targeted Scheduler jobs
stop or drain Hetzner PM2 processes
capture nginx and PM2 logs
leave Hetzner Terraform state intact unless a later cleanup PR removes it
```

Expected: rollback does not require destroying retained GCP resources or the Hetzner VM.

- [ ] **Step 4: Run final self-review**

Create `docs/operations/hetzner-prod-self-review.md` with one row per current service/worker/resource:

```text
name | type | disposition (migrated/retained/removed) | owner subtask | verification evidence
```

Expected: every item in Current-State Audit has a disposition, including `api-docs-hub`, `fishing-assistant-service`, `transcription`, `vm-lifecycle`, `orchestrator`, `code-worker`, Pub/Sub topics, Scheduler jobs, GCS buckets, Secret Manager, Firestore, monitoring, and web hosting.

- [ ] **Step 5: Verify full repo**

Run:

```bash
pnpm run ci:tracked
```

Expected: CI passes before the implementation PR is considered ready.

## Self-Review For This Plan

- Spec coverage: The plan closes stale PR #1747, creates a fresh planning artifact, keeps the original retained-GCP assumptions, and refreshes scope against the current repo.
- Current service coverage: All 22 Dockerized app services, the web frontend, two Cloud Functions workers, the VM-hosted orchestrator, and code-worker are explicitly listed.
- Terraform coverage: Hetzner provider/state, retained GCP resources, Pub/Sub, Scheduler, Cloud Functions, Cloud Build, GCS, Secret Manager, Firestore, and monitoring all have a disposition.
- Stale assumption coverage: `data-insights-agent` is removed from scope, `fishing-assistant-service` and `api-docs-hub` are included, and current web route prefixes replace stale nginx routes.
- Memory coverage: Hetzner IP/server location alignment and provider/environment isolation are explicit requirements; the simple config-mismatch memory is rejected because this is a broad migration.
