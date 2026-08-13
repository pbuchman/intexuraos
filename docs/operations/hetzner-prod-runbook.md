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
| `/etc/intexuraos/.env.prod` | `deploy:deploy` mode-`0600` merge of versioned config and the exact PROD package env projection |
| `/home/deploy/provisioner-sa-key.json` | external bootstrap credential, mode `0600`; never present in the package or used by PM2 |
| `/home/deploy/runtime-sa-key.json` | mode-`0600` runtime credential atomically rendered from the PROD package |
| `/etc/intexuraos/internal-auth-token` | `root:www-data` mode-640 internal auth token injected by nginx after Google OIDC verification |
| `/etc/letsencrypt/cloudflare.ini` | root-owned mode-`0600` certbot credential rendered from the PROD package |
| `/etc/intexuraos/tls-private-key.pem` | root-owned mode-`0600` TLS key projection |
| `/var/lib/intexuraos/secret-packages/prod/current` | exact validated generic package release pointer |
| `/var/lib/intexuraos/secret-projections/prod/current` | transactional target-specific projection pointer; stable paths above resolve through it |
| `/var/www/intexuraos/web/releases/<commit-sha>` | Immutable complete Vite bundle for one release |
| `/var/www/intexuraos/web/current` | Atomically replaced symlink to the Vite release served by nginx |
| `/var/www/intexuraos/web/dist` | Legacy bootstrap bundle retained for the first atomic cutover only |
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
| Short-lived operator credential | Google provider credential for retained GCP resources; use impersonation where available |
| `$HOME/.ssh/intexuraos_hetzner_deploy` | SSH private key used by Terraform bootstrap |
| `$HOME/.config/intexuraos/hetzner/provisioner-sa-key.json` | Bounded provisioner key copied to the VM; external to PROD and authorized only for the PROD package |

