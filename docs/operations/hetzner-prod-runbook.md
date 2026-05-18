# Hetzner Production Runtime Runbook

Linear: INT-1634

This runbook covers the Hetzner host runtime owned by `scripts/hetzner/**` and
`ecosystem.config.prod.cjs`. GCP remains the system of record for Firestore,
Pub/Sub, Secret Manager, retained buckets, Cloud Functions, Artifact Registry,
and the shared project `intexuraos-dev-pbuchman`.

## Runtime Layout

| Path | Purpose |
| --- | --- |
| `/opt/intexuraos` | Repo checkout run by PM2 |
| `/etc/intexuraos/.env.prod` | `deploy:deploy` mode-600 environment material generated from GCP Secret Manager |
| `/etc/intexuraos/internal-auth-token` | `root:www-data` mode-640 internal auth token injected by nginx after Google OIDC verification |
| `/var/www/intexuraos/web/dist` | Static Vite bundle served by nginx |
| `/etc/nginx/sites-available/intexuraos.conf` | Installed nginx site config |
| `/etc/nginx/lua/jwt-verify.lua` | Google OIDC verifier for `/internal/*` |

## Provisioning

Run on the VM as root:

```bash
cd /opt/intexuraos
INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/provision.sh --email ops@example.com
```

Provisioning installs Node 22, PM2, Google Cloud CLI, nginx with Lua support,
certbot with the Cloudflare DNS plugin, loads secrets, installs certificates,
and deploys the nginx config.

Certbot uses `INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN`, a dedicated Cloudflare
token with Zone DNS Edit permission for the `intexuraos.cloud` zone. Do not
reuse the Browser Rendering token stored in `INTEXURAOS_CLOUDFLARE_API_TOKEN`.
Terraform creates this DNS-token secret separately from the app-secret
inventory and grants Secret Manager Secret Accessor to the
`intexuraos-hetzner-provisioner-dev` service account. Use that service account
key for `/home/deploy/sa-key.json` on the VM.

## Secret Refresh

The VM needs a readable service account key at `/home/deploy/sa-key.json` or
`GOOGLE_APPLICATION_CREDENTIALS` pointing at an equivalent key file.

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
sudo -iu deploy bash -lc 'cd /opt/intexuraos && pnpm install --frozen-lockfile'
sudo -iu deploy bash -lc 'cd /opt/intexuraos && INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-web.sh'
sudo -iu deploy bash -lc 'cd /opt/intexuraos && INTEXURAOS_ENVIRONMENT=prod pm2 reload ecosystem.config.prod.cjs --update-env && pm2 save'
sudo INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh
```

`deploy-web.sh` builds `apps/web` with `/api/*` service URLs and publishes
`apps/web/dist` to `/var/www/intexuraos/web/dist`. It clears inherited
`INTEXURAOS_*` variables, exports only web-safe Auth0/Firebase/Sentry values,
and temporarily replaces `apps/web/.env*` files with a sanitized production
env file so ignored local env files cannot leak backend secrets into Vite.
`deploy-nginx.sh` runs `nginx -t` before reload. If the VM is not available,
validate an equivalent generated config in a container or staging VM that has
nginx Lua/OpenResty modules installed, then record the command output in the
cutover notes.

## Async Edge Cutover

The retained GCP Pub/Sub push subscriptions and Cloud Scheduler jobs are
Terraform-backed through `var.hetzner_edge_origin`. Before DNS cutover, review
the plan that changes their endpoints and OIDC audiences to the nginx edge:

```bash
cd terraform/environments/dev
terraform plan -var='hetzner_edge_origin=https://intexuraos.cloud'
```

After the Hetzner nginx `/internal/*` routes pass smoke tests, apply that
Terraform plan:

```bash
cd terraform/environments/dev
terraform apply -var='hetzner_edge_origin=https://intexuraos.cloud'
```

This moves Pub/Sub push endpoints and Cloud Scheduler HTTP job URIs to
`https://intexuraos.cloud/internal/*` and changes all OIDC audiences to
`https://intexuraos.cloud`, matching `jwt-verify.lua`. The
`scripts/hetzner/cutover-gcp-edge.sh` helper prints the equivalent `gcloud`
updates for audit or emergency use, but Terraform is the source of truth.

## Pre-Cutover Smoke Test

Before changing DNS, every PM2 process must respond on localhost:

```bash
for port in \
  8110 8112 8113 8114 8116 8117 8118 8119 8120 8121 8122 \
  8123 8124 8125 8126 8127 8128 8129 8130 8131 8132 8133
do
  curl --fail --silent --show-error "http://127.0.0.1:${port}/health" >/dev/null
done

curl --fail --silent --show-error http://127.0.0.1/healthz
sudo nginx -t
pm2 status
```

After DNS resolves to the Hetzner IP, verify public routing:

```bash
curl --fail https://intexuraos.cloud/healthz
curl --fail https://intexuraos.cloud/api/user/health
curl --fail https://intexuraos.cloud/api/settings/health
```

## Internal Edge Auth

GCP Pub/Sub and Cloud Scheduler requests must use OIDC audience
`https://intexuraos.cloud`. nginx verifies the Google-issued bearer token in
`jwt-verify.lua`, strips the public `Authorization` header, clears any
client-supplied `X-Internal-Auth` or `From`, and injects the trusted token
from `/etc/intexuraos/internal-auth-token` before proxying to the app service.
The verifier only accepts tokens whose signed `email` claim is one of the
expected retained-GCP Pub/Sub push service accounts or the Cloud Scheduler
service account.

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
