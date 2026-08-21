# Hetzner Production Runbook

Production deployment is manual-only, exact-SHA, and fix-forward. Downtime is
accepted. There is no release rollback, secret projection rollback, package
history, automatic deploy, or compatibility path.

## Fixed Runtime

- Host: `162.55.210.48`
- User: `deploy`
- Application: `/opt/intexuraos/current`
- Code releases: `/opt/intexuraos/releases/<40-char-sha>`
- Static web: `/var/www/intexuraos/web/current`
- Runtime env: `/etc/intexuraos/.env.prod`, mode `0600`, owner `deploy:deploy`
- Internal auth token: `/etc/intexuraos/internal-auth-token`, mode `0640`,
  owner `root:www-data`
- Runtime service-account JSON: `/home/deploy/runtime-sa-key.json`, mode `0600`
- Package metadata: `/etc/intexuraos/secret-package-metadata.json`, mode `0600`

The protected repository variable `PROD_SECRET_PACKAGE_VERSION` is the only
package pin. It must be a positive numeric version. There is no manual version
input, GitHub environment override, `latest`, or local package pointer.

## Pre-Deploy

1. Require a clean reviewed commit on `development`.
2. Require `.github/workflows/deploy.yml` to be enabled but manual-only.
3. Require zero queued/running Deploy workflows.
4. Freeze the 40-character `development` SHA and verify it again immediately
   before dispatch.
5. Verify that `PROD_SECRET_PACKAGE_VERSION` equals the newly published exact
   PROD version.
6. Verify the Hetzner host is reachable and the provisioner credential exists.
7. Stop if any secret value appears in command output, CI logs, or evidence.

## Dispatch

Dispatch `deploy.yml` against `development`. Immediately identify the new run
and require its `headSha` to equal the frozen SHA. A mismatch fails closed.

The deployment script:

1. verifies the clean exact-SHA checkout;
2. creates an immutable code release and installs dependencies;
3. stops and deletes PM2 applications and stops Alloy;
4. runs the one-shot exact-version package loader;
5. builds and installs the static web;
6. starts PM2, Alloy, and nginx;
7. writes `/deployment.json` with commit SHA, workflow run, deployment time,
   and package version;
8. verifies local and public health;
9. destroys older code and web releases.

Any failure leaves the affected service stopped. Fix the cause in a new
reviewed commit or complete the failed operation on the same exact release;
never select an old release or package version.

## One-Shot Secret Projection

The loader may run only while PM2 and Alloy are stopped:

```bash
sudo -n INTEXURAOS_ENVIRONMENT=prod \
  bash scripts/hetzner/load-secrets.sh --version <numeric-version>
```

It validates the complete PROD package, provider credentials, file modes,
owners, Firebase key presence, runtime service-account identity, TLS key, and
Cloudflare DNS token before publishing stable files. It then removes its
private render root and all old local projections. It has no `--activate`,
`--rollback`, partial-secret, current-release, or previous-release mode.

## Required Verification

After deployment require all of the following:

- public and direct `/deployment.json` are byte-identical and attest the frozen
  SHA, workflow run, and numeric package version;
- all PM2 applications are online on that SHA with zero unexpected restart;
- nginx and Alloy are active; Alloy ready and healthy endpoints return `200`;
- every direct service health endpoint returns `200`;
- public root and user, settings, WhatsApp, Intex, code, and message-digest
  health routes return `200`;
- Auth0 login, Firebase auth/Firestore, Google/GitHub OAuth, WhatsApp, Matrix,
  transcription, OpenRouter, and browser flows pass;
- `.env.prod` contains exact PROD config/package membership and no deleted name;
- old provider credentials reject use and old package versions are absent;
- static artifacts contain only the public allowlist and no secret-policy name;
- Secret Manager audit shows the provisioner read only the exact PROD package.

## Operational Commands

```bash
ssh deploy@162.55.210.48
pm2 list
pm2 logs --lines 200
sudo systemctl status nginx alloy
curl --fail --silent http://127.0.0.1:<port>/health
curl --fail --silent https://intexuraos.cloud/deployment.json
```

For a manually admitted release, bind every process to the reviewed commit and use the checked-in
health-gated deploy helpers:

```bash
RELEASE_SHA='<40-character lowercase Git SHA deployed to /opt/intexuraos>'
INTEXURAOS_COMMIT_SHA="${RELEASE_SHA}" \
  PM2_HEALTH_CONSECUTIVE_SUCCESSES=3 \
  bash scripts/hetzner/reload-pm2.sh
COMMIT_SHA="${RELEASE_SHA}" bash scripts/hetzner/deploy-web.sh
```

The web helper stages `/var/www/intexuraos/web/releases/<commit-sha>` and atomically switches
`/var/www/intexuraos/web/current`. PM2 logs are bounded by the validated
`/etc/logrotate.d/intexuraos-pm2` configuration; readiness requires three consecutive semantic
health successes.

Cloud Build evidence must resolve the admitted commit through either
`sourceProvenance.resolvedGitSource.revision` or
`sourceProvenance.resolvedRepoSource.commitSha`. The public `GET /deployment.json` must then expose
the same SHA and `workflowRunId`; `/api/whatsapp/health` is part of the public smoke set.

The existing private WhatsApp OIDC routes remain unchanged and must be tested only with the
authorized service account:

- `POST https://intexuraos.cloud/internal/whatsapp/private/events`
- `POST https://intexuraos.cloud/internal/whatsapp/private/media`
- `POST https://intexuraos.cloud/internal/whatsapp/private/media/backfill`

The unrelated data-repair procedure remains documented in
[`code-task-lifecycle-backfill.md`](./code-task-lifecycle-backfill.md). It is not a release or
secret rollback and must not be run as part of this cutover.

When retained async consumers need their existing maintenance operation, keep the explicit
single-root sequence; this is not a secret-package compatibility mode:

```bash
# Set activate_hetzner_async_consumers=false, apply and verify the drained state.
terraform -chdir=terraform/hetzner-prod apply
# Set activate_hetzner_async_consumers=true, apply and verify the active consumers.
terraform -chdir=terraform/hetzner-prod apply
```

Do not print `/etc/intexuraos/.env.prod`, package payloads, token files, service
account JSON, TLS material, or private logs containing request credentials.

## Failure Handling

- Before service stop: fix forward without changing the live runtime.
- After service stop: keep the affected service stopped until the candidate is
  valid, then resume the same exact-SHA deployment.
- After partial file publication: rerun the complete one-shot loader with the
  same reviewed numeric version; never repair one field manually.
- After code admission: create a new reviewed fix commit and deploy it forward.
- Never restore an old package, key, release, projection, Terraform state, or
  public Vite server.

## Endpoint Changes

- Modified: `GET /deployment.json` includes `secretPackageVersion`.
- Created: none.
- Removed: none.
- Unchanged: all application API contracts.
