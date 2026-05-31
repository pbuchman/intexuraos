# Hetzner Production Migration Plan

Linear: INT-1637

Parent issue: INT-1632

This document is the integration-level operator plan for the Hetzner migration
PR. It consolidates INT-1633, INT-1634, INT-1635, and INT-1636 into one
replacement pull request. Do not execute migration or DNS cutover without explicit approval from the operator.
The operator approved the Terraform Hetzner VM rebuild verification on
2026-05-31; DNS cutover and async activation still require explicit approval.

## Superseded PRs

The integration PR replaces:

| PR | Issue | Scope |
| --- | --- | --- |
| #2095 | INT-1633 | Hetzner Terraform foundation and retained GCP inventory |
| #2099 | INT-1634 | Runtime, PM2, nginx, secret loader, certbot, edge auth |
| #2098 | INT-1635 | Retained GCP Pub/Sub, Scheduler, and Cloud Function continuity |
| #2097 | INT-1636 | Web frontend, static assets, DNS, callbacks, external integrations |

close the superseded PRs only after the replacement PR is open and references
all four PR numbers. Leave a comment on each superseded PR linking to the
replacement PR, then close it without merging.

## Integration Branch Workflow

1. Start from latest `development`.
2. Create `feature/int-1637-hetzner-migration-integration`.
3. Merge #2095, #2098, #2097, and #2099 in that order.
4. Resolve conflicts by keeping `terraform/hetzner-prod` as the Hetzner
   production root and leaving `terraform/environments/dev` as the retained GCP
   root.
5. Remove duplicate dev-root `hetzner_edge_origin` retargeting. Staged async
   cutover belongs to `terraform/hetzner-prod` through
   `activate_hetzner_async_consumers`.
6. Apply the review fixes for runtime secret parsing, public-origin validation,
   nginx internal auth injection, and sanitized web env generation.
7. Add this migration plan and `docs/operations/hetzner-prod-self-review.md`.
8. Run focused tests, Terraform formatting/validation, and `pnpm run ci:tracked`.
9. Request dedicated reviews for Terraform/GCP/Hetzner, runtime/security, and
   web/DNS/docs.
10. Open one replacement PR into `development`, ready for review, with
    `Fixes INT-1633`, `Fixes INT-1634`, `Fixes INT-1635`, `Fixes INT-1636`,
    `Fixes INT-1637`, `Relates INT-1632`, and `Supersedes #2095 #2097 #2098 #2099`.
11. Comment on and close the superseded PRs after the replacement PR exists.

## Endpoint Changes

### Modified

- Public API traffic moves from Cloud Run URLs to nginx on
  `https://intexuraos.cloud/api/*` after DNS cutover.
- App-targeted Pub/Sub consumers gain Hetzner-targeted push subscriptions at
  `https://intexuraos.cloud/internal/*`.
- App-targeted Cloud Scheduler jobs gain Hetzner-targeted HTTP jobs at
  `https://intexuraos.cloud/internal/*`.
- Web bundle service URLs resolve to public `/api/*` paths generated from
  `apps/web/service-manifest.json`.
- Static web `/` and `/index.html` are served by Hetzner nginx from the
  published Vite bundle.
- Retained GCS bucket routes `/share/*` and `/images/*` are proxied by Hetzner
  nginx while the buckets stay in GCP.
- Provider callback endpoints move to the Hetzner domain where applicable:
  GitHub OAuth uses `/oauth/connections/github/callback`, Linear uses
  `/api/linear/linear/webhook`, and WhatsApp uses
  `/api/whatsapp/whatsapp/webhooks`.
- Cloudflare DNS apex records move to the Hetzner public IP only during the
  approved cutover window; `www` records are recorded for rollback context but
  remain out of scope unless a later approved change adds certificate and nginx
  host support for `www.intexuraos.cloud`.

### Created

- `terraform/hetzner-prod/**` for Hetzner server, network, retained GCP
  references, staged async consumers, and migration outputs.
