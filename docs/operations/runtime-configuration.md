# Runtime Configuration And Secret Package Policy

This is the classification source of truth for deciding whether an IntexuraOS
runtime value belongs in Git, an atomic Secret Manager package, or one of the
two native Secret Manager exceptions. Package publication and rotation are
covered by [Secret Packages Operations](./secret-packages.md).

## Classification Rule

Versioned files under `config/environments/` contain only reviewable,
non-sensitive configuration: public URLs and identifiers, OAuth client IDs,
project names, public verification material, feature flags, routing, and
service topology that is approved for repository disclosure.

Values that grant access, signing, impersonation, decryption, or privileged API
use belong in exactly one environment package:

- `INTEXURAOS_SECRET_PACKAGE_DEV` for local and home-dev;
- `INTEXURAOS_SECRET_PACKAGE_PROD` for Hetzner production.

The only native individual application secrets are
`INTEXURAOS_INTERNAL_AUTH_TOKEN` and
`INTEXURAOS_SPEECHMATICS_APP_API_KEY`, retained because the Gen2 transcription
function requires native Secret Manager injection. They are also package
members wherever non-Gen2 runtimes need them: internal auth is in DEV and PROD,
while Speechmatics is in DEV only. The Google-managed Cloud Build
connection token is outside application ownership.

`INTEXURAOS_FIREBASE_API_KEY` is a special case: Firebase browser keys are
public identifiers, not authorization boundaries, but this key is deliberately
removed from tracked config and included as a build-time member of both
packages. That enables coordinated rotation and closes repository exposure
alerts; the built SPA still exposes it by design. Protect Firebase with API-key
restrictions, Security Rules, quotas, Auth, and App Check.

Never duplicate a package member in tracked config or create another
individual application secret for it.

## Machine-Readable Sources

| File | Purpose |
| --- | --- |
| `config/environments/common.json` | Shared non-secret values |
| `config/environments/dev.json` | DEV-only non-secret values |
| `config/environments/prod.json` | PROD-only non-secret values |
| `config/environments/policy.json` | Classification, scope, and retired-name policy |
| `config/environments/secret-packages.json` | Package IDs, exact env/file members, native exceptions, and promoted numeric versions |

The package manifest is non-secret. A payload is secret and must never be
tracked. Its `env` and `files` keys must match the selected manifest package
exactly; unknown and missing members fail validation.

Validate the repository-backed portion without fetching secrets:

```bash
node scripts/render-runtime-config.mjs --environment dev --format shell-export >/dev/null
node scripts/render-runtime-config.mjs --environment prod --format dotenv >/dev/null
pnpm run verify:secret-packages
```

Validation output must contain names/counts/results only.

## Consumer Model

| Consumer | Source | Allowed projection |
| --- | --- | --- |
| Local PM2/Vite | exact DEV numeric version plus versioned config | mode-`0600` `.envrc` and approved local files |
| home-dev PM2 | exact DEV numeric version plus versioned config | mode-`0600` `.envrc`, filtered per-service env |
| home-dev orchestrator | host-rendered DEV projection | strict env allowlist plus GitHub App PEM |
| code-worker | orchestrator projection | task-specific env/files only; no package or Secret Manager access |
| Grafana/Alloy | exact DEV numeric version | dedicated observability env projection |
| Hetzner services/web/nginx/TLS | exact PROD numeric version plus versioned config | target-specific files from the production renderer |
| Retained transcription | exact numeric native versions | the two native secret env injections only |

Runtime processes consume rendered projections. They do not fetch packages,
read individual legacy secrets, or receive Secret Manager IAM. The identity
that opens a package is separate from any credential inside that package.

## Adding Or Changing A Runtime Value

1. Classify the value before implementation.
2. For a non-secret, update the correct environment JSON and `policy.json` in
   the same pull request as its consumer.
3. For a secret, add its logical name to the correct DEV/PROD package member
   lists and every required projection. Do not add a new container.
4. If Gen2 transcription requires the value natively, obtain explicit review
   before changing `nativeSecretNames`; the exception list stays minimal.
5. Update validators, renderers, allowlists, tests, IAM if ownership changes,
   and the operational documentation in the same pull request.
6. Build and publish a complete new candidate package outside Terraform. Never
   commit or log the payload.
7. Validate, shadow-compare, render to staging, canary, and promote using an
   exact numeric version.

A missing member blocks the whole candidate. Per-field fallback, partial
promotion, `latest`, and mutable aliases are forbidden.

## Development Workflow

Refresh local or home-dev only from a reviewed DEV numeric version:

```bash
SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS="${HOME}/.config/intexuraos/secret-renderer-sa-key.json" \
  ./scripts/sync-secrets.sh --version <dev-numeric-version>
direnv allow
pnpm run services:restart
```

The loader validates CRC32C, schema, environment, exact membership, and file
shape, then stages one immutable projection containing the package files,
metadata, `.envrc`, and the GitHub App PEM. Every file is mode `0600`; the
release and projection root are mode `0700`. The projection root is reserved
for this four-file contract and must never be reused as the `--output-dir` of
generic `secret-package render`, whose separate private scratch root has a
three-file release contract. The projection promoter installs a durable root
marker. Projection sync and generic render share the same root-local writer
lock; a generic renderer that waits behind sync observes the marker and rejects
the projection before creating or switching any release. An empty lock directory
may also exist in a generic scratch root and does not classify that root. The stable `.envrc` and GitHub PEM
paths are symlinks through
`${HOME}/.config/intexuraos/secret-packages/dev/current`, so one atomic rename
of `current` activates the complete projection for every consumer.

