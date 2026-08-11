# Runtime Configuration And Secret Manager Policy

This is the operational source of truth for deciding whether an IntexuraOS
runtime value belongs in Git or in GCP Secret Manager.

## Non-Negotiable Rule

Secret Manager contains only values that are not allowed in repository-backed
runtime configuration: passwords, bearer/API tokens, OAuth client secrets,
private keys, HMAC material, and encryption keys.

Public identifiers, public URLs, OAuth client IDs, DSNs, public verification
keys, and the Firebase browser API key belong in the versioned files under
`config/environments/`. Private operational identifiers and bindings remain in
Secret Manager when disclosure would reveal internal topology or authorization
context. The exact allowlist in `policy.json` is authoritative; never duplicate
a versioned config value in a new Secret Manager version.

The machine-readable classification is
`config/environments/policy.json`. It is enforced by
`scripts/render-runtime-config.mjs`, `scripts/sync-secrets.sh`, and
`scripts/hetzner/load-secrets.sh`.

## Versioned Configuration

| File | Scope |
| --- | --- |
| `config/environments/common.json` | Shared dev and production values |
| `config/environments/dev.json` | Dev-only values, including the loopback Matrix adapter URL |
| `config/environments/prod.json` | Production-only values, including the externally reachable Matrix adapter URL |
| `config/environments/policy.json` | Exact names, scopes, and migration rollback policy |

Render and validate without exposing any Secret Manager value:

```bash
node scripts/render-runtime-config.mjs --environment dev --format shell-export >/dev/null
node scripts/render-runtime-config.mjs --environment prod --format dotenv >/dev/null
```

The migration keeps 26 old Secret Manager containers temporarily for rollback:
25 values now rendered from versioned configuration plus the removed
`INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI`. Runtime loaders must not access any of
those 26 containers. The redirect URI is derived by the application and is not
written to generated environment files.

## Development Workflow

1. Classify every new runtime value before writing code:
   - secret material goes to Secret Manager and Terraform/IAM;
   - non-secret configuration goes to `common.json`, `dev.json`, or `prod.json`
     and the matching scope in `policy.json`.
2. Update and review the versioned configuration in the same PR as the code
   that consumes it. Never put secret material in the repository, examples,
   fixtures, screenshots, logs, or PR descriptions.
3. Validate both render targets using the commands above.
4. Refresh the local runtime:

   ```bash
   ./scripts/sync-secrets.sh --project-id intexuraos-dev-pbuchman
   direnv allow
   pnpm run services:restart
   ```

   `sync-secrets.sh` atomically creates `.envrc` with mode `0600`. It renders
   tracked config, fetches only real secrets, and sources `.envrc.local` last so
   developer-local overrides remain authoritative. Neither `.envrc` nor
   `.envrc.local` may be committed.
5. If the home-dev orchestrator uses the changed value, generate its dedicated
   strict environment instead of copying all `INTEXURAOS_*` variables:

   ```bash
   direnv exec . node scripts/generate-orchestrator-env.mjs \
     --output "$HOME/.code-orchestrator/env"
   sudo systemctl restart intexuraos-orchestrator@pbuchman
   curl -fsS http://localhost:8199/health | jq .
   ```

   The generator writes atomically with mode `0600`, supplies host defaults,
   validates required names, and discards variables outside the explicit
   orchestrator allowlist.

Use `./scripts/sync-secrets.sh --add-new` only to populate a missing version of
a value classified as an actual secret. It must never be used to re-create one
of the migrated configuration values.

## Hetzner Production

`scripts/hetzner/load-secrets.sh` renders the production configuration and
fetches only the explicit remaining-secret allowlist. It atomically prepares
the merged material and installs `/etc/intexuraos/.env.prod` as
`deploy:deploy`, mode `0600`. PM2 and the web build consume that merged file;
they do not care which values originated in Git or Secret Manager.

Alloy follows the same boundary:

- `INTEXURAOS_GRAFANA_CLOUD_LOKI_URL` and
  `INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME` come from versioned configuration;
- only `INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN` is read from Secret Manager.

After changing runtime configuration, use the normal deployment workflow and
run the semantic health checks in the
[Hetzner production runbook](./hetzner-prod-runbook.md). Do not edit
`.env.prod` manually.

## Safe Verification

- Inspect names and classifications, never rendered values in logs.
- Check generated file permissions with `stat`; do not print the files.
- Compare expected values to process environments only as `MATCH` or
  `MISMATCH`.
- Secret Manager audit checks may output timestamp, principal, and secret name,
  but never payload data.
- Before removing rollback containers, verify zero `AccessSecretVersion`
  events for all 26 migration names after dev sync, production deployment,
  orchestrator restart, Alloy restart, and the transcription cold start.