- `ecosystem.config.prod.cjs` and `scripts/hetzner/**` for PM2, nginx, secrets,
  certbot, web deploy, runtime deploy, and emergency cutover audit commands.
- `docs/operations/hetzner-prod-runbook.md`,
  `docs/operations/hetzner-prod-migration-plan.md`, and
  `docs/operations/hetzner-prod-self-review.md`.

### Removed

- No retained GCP resources are removed in this PR.
- The stale `data-insights-agent` migration assumption is removed from the
  active scope and replaced by `fishing-assistant-service`.
- The superseded PR branches #2095, #2097, #2098, and #2099 are closed after
  the replacement PR is open.

### Unchanged

- Firestore, Secret Manager, Pub/Sub topics, retained GCS buckets, Cloud
  Functions, Artifact Registry, Cloud Build, monitoring, and current Cloud Run
  resources remain available for rollback.
- `api-docs-hub remains local-only on Hetzner` at PM2 port 8133 during this
  cutover; no public Hetzner route replaces it in this PR.
- `terraform/environments/dev` remains the retained GCP source of truth.
- No migration or DNS cutover is performed by this PR.

## Pre-Migration Verification

Run these before opening the replacement PR:

```bash
pnpm vitest run scripts/__tests__/hetzner-runtime.test.ts
terraform fmt -recursive terraform/hetzner-prod
terraform -chdir=terraform/hetzner-prod init -backend=false
terraform -chdir=terraform/hetzner-prod validate
pnpm run ci:tracked
```

When planning real infrastructure, clear emulator variables and use an
explicit service account credential. `terraform/hetzner-prod/prod.auto.tfvars.json`
is the committed non-secret Hetzner environment file, and Terraform loads it
automatically:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod plan
```

Required local inputs for this root are `HCLOUD_TOKEN`,
`~/.ssh/intexuraos_hetzner_deploy`,
`~/.config/intexuraos/hetzner/provisioner-sa-key.json`, and
`~/.config/intexuraos/hetzner/runtime-sa-key.json`. Do not apply this plan
during PR preparation unless the operator explicitly approves infrastructure
changes.

## Migration Sequence

1. Apply the Hetzner root with async consumers staged. With
   `hetzner_bootstrap_enabled=true`, this creates or recreates the VM and
   bootstraps the runtime from Terraform:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod apply
```

2. Manual VM commands are for repair or emergency operation after Terraform has
   created the host. Terraform bootstrap already copies
   `/home/deploy/provisioner-sa-key.json` and
   `/home/deploy/runtime-sa-key.json`, runs provisioning, loads secrets, builds
   web assets, starts PM2, and deploys nginx:

```bash
cd /opt/intexuraos
sudo INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/provision.sh --email ops@example.com
sudo INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh
```

The VM must have `/home/deploy/provisioner-sa-key.json` for secret loading and
certbot DNS credentials, plus `/home/deploy/runtime-sa-key.json` for PM2 app
runtime. The provisioner and runtime service accounts are intentionally
separate.

3. If repairing manually, deploy code, web assets, PM2 processes, and nginx:

```bash
sudo -iu deploy bash -lc 'cd /opt/intexuraos && CI=true pnpm install --frozen-lockfile'
sudo -iu deploy bash -lc 'cd /opt/intexuraos && INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-web.sh'
sudo -iu deploy bash -lc 'cd /opt/intexuraos && INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh'
sudo INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh
```

4. Smoke test local PM2 ports, nginx `/healthz`, public API routes through a
   host override, retained `/share/*` and `/images/*` routes, and provider
   callbacks.
5. Freeze app deploys and record rollback values: Cloudflare DNS records, the
   old GCP load-balancer IP `136.110.232.83`, provider callback URLs, and old
   app-targeted Pub/Sub and Scheduler state.
