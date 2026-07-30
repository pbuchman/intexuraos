# Hetzner Production Runtime Runbook

Linear: INT-1634

For the reversible repair of code-task lifecycle timestamps and derived issue
groups, follow
[`code-task-lifecycle-backfill.md`](./code-task-lifecycle-backfill.md). Its
release proof, immutable journal, off-host checkpoint, resume, and rollback
gates are mandatory.

This runbook covers the Hetzner host runtime owned by `scripts/hetzner/**` and
`ecosystem.config.prod.cjs`. GCP remains the system of record for Firestore,
Pub/Sub, Secret Manager, retained buckets, Cloud Functions, Artifact Registry,
and the shared project `intexuraos-dev-pbuchman`.

Dead-letter investigation and selected replay follow the
[Pub/Sub DLQ runbook](./pubsub-dlq-runbook.md). Do not inspect or replay a DLQ
with ad-hoc bulk commands.

## Runtime Layout

| Path | Purpose |
| --- | --- |
| `/opt/intexuraos` | Repo checkout run by PM2 |
| `/etc/intexuraos/.env.prod` | `deploy:deploy` mode-600 environment material generated from GCP Secret Manager |
| `/etc/intexuraos/internal-auth-token` | `root:www-data` mode-640 internal auth token injected by nginx after Google OIDC verification |
| `/var/www/intexuraos/web/dist` | Static Vite bundle served by nginx |
| `/etc/nginx/sites-available/intexuraos.conf` | Installed nginx site config |
| `/etc/nginx/lua/jwt-verify.lua` | Google OIDC verifier for `/internal/*` |

## Terraform Root

Hetzner production infrastructure is managed from `terraform/hetzner-prod`.
The committed non-secret environment settings are in
`terraform/hetzner-prod/prod.auto.tfvars.json`; there is no separate
`terraform.env` file for Hetzner. Terraform loads `*.auto.tfvars.json`
automatically, so a normal plan/apply from that root uses the production
Hetzner defaults.

Required local operator inputs are intentionally outside the repo:

| Local input | Purpose |
| --- | --- |
| `HCLOUD_TOKEN` | Hetzner provider token read from the environment |
| `$HOME/.config/gcloud/sa-key.json` | Google provider credential for retained GCP resources |
| `$HOME/.ssh/intexuraos_hetzner_deploy` | SSH private key used by Terraform bootstrap |
| `$HOME/.config/intexuraos/hetzner/provisioner-sa-key.json` | Provisioner service account key copied to the VM |
| `$HOME/.config/intexuraos/hetzner/runtime-sa-key.json` | Runtime service account key copied to the VM |