The first run migrates existing regular `.envrc` and PEM outputs through a
content-identical compatibility projection before installing those stable
symlinks. An interruption before the final pointer switch therefore leaves the
complete previous projection visible; an interruption after it leaves the
complete candidate visible. A first installation stays fail-closed until the
pointer exists. Concurrent projection and generic-render writers use ordered,
unique claim directories under `.sync-lock`; claim identity includes hostname,
boot marker, PID, process start, and the owning writer entrypoint. After an
ungraceful interruption, the next writer
removes only the stopped owner's unrepeatable claim and matching work directory.
A reused PID or a live non-sync process cannot retain or impersonate that claim,
and no stale-owner recovery deletes a shared lock path. Recovery does not depend
on an `EXIT` trap; successful cleanup leaves the private lock directory empty.

`.envrc.local` is sourced last for host-only non-secret overrides and must not
contain shared secrets. Both files are ignored by Git.
Set `GOOGLE_APPLICATION_CREDENTIALS` in `.envrc.local` to
`${HOME}/.config/intexuraos/home-runtime-sa-key.json`. The dedicated
`ixos-home-runtime-dev` identity has only the local data-plane union and no
Secret Manager access; do not reuse the broad migration/operator credential.

If the home-dev orchestrator projection changes, regenerate it from the same
package version and restart only after validation:

```bash
direnv exec . node scripts/generate-orchestrator-env.mjs \
  --output "$HOME/.code-orchestrator/env"
sudo systemctl restart intexuraos-orchestrator@pbuchman
curl -fsS http://localhost:8199/health | jq .
```

The generator writes atomically with mode `0600` and drops everything outside
the orchestrator allowlist. A code worker receives a further task-specific
projection and must not receive the host package or broad GCP credential.
The generator fixes `GOOGLE_APPLICATION_CREDENTIALS` to
`${HOME}/.config/intexuraos/home-orchestrator-sa-key.json`, ignoring an
inherited value. That host-only `ixos-home-orchestrator-dev` identity has only
repository-level Artifact Registry reader access and is never mounted into a
worker.

Grafana/Alloy uses `scripts/observability/load-grafana-cloud-env.sh`. It reads
only `INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN` from
`${SECRET_PACKAGE_RENDER_DIR}/current/environment.env` (defaulting to the DEV
render root above), merges the tracked Loki URL/username, and atomically writes
the collector env as mode `0600`. It has no GCP/Secret Manager access.

On home-dev, sudo does not inherit the deployment user's `HOME`. Always pass
both paths explicitly when refreshing the systemd-owned projection:

```bash
sudo -n env \
  HOME=/home/pbuchman \
  SECRET_PACKAGE_RENDER_DIR=/home/pbuchman/.config/intexuraos/secret-packages/dev \
  INTEXURAOS_ENVIRONMENT=dev \
  bash scripts/observability/load-grafana-cloud-env.sh
```

Do not use the former `--add-new` per-secret workflow. Package versions are
constructed and published as complete validated candidates through
`scripts/secret-package.mjs`.

## Hetzner Production

The protected deployment supplies an exact PROD numeric version.
`scripts/hetzner/load-secrets.sh` fetches it with the external provisioner
identity, validates it, and stages all target projections before activation.
It then atomically installs:

- `/etc/intexuraos/.env.prod` as `deploy:deploy`, mode `0600`;
- `/home/deploy/runtime-sa-key.json` as the runtime user, mode `0600`;
- `/etc/intexuraos/internal-auth-token`, mode `0640`;
- the approved Cloudflare/TLS files, mode `0600`.

The production web build receives only its build-time allowlist in an
ephemeral file. Backend secrets must never reach Vite. PM2/nginx reload only
after all candidate outputs pass validation. See the
[Hetzner production runbook](./hetzner-prod-runbook.md).

## Ownership, Publication, And IAM

Terraform owns containers and IAM but not values or package versions. Publish
payloads outside Terraform through stdin or a mode-`0600` ephemeral file that
is removed immediately. Grant resource-level access to one package:

- publishers may add a version to their approved package;
- DEV renderers may access only the DEV package;
- the Hetzner provisioner and protected deploy identity may access only PROD;
- runtime service accounts, the orchestrator, and code workers have no Secret
  Manager access;
- transcription can access only the two native secrets at pinned versions.

Use WIF/OIDC or service-account impersonation for automation and operators
where possible. A long-lived bootstrap key remains outside both packages and
must be separately protected and rotated.

## Rotation And Rollback

Every rotation creates a complete immutable candidate. Fetch and deploy it by
numeric version, retain the previously verified numeric version for rollback,
and switch the whole package together. Never roll back an exposed Firebase key
or compromised service-account key; instead publish a new complete package
with replacement credentials.

For the runtime service-account JSON, create replacement, publish, canary,
disable the old key, monitor, then delete. For the browser key, create and
restrict replacement, publish to both packages, deploy and verify DEV then
PROD, delete the old key, then close the repository alert as revoked.

## Safe Verification And Evidence

- Inspect names, member counts, numeric versions, byte counts, permissions,
  owners, and CRC/validation status; never inspect values in logs.
- Compare sources using ephemeral HMAC and report only package-level
  `MATCH`/`MISMATCH`.
- Check generated file permissions with `stat`; never print the file.
- Enable Secret Manager Data Access audit logging and review
  `AccessSecretVersion` by timestamp, principal, package ID, and numeric
  version.
- Never include a package payload, base64, private key, rendered environment,
  token, or reversible digest in evidence.

The historical individual-secret cleanup record is
[Runtime Secret Manager Cleanup](./runtime-secret-manager-cleanup.md). It is not
a current deployment procedure and must not be replayed.