6. Switch Cloudflare DNS to the Hetzner IP `162.55.210.48` only after
   approval. This production cutover changes Cloudflare DNS/proxy records, not
   any `cloudflared` tunnel used by orchestrator workers. Set the apex
   `A intexuraos.cloud` record to `162.55.210.48`, remove the apex `AAAA`
   record unless IPv6 is intentionally enabled and verified, and preserve the
   current proxied/DNS-only mode unless the cutover owner changes it. Store a
   dedicated Cloudflare token with Zone DNS Edit and Zone Read for
   `intexuraos.cloud` as a new version of
   `INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN`; do not reuse
   `INTEXURAOS_CLOUDFLARE_API_TOKEN`.
7. After DNS is moved to Hetzner, apply `terraform/environments/dev` with
   `enable_load_balancer=false` to remove only the legacy GCP web load-balancer
   edge: forwarding rules, target proxies, URL maps, backend buckets, global
   address, and load-balancer certificate. Retained GCS buckets and Firestore
   must remain untouched.
8. Before activation, disable the old Cloud Run-targeted Pub/Sub push consumers
   and pause the old app-targeted Cloud Scheduler jobs in coordination with
   `terraform/environments/dev`. This prevents duplicate processing when
   `activate_hetzner_async_consumers=true` is applied. Do not disable the
   retained audio-stored -> transcription Cloud Function subscription.
9. Activate async consumers only after `/internal/*` smoke tests pass. After
   the active apply succeeds, keep
   `activate_hetzner_async_consumers=true` in
   `terraform/hetzner-prod/prod.auto.tfvars.json` so a plain future
   `terraform apply` preserves the active Hetzner subscriptions and enabled
   scheduler jobs:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod apply \
  -var='activate_hetzner_async_consumers=true'
```

10. Monitor Pub/Sub delivery, Scheduler executions, nginx access/error logs,
   PM2 status, app health checks, Auth0/Firebase login, GitHub OAuth, Linear
   webhooks, WhatsApp webhook delivery, and Cloudflare cache behavior.

## Executed Terraform Rebuild Check

On 2026-05-31, the required reproducibility check was executed with:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod plan \
  -replace=hcloud_server.prod \
  -out=/tmp/hetzner-prod-recreate-final.tfplan

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod apply /tmp/hetzner-prod-recreate-final.tfplan
```

The apply destroyed Hetzner server `134626820`, created server `134635829`,
kept primary IPv4 `162.55.210.48`, completed Terraform bootstrap, and left
`terraform -chdir=terraform/hetzner-prod plan -no-color` with no changes.
Post-rebuild smoke checks showed 22 PM2 processes online, nginx config valid,
local `app-settings-service` and `user-service` health checks passing, and
origin HTTPS checks for `/healthz`, `/api/user/health`, and
`/api/settings/health` returning HTTP 200 through `--resolve`.

## Rollback

Rollback keeps Hetzner Terraform state intact and restores traffic to retained
GCP paths:

1. Override `activate_hetzner_async_consumers=false` in `terraform/hetzner-prod`
   only for rollback to pause Hetzner Scheduler jobs and reinstate the Pub/Sub
   staging filter.
2. Before moving traffic back, restore the old Cloud Run-targeted Pub/Sub push consumers
   and unpause the old app-targeted Cloud Scheduler jobs in `terraform/environments/dev`
   or the recorded operational rollback commands.
3. Restore Cloudflare DNS records to the recorded GCP load balancer IP only if
   the legacy GCP load balancer is recreated first with
   `enable_load_balancer=true`; the last recorded IP before teardown was
   `136.110.232.83`.
4. Restore provider callbacks and allowlists to recorded rollback values.
5. Capture nginx logs and PM2 logs from the Hetzner host.
6. Stop or drain Hetzner PM2 processes only after GCP traffic is verified.
7. Verify `https://intexuraos.cloud/healthz`, static web, Auth0 login, `/api/*`,
   `/share/*`, `/images/*`, Pub/Sub delivery, and Scheduler executions through
   the rollback path.