Use this form for normal reproducible changes:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod plan

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod apply
```

With `hetzner_bootstrap_enabled=true`, Terraform creates or recreates the VM,
copies the service account keys, syncs the repo to `/opt/intexuraos`, installs
runtime dependencies, loads secrets, builds the web bundle, starts PM2, and
deploys nginx. Manual provisioning commands below are for repair or emergency
operation, not the default path.

## GitHub Actions Production Deployment

Merging to `development` deploys production to Hetzner through
`.github/workflows/deploy.yml`. The workflow syncs the checked-out commit to
`/opt/intexuraos`, refreshes GCP Secret Manager material on the VM, installs
dependencies, reloads and health-checks the backward-compatible backend, then
builds and publishes the web bundle, reloads nginx, and verifies the Hetzner
origin with `curl --resolve`. This backend-first order keeps already-open old
browser clients usable during rollout; the Conversation Assistant turn routes
temporarily accept a question-only legacy body and generate the durable request
id server-side. The deploy fails before
remote mutation when the local checkout differs from `GITHUB_SHA`.

Retained GCP targets are triggered with `--sha=${GITHUB_SHA}`. A `SUCCESS`
status is accepted only when the GitHub trigger provenance in
`sourceProvenance.resolvedGitSource.revision` (or the legacy
`sourceProvenance.resolvedRepoSource.commitSha` fallback) exactly equals
`GITHUB_SHA`; an empty or different provenance SHA fails the workflow.

Hetzner deploys expose exact release evidence at `GET /deployment.json` as
uncached JSON containing `commitSha`, `workflowRunId`, and `deployedAt`. The
script removes the prior marker before syncing the first runtime change, so an
interrupted rollout cannot present stale success evidence. After PM2, nginx,
direct-origin health, and public WhatsApp health are ready, it atomically
publishes the new marker and verifies its exact commit and workflow run through
both the direct origin and public DNS. Verification also requires exactly those
three keys, a canonical UTC timestamp, `Content-Type: application/json`, and a
`Cache-Control` policy containing `no-store`.

Required GitHub configuration:

| Name | Type | Purpose |
| --- | --- | --- |
| `HETZNER_DEPLOY_SSH_PRIVATE_KEY` | repository secret | Private key matching `deploy_ssh_public_key` in `terraform/hetzner-prod/prod.auto.tfvars.json` |
| `HETZNER_PROD_HOST` | repository variable, optional | Hetzner host/IP; defaults to `162.55.210.48` |

Manual dispatch target `hetzner-prod` runs the same Hetzner deploy. Manual
dispatch targets `firestore`, `vm-lifecycle`, `transcription`, and
`code-worker` still trigger only the retained GCP Cloud Build targets. Migrated
app/web services must not be redeployed through GCP Cloud Run or app Cloud
Build triggers.

For emergency use outside GitHub Actions, check out the exact intended commit
and invoke `scripts/hetzner/github-actions-deploy.sh` without `GITHUB_SHA` or
`GITHUB_RUN_ID`. The script uses `git rev-parse HEAD`, records
`workflowRunId` as `manual`, and retains the same readiness and attestation
gates. It refuses a checkout with tracked or untracked changes and syncs a
temporary `git archive` of that exact commit rather than live worktree bytes.
Record the local HEAD in the deployment evidence before running it.

## Provisioning

Run on the VM as root:

```bash
cd /opt/intexuraos
INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/provision.sh --email ops@example.com
```

Provisioning installs Node 22, PM2, Google Cloud CLI, nginx with Lua support,
`lua-cjson`, logrotate, certbot with the Cloudflare DNS plugin, loads secrets,
installs certificates, and deploys the nginx config. A provisioned host must
pass the nginx JWT Lua dependency check before nginx is reloaded:

```bash
lua5.1 <<'LUA'
local ok, cjson = pcall(require, "cjson.safe")
if not ok or cjson == nil then error("missing cjson.safe") end
local loader, err = package.loaders[2]("resty.openidc")
if type(loader) ~= "function" then error(err or "missing resty.openidc") end
LUA
```

Certbot uses `INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN`, a dedicated Cloudflare
token with Zone DNS Edit permission for the `intexuraos.cloud` zone. Do not
reuse the Browser Rendering token stored in `INTEXURAOS_CLOUDFLARE_API_TOKEN`.
Terraform creates this DNS-token secret separately from the app-secret
inventory and grants Secret Manager Secret Accessor to the
`ixos-hetzner-provisioner-dev` service account. Use that service account
key for `/home/deploy/provisioner-sa-key.json` on the VM.

Runtime services use a separate `ixos-hetzner-runtime-dev` service
account key at `/home/deploy/runtime-sa-key.json`. That runtime account has the
retained GCP data-plane permissions needed by PM2 services: Firestore user,
Pub/Sub publisher, Firebase Auth admin, logging writer, object admin for the
retained writable buckets, self token creation for signing, and access to the
explicit Hetzner runtime secret allowlist. Do not reuse the provisioner key for
PM2 runtime.

Terraform bootstrap copies the local keys from
`provisioner_sa_key_path` and `runtime_sa_key_path` to these VM paths.

## Secret Refresh

The VM needs readable keys at `/home/deploy/provisioner-sa-key.json` and
`/home/deploy/runtime-sa-key.json`. `load-secrets.sh` uses the provisioner key
to read Secret Manager and writes `GOOGLE_APPLICATION_CREDENTIALS` in
`.env.prod` to the runtime key.

SentryBox code-task automation depends on Hetzner runtime secrets for inbound
webhook verification. Workers read issue evidence through the private
`error_hub` MCP and do not use a Sentry SaaS auth token. See
[`docs/operations/sentry-code-task-automation.md`](./sentry-code-task-automation.md)
before rotating `INTEXURAOS_SENTRY_WEBHOOK_SECRET`,
or `INTEXURAOS_SENTRY_AUTOMATION_USER_ID`.

```bash
cd /opt/intexuraos
sudo INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh
```

The script prints secret names only, never values. It writes
`/etc/intexuraos/.env.prod` with mode `600` using an explicit Hetzner runtime
secret allowlist and updates `/etc/intexuraos/internal-auth-token` for nginx.

## Deploy Or Reload Runtime

```bash
cd /opt/intexuraos
sudo INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh
sudo INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/install-pm2-logrotate.sh
sudo -iu deploy bash -lc 'cd /opt/intexuraos && CI=true pnpm install --frozen-lockfile'
RELEASE_SHA='<40-character lowercase Git SHA deployed to /opt/intexuraos>'
RELEASE_MESSAGE='<matching commit subject>'
[[ "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || exit 1
sudo -iu deploy env COMMIT_SHA="${RELEASE_SHA}" COMMIT_MESSAGE="${RELEASE_MESSAGE}" \
  INTEXURAOS_ENVIRONMENT=prod bash -lc 'cd /opt/intexuraos && bash scripts/hetzner/deploy-web.sh'
sudo -iu deploy env INTEXURAOS_COMMIT_SHA="${RELEASE_SHA}" \
  INTEXURAOS_ENVIRONMENT=prod bash -lc 'cd /opt/intexuraos && bash scripts/hetzner/reload-pm2.sh'
sudo INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh
```

`deploy-web.sh` builds `apps/web` with `/api/*` service URLs and publishes
`apps/web/dist` to `/var/www/intexuraos/web/dist`. It clears inherited
`INTEXURAOS_*` variables and temporarily replaces `apps/web/.env*` files with
a sanitized `.env.production.local` containing only web-safe Auth0/Firebase/
Sentry values plus generated public API paths, so ignored local env files
cannot leak backend secrets into Vite.
`reload-pm2.sh` renders the CommonJS ecosystem config to a private JSON file
before starting PM2, because PM2 treats `ecosystem.config.prod.cjs` as a plain
script on the Hetzner host. It derives every local `/health` URL from the
rendered app ports and requires three consecutive all-service passes before
`pm2 save`. `PM2_HEALTH_URLS` remains an explicit override for controlled
diagnostics; normal deployments must leave it unset.

PM2 file logs are bounded by `/etc/logrotate.d/intexuraos-pm2`: daily rotation,
early rotation at 100 MB per file, 14 retained rotations, compression with one
rotation of delay, and `pm2 reloadLogs` after rotation. Validate the installed
policy without rotating data:

```bash
sudo logrotate --debug /etc/logrotate.d/intexuraos-pm2
sudo systemctl is-active alloy
```

A controlled forced rotation may be run with
`sudo logrotate --force /etc/logrotate.d/intexuraos-pm2`; immediately verify
`pm2 status`, new active log files owned by `deploy`, and active Grafana Alloy
collection. Reinstalling the policy is idempotent. Rollback may restore the
previous policy, but must preserve existing rotated log files until their
documented retention expires.

`deploy-nginx.sh` verifies `cjson.safe` and
`resty.openidc`, then runs `nginx -t` before reload. If the VM is not available,
validate an equivalent generated config in a container or staging VM that has
nginx Lua/OpenResty modules installed, then record the command output in the
cutover notes.

## Cloudflare DNS Cutover

This production cutover uses Cloudflare DNS/proxy records to point the public
origin at the Hetzner IP. It does not require a `cloudflared` tunnel change.
Do not change orchestrator worker tunnel records for this migration.

At cutover, update the `intexuraos.cloud` apex records in Cloudflare:

| Record | Action |
| --- | --- |
| `A intexuraos.cloud` | Set to `162.55.210.48` |
| `AAAA intexuraos.cloud` | Remove unless Hetzner IPv6 is enabled and verified |
| Proxy status | Preserve the current proxied/DNS-only mode unless the cutover owner intentionally changes it |

The previous GCP load-balancer IP for rollback context was `136.110.232.83`.
Use it only after recreating the legacy GCP load balancer with
`enable_load_balancer=true`.

For automated certbot DNS-01 issuance, store a dedicated Cloudflare token with
Zone DNS Edit and Zone Read permissions for `intexuraos.cloud` as a new version
of `INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN` in GCP Secret Manager. The Browser
Rendering token in `INTEXURAOS_CLOUDFLARE_API_TOKEN` must not be reused.

Until that Cloudflare record and token state is corrected, direct origin checks
with `curl --resolve intexuraos.cloud:443:162.55.210.48 ...` are the canonical
Hetzner-origin smoke test.

## Legacy GCP Load Balancer Teardown

Keep `enable_load_balancer=false` in `terraform/environments/dev`. Applying
that root removes only the legacy web load-balancer edge: global forwarding
rules, target HTTP/HTTPS proxies, URL maps, backend buckets, global address,
and the load-balancer SSL certificate. It does not delete the retained GCS
buckets or Firestore.

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/environments/dev plan \
  -var='enable_load_balancer=false'

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/environments/dev apply \
  -var='enable_load_balancer=false'
```

The Hetzner Terraform root currently uses the single VM plus reserved primary
IP. It does not create a Hetzner Load Balancer resource. If a load balancer is
needed later, add it in `terraform/hetzner-prod`; do not recreate the paid GCP
web load balancer unless explicitly rolling back.

## Rebuild Verification

The required destructive reproducibility check is a Terraform-driven VM
replacement, not an in-place repair. Use:

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

On 2026-05-31 this check destroyed server `134626820`, created server
`134635829`, retained primary IPv4 `162.55.210.48`, completed Terraform
bootstrap, and a follow-up `terraform -chdir=terraform/hetzner-prod plan`
reported no changes.

For runtime-dependency fixes, run two consecutive replacement cycles. After
each cycle, verify:

```bash
ssh -i ~/.ssh/intexuraos_hetzner_deploy deploy@162.55.210.48 \
  'lua5.1 -e '\''local ok,cjson=pcall(require,"cjson.safe"); if not ok or cjson == nil then error("missing cjson.safe") end; local loader,err=package.loaders[2]("resty.openidc"); if type(loader) ~= "function" then error(err or "missing resty.openidc") end'\'' && sudo nginx -t && pm2 status'

curl --fail --silent --show-error --max-time 15 \
  --resolve intexuraos.cloud:443:162.55.210.48 \
  https://intexuraos.cloud/healthz

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod plan -detailed-exitcode
```

The final `plan -detailed-exitcode` must return `0`.

## PR Triage Replay

After repairing the Hetzner internal edge, replay a stuck PR-triage event by
publishing a `code.pr.triage.requested` message whose `eventId` is the
normalized `github-pr-events` document id:

```bash
PR_TRIAGE_PAYLOAD="$(
  node - <<'NODE'
process.stdout.write(JSON.stringify({
  type: 'code.pr.triage.requested',
  eventId: 'f5fc5d26-97d8-41a5-998e-a87205496d0f',
  repository: 'pbuchman/intexuraos',
  pullRequestNumber: 2113,
  correlationId: 'manual-replay-pr-2113',
  timestamp: new Date().toISOString(),
}));
NODE
)"

GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
gcloud pubsub topics publish intexuraos-pr-triage-dev \
  --project=intexuraos-dev-pbuchman \
  --message="${PR_TRIAGE_PAYLOAD}"
```

For PR `2113`, verify `github-event-log-entries/RnT6AeqqF2o2zrVPvadO` moves to
`decisionState: completed`, `event_decisions/ed_RnT6AeqqF2o2zrVPvadO` exists,
and the expected code-task or explicit skip decision is visible.

## Async Edge Cutover

The retained GCP Pub/Sub topics and Hetzner-targeted Cloud Scheduler jobs are
managed in the separate Hetzner production Terraform root. The existing
`terraform/environments/dev` root remains the retained GCP source of truth for
old Cloud Run consumers and does not carry a Hetzner edge toggle.

After async activation, `terraform/hetzner-prod/prod.auto.tfvars.json` keeps
`activate_hetzner_async_consumers=true`. A plain
`terraform -chdir=terraform/hetzner-prod apply` must preserve the active
Hetzner subscriptions and enabled Hetzner scheduler jobs. Override the variable
to `false` only for an intentional staged rebuild or rollback.

Before DNS cutover, create the staged Hetzner subscriptions and Scheduler jobs
with Pub/Sub filters active and Scheduler jobs paused:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod plan \
  -var='activate_hetzner_async_consumers=false'

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod apply \
  -var='activate_hetzner_async_consumers=false'
```

After the Hetzner nginx `/internal/*` routes pass smoke tests and the operator
has explicitly approved async activation, first disable the old Cloud
Run-targeted Pub/Sub push consumers and pause the old app-targeted Cloud
Scheduler jobs in coordination with `terraform/environments/dev`. Do not touch
the retained audio-stored -> transcription Cloud Function subscription. Then
apply the activation gate:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod apply \
  -var='activate_hetzner_async_consumers=true'
```

This creates Hetzner-targeted Pub/Sub push subscriptions and Cloud Scheduler
HTTP jobs at `https://intexuraos.cloud/internal/*` with OIDC audience
`https://intexuraos.cloud`, matching `jwt-verify.lua`. The first apply keeps
the new Pub/Sub subscriptions behind the staging filter and keeps new Scheduler
jobs paused. The second apply activates them; after activation, keep
`activate_hetzner_async_consumers=true` in `prod.auto.tfvars.json` so future
plain applies remain active. Review duplicate-processing risk before running
the activation. The `scripts/hetzner/cutover-gcp-edge.sh` helper prints the
equivalent `gcloud` updates for audit or emergency use, but Terraform is the
source of truth.

## Retired Async Cleanup

After removed app services are absent from PM2 on dev and production, use the
guarded cleanup marker in `terraform/hetzner-prod/retired-async-cleanup.tf` to
delete stale prod-Hetzner Scheduler jobs and Pub/Sub push subscriptions that no
longer appear in the active async maps. The marker describes each target first
and exits without deleting if the live endpoint differs from the Terraform
inventory.

Run the one-time cleanup with the normal Hetzner Terraform credentials:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod apply \
  -var='enable_retired_async_consumer_cleanup=true'
```

After the cleanup apply succeeds, return to the committed default so later
plain applies do not keep a cleanup marker in state:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/hetzner-prod apply
```

## Pre-Cutover Smoke Test

Before changing DNS, reload through the production readiness gate. It derives
the current app ports from `ecosystem.config.prod.cjs`, requires every PM2
process to be online, and requires all health endpoints to pass three times:

```bash
RELEASE_SHA='<40-character lowercase Git SHA currently deployed to /opt/intexuraos>'
[[ "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || exit 1
INTEXURAOS_COMMIT_SHA="${RELEASE_SHA}" INTEXURAOS_ENVIRONMENT=prod \
  PM2_HEALTH_CONSECUTIVE_SUCCESSES=3 bash scripts/hetzner/reload-pm2.sh
curl --fail --silent --show-error http://127.0.0.1/healthz
sudo nginx -t
pm2 status
```

After DNS resolves to the Hetzner IP, verify public routing:

```bash
curl --fail https://intexuraos.cloud/healthz
curl --fail https://intexuraos.cloud/api/user/health
curl --fail https://intexuraos.cloud/api/settings/health
curl --fail --silent --show-error --max-time 15 \
  --resolve intexuraos.cloud:443:162.55.210.48 \
  https://intexuraos.cloud/api/whatsapp/health
curl --fail --silent --show-error --max-time 15 \
  https://intexuraos.cloud/api/whatsapp/health
curl --fail --silent --show-error --max-time 15 \
  --resolve intexuraos.cloud:443:162.55.210.48 \
  https://intexuraos.cloud/deployment.json
curl --fail --silent --show-error --max-time 15 \
  https://intexuraos.cloud/deployment.json
```

Both deployment documents must contain the frozen SHA exactly. A missing
document during rollout is expected fail-closed behavior; do not treat it as a
successful deployment.

## Internal Edge Auth

GCP Pub/Sub and Cloud Scheduler requests must use OIDC audience
`https://intexuraos.cloud`. nginx verifies the Google-issued bearer token in
`jwt-verify.lua`, strips the public `Authorization` header, clears any
client-supplied `X-Internal-Auth` or `From`, and injects the trusted token
from `/etc/intexuraos/internal-auth-token` before proxying to the app service.
The verifier only accepts tokens whose signed `email` claim is one of the
expected retained-GCP Pub/Sub push service accounts or the Cloud Scheduler
service account.

Private WhatsApp sync uses the same edge-auth path. The external bridge machine
must call both
`POST https://intexuraos.cloud/internal/whatsapp/private/events` and
`POST https://intexuraos.cloud/internal/whatsapp/private/media`, and may call
`POST https://intexuraos.cloud/internal/whatsapp/private/media/backfill` for
stored-media repairs, with a Google
OIDC bearer token whose audience is `https://intexuraos.cloud` and whose email
claim is
`intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`.
The public `/api/whatsapp/internal/*` prefix is blocked and must not be used.

## Route Ownership Notes

Public `/api/*` routes mirror `apps/web/service-manifest.json`.
Public `/api/*/internal` requests are blocked before proxying so the public
prefix rewrite cannot tunnel to upstream internal handlers.

`/internal/linear/sync-all` and `/internal/linear/prune-issues` route to
`linear-agent`. Code-agent still owns `/internal/linear/issue-context/*`, so
that route is configured before the linear scheduler routes.

`/share/*` and `/images/*` continue to proxy to retained public GCS buckets.
nginx clears browser `Authorization`, `Cookie`, `X-Internal-Auth`, and `From`
headers before proxying those retained-bucket requests.
The SPA itself is served from `/var/www/intexuraos/web/dist`.