Use this form for normal reproducible changes:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform -chdir=terraform/hetzner-prod plan

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform -chdir=terraform/hetzner-prod apply
```

With `hetzner_bootstrap_enabled=true`, Terraform creates or recreates the VM,
installs the external provisioner credential, syncs the repo, and invokes the
loader with an approved numeric PROD version. The loader obtains and renders
the runtime credential from the package before PM2 starts. Terraform must not
copy, accept, or store the runtime SA JSON or package payload. Manual commands
below are for repair or emergency operation, not the default path.

## GitHub Actions Production Deployment

Merging to `development` deploys production to Hetzner through
`.github/workflows/deploy.yml`. The workflow syncs the checked-out commit to
`/opt/intexuraos`, fetches and stages an exact numeric PROD package, installs
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
uncached JSON containing `commitSha`, `workflowRunId`, `deployedAt`, and
`secretPackageVersion`. The
script removes the prior marker before syncing the first runtime change, so an
interrupted rollout cannot present stale success evidence. After PM2, nginx,
direct-origin health, and public WhatsApp health are ready, it atomically
publishes the new marker and verifies its exact commit, workflow run, and
numeric PROD package version through
both the direct origin and public DNS. Verification also requires exactly those
four keys, a canonical UTC timestamp, `Content-Type: application/json`, and a
`Cache-Control` policy containing `no-store`.

Required GitHub configuration:

| Name | Type | Purpose |
| --- | --- | --- |
| `HETZNER_DEPLOY_SSH_PRIVATE_KEY` | repository secret | Private key matching `deploy_ssh_public_key` in `terraform/hetzner-prod/prod.auto.tfvars.json` |
| `HETZNER_PROD_HOST` | repository variable, optional | Approved production host/IP |
| `PROD_SECRET_PACKAGE_VERSION` | repository variable | Reviewed positive numeric PROD version mapped by the workflow to process-local `SECRET_PACKAGE_VERSION`; never `latest` or an alias |

There is no manual version input or GitHub environment binding for this pin in
the current workflow. Access to the repository variable and changes to the
workflow that consumes it must therefore be restricted through repository
administration and reviewed branch/ruleset controls. A manual emergency run
sets process-local `SECRET_PACKAGE_VERSION` explicitly; it does not change the
repository variable.

The retained-GCP jobs use GitHub OIDC and the Terraform-managed WIF providers.
Their attribute conditions bind immutable owner/repository IDs, the exact
repository name, and `refs/heads/development`. Do not add a GCP service-account
JSON key to GitHub. The Hetzner job itself has no Google credential and only
uses SSH; the VM's external provisioner identity fetches PROD.

Manual dispatch target `hetzner-prod` runs the same Hetzner deploy. Manual
dispatch targets `firestore`, `transcription`, and `code-worker` still trigger
only the retained GCP Cloud Build targets. Migrated
app/web services must not be redeployed through GCP Cloud Run or app Cloud
Build triggers.

For emergency use outside GitHub Actions, obtain incident approval, check out
the exact intended commit, set the approved numeric PROD version, and invoke
`scripts/hetzner/github-actions-deploy.sh` without `GITHUB_SHA` or
`GITHUB_RUN_ID`. The script uses `git rev-parse HEAD`, records
`workflowRunId` as `manual`, and retains the same readiness and attestation
gates. It refuses a checkout with tracked or untracked changes and syncs a
temporary `git archive` of that exact commit rather than live worktree bytes.
Record the local HEAD in the deployment evidence before running it.

## Provisioning

Run on the VM as root:

```bash
cd /opt/intexuraos
RELEASE_SHA="$(git rev-parse --verify HEAD)"
[[ "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || exit 1
INTEXURAOS_COMMIT_SHA="${RELEASE_SHA}" INTEXURAOS_ENVIRONMENT=prod \
  bash scripts/hetzner/provision.sh \
  --version <prod-numeric-version> --email <operations-email>
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

Certbot uses the PROD package's `cloudflareDnsApiTokenBase64` file member, a
dedicated Cloudflare token with only the required zone permissions. Do not
reuse the Browser Rendering token. The provisioner fetches the package and
renders the certbot projection; certbot and nginx never call Secret Manager.

Runtime services use a separate `ixos-hetzner-runtime-dev` service
account key at `/home/deploy/runtime-sa-key.json`. That runtime account has the
retained GCP data-plane permissions needed by PM2 services: Firestore user,
Pub/Sub publisher, Firebase Auth admin, logging writer, object admin for the
retained writable buckets, and self token creation for signing. It has no
Secret Manager permission. Do not reuse the provisioner key for PM2 runtime.

Terraform bootstrap copies only the external provisioner credential. The
runtime JSON is rotated outside Terraform, packaged as
`runtimeGcpServiceAccountJsonBase64`, validated, and rendered atomically as
mode `0600` by the provisioner.

## Runtime Configuration And Secret Refresh

The VM initially needs only the external provisioner credential at
`/home/deploy/provisioner-sa-key.json`. `load-secrets.sh` uses it to fetch the
approved exact PROD package version, validates CRC32C/schema/environment/exact
membership, and renders all target projections to private staging. It writes
`GOOGLE_APPLICATION_CREDENTIALS` in `.env.prod` to the runtime key rendered
from the same package. The provisioner is never inside the package. The exact
boundary is defined in the
[runtime configuration policy](./runtime-configuration.md).

SentryBox code-task automation depends on Hetzner runtime secrets for inbound
webhook verification. Workers read issue evidence through the private
`error_hub` MCP and do not use a Sentry SaaS auth token. See
[`docs/operations/sentry-code-task-automation.md`](./sentry-code-task-automation.md)
before rotating `INTEXURAOS_SENTRY_WEBHOOK_SECRET`,
or `INTEXURAOS_SENTRY_AUTOMATION_USER_ID`.

Routine refreshes must use `github-actions-deploy.sh`; do not invoke the
loader's combined compatibility mode as a shortcut. The deploy wrapper installs
the locked workspace dependencies first, then invokes the loader with the exact
commit and numeric package version using `--stage-only`. The loader returns only
`PREVIOUS_PROJECTION_RELEASE_NAME` and `STAGED_PROJECTION_RELEASE_NAME`. The
generic renderer has already atomically switched the generic package `current`
at `/var/lib/intexuraos/secret-packages/prod/current` to the validated package
release. `--stage-only` does not change the independently managed runtime
projection `current` at `/var/lib/intexuraos/secret-projections/prod/current` or
any stable runtime file link. It then revalidates the candidate with
`--preflight`, including runtime-token issuance and a minimal Firestore request
through the candidate runtime key.

After preflight, the wrapper atomically runs `--activate <release-name>`. Alloy
is not restarted during staging or preflight because its systemd unit still
reads the previously active `.env.prod`. Immediately after successful
activation, the wrapper installs/reconfigures Alloy against the newly active
projection, restarts it, and requires `alloy.service` to be active. It then
renders a protected candidate PM2 configuration, reloads only `code-agent` with
`--only code-agent --update-env`, and waits for its direct-origin semantic
health. The checked-in verifier requires the `firestore` dependency check to be
healthy. Only then does the wrapper reload the complete PM2 fleet and run the
full backend, edge, and public health suite. No package payload or secret value
is printed.

Verify metadata without displaying content:

```bash
sudo stat -Lc '%U:%G %a %n' \
  /etc/intexuraos/.env.prod \
  /home/deploy/runtime-sa-key.json \
  /etc/intexuraos/internal-auth-token \
  /etc/letsencrypt/cloudflare.ini \
  /etc/intexuraos/tls-private-key.pem
```

Required results are the documented owners, `0600` for environment/key/token
files and `0640` for the nginx token. Run the package canary and direct-origin
smoke suite before PM2/nginx reload. Full candidate/promotion/rollback steps are
in [Secret Packages Operations](./secret-packages.md).

### Production Package Cutover

1. Record the currently active numeric PROD version and verify it can still be
   fetched and rendered as the rollback candidate.
2. Publish the complete replacement payload outside Terraform, fetch the
   returned numeric version, validate CRC32C and exact membership, and require
   the legacy comparison to show only approved differences.
3. On the VM, fetch the candidate with the provisioner into private staging.
   Confirm the provisioner can access PROD only and the runtime SA cannot
   access Secret Manager.
4. Stage all projections. Validate the runtime credential's account/project/key
   ID and token issuance without printing JSON. Validate TLS/Cloudflare formats,
   nginx token presence, `.env.prod` allowlists, owners, and modes.
5. Run candidate credential token issuance and minimal Firestore preflight
   without changing the active projection.
6. Atomically activate the complete projection. Reconfigure/restart Alloy from
   the now-active `.env.prod` and require `alloy.service` to be active. Reload
   only `code-agent` with the candidate environment and require semantic health
   including Firestore. Then reload the complete PM2 fleet/nginx, run the
   remaining smoke suite, and publish evidence containing only commit and
   numeric package version.
7. Observe audit/application logs. Do not disable/destroy the prior package
   version or old runtime SA key until the approved observation and rollback
   gates pass.

Before activation, any failure leaves the runtime projection `current` and
every stable runtime link unchanged; the generic package `current` may already
identify the validated candidate and is not consumed directly by PM2/nginx.
After activation, the deploy EXIT trap runs `--rollback` for the recorded prior
immutable projection and restores all stable links through the runtime
projection `current`. Only after that rollback succeeds, it reloads Alloy
against the restored `.env.prod` by using the previous immutable code release,
reloads the previous PM2 code release (including a partially switched
`code-agent`), and requires the full backend and runtime health suites. A failed
projection rollback or Alloy reload fails compensation, is a deployment
incident, and must not be reported as success. Never copy individual members
between versions.

### Runtime Service-Account Rotation

Create the replacement key outside Terraform, package it into a complete new
PROD version, and use the provisioner to render it mode `0600`. Canary minimal
Firestore/GCS/Pub/Sub/Firebase Auth operations, then reload the fleet. Disable
the old key, monitor by key ID, and delete only after the soak period. The
provisioner remains separate and the runtime SA never receives package access.
If a key is exposed, rotation/revocation precedes any optional Git-history
cleanup.

### Break Glass And Recovery

Emergency access requires incident approval and a time-bounded resource-level
accessor grant to PROD only. Numeric pinning, CRC, schema validation,
redaction, staging, and atomic promotion still apply. Remove the grant and
review Data Access logs immediately after recovery. If the VM is rebuilt,
recover the external provisioner first, then fetch the approved exact package;
the package cannot recover its own bootstrap identity.

## Deploy Or Reload Runtime

```bash
cd /opt/intexuraos
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

`deploy-web.sh` builds `apps/web` with `/api/*` service URLs, stages the complete bundle in
`/var/www/intexuraos/web/releases/<commit-sha>`, and atomically switches
`/var/www/intexuraos/web/current` only after the release is ready. It clears inherited
`INTEXURAOS_*` variables and temporarily replaces `apps/web/.env*` files with
a sanitized ephemeral `.env.production.local` containing only the package
version's browser-safe Firebase member, web-safe Auth0/Sentry values, and
generated public API paths. It is removed after the build, and backend package
members can never enter Vite.
`reload-pm2.sh` renders the CommonJS ecosystem config to a private JSON file
before starting PM2, because PM2 treats `ecosystem.config.prod.cjs` as a plain
script on the Hetzner host. It derives every local `/health` URL and expected
service name from the rendered app configuration, then requires three consecutive
all-service semantic-health passes before `pm2 save`.
`PM2_HEALTH_URLS` remains an explicit override for controlled diagnostics; each
space-delimited entry must use `service-name|http://127.0.0.1:PORT/health`.
Normal deployments must leave it unset.

For an approved recovery, inspect only the active release name with:

```bash
sudo INTEXURAOS_ENVIRONMENT=prod \
  bash scripts/hetzner/load-secrets.sh --current-release
```

Use `--rollback <recorded-release-name>` only as part of the documented
compensation flow, followed immediately by reloading the previous code release
and Alloy against the restored `.env.prod`, then running the complete health
suite.

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

For automated certbot DNS-01 issuance, rotate the dedicated token in the PROD
package's `cloudflareDnsApiTokenBase64` member, publish a complete numeric
candidate, and render `/etc/letsencrypt/cloudflare.ini` as mode `0600`. Do not
create or read an individual Cloudflare secret. The Browser Rendering token
must not be reused.

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
terraform -chdir=terraform/environments/dev plan \
  -var='enable_load_balancer=false'

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
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
terraform -chdir=terraform/hetzner-prod plan \
  -replace=hcloud_server.prod \
  -out=/tmp/hetzner-prod-recreate-final.tfplan

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
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
terraform -chdir=terraform/hetzner-prod plan \
  -var='activate_hetzner_async_consumers=false'

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
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
terraform -chdir=terraform/hetzner-prod apply \
  -var='enable_retired_async_consumer_cleanup=true'
```

After the cleanup apply succeeds, return to the committed default so later
plain applies do not keep a cleanup marker in state:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
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
The SPA itself is served through `/var/www/intexuraos/web/current`; the pointer resolves to one
immutable `/var/www/intexuraos/web/releases/<commit-sha>` directory.
