# Runtime Environments

IntexuraOS has production on Hetzner and a manually started localhost stack.
Home Dev retains the production-serving orchestrator, code workers, Matrix,
SentryBox, other applications, monitoring, and developer tools. It does not host
an application DEV deployment or public application DEV hostname.

## Localhost

Render the existing local/worker secret package with `scripts/sync-secrets.sh`,
allow the rendered environment with `direnv allow`, and run `pnpm dev`.
`pnpm services:*`, PM2, and local Compose operate directly, without host mode
records or start guards. Stop local services and emulators when finished.

Most services retain their existing shared GCP Firestore and Storage connections.
Pub/Sub runs locally on port 8102. Message Digest alone uses its isolated project
`intexuraos-message-digest-mvp-local` and persistent local Firestore on
`127.0.0.1:8101`. Preserve its volume/export when recreating the emulator.
Tests use fixtures and do not send actual messages.

Runtime configuration uses `config/environments/local.json`. The secret package
continues to use the historical `dev` name, format, numeric versions, and IAM.
The `development` branch, GCP project `intexuraos-dev-pbuchman`, and physical
shared resource names are unchanged. Shared Terraform lives in
`terraform/shared-gcp`; its backend and resource addresses are unchanged.

## Production and workers

Production deployment uses exact reviewed artifacts and numeric secret versions.
The Home Dev orchestrator uses production callbacks and a strict worker secret
projection. Its host-owned restart helper freezes admission and checks active
work and pending callbacks. Keep `/home/pbuchman/deploy/intexuraos`, which the
orchestrator uses.

The `pbuchman-dev` repository owns the shared Caddy configuration and the static
`machine-setup/config/matrix-outbound.caddy` production fragment. Its CI runs
real Caddy routing tests. IntexuraOS CI does not need Docker to validate an
application edge it no longer owns.

## Retirement order

Before installing the final host Caddy configuration, remove only the obsolete
DEV ingress, DNS, and Access entries through the authoritative Cloudflare
Terraform state. Preserve the shared tunnel, production Matrix Service Auth,
and all other routes. Until publication is removed, retain the existing DEV
hostname deny rule so the hostname cannot reach shared fallback routes.
Then remove the exact disabled hosted-DEV units, autostart, log routes, and
executable mode-control files. Preserve inactive data, archival logs, volumes,
secrets, secret versions, and Git history.
