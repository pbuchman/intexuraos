# Environments

## Overview

| Environment | Domain               | Infra                                        | Machine                | Deploy Target                              |
| ----------- | -------------------- | -------------------------------------------- | ---------------------- | ------------------------------------------ |
| **local**   | `localhost`          | PM2 watch + Vite + per-host Pub/Sub emulator | mac-dev/developer host | current checkout                           |
| **dev**     | dev.intexuraos.cloud | PM2 + per-host Pub/Sub emulator              | home-dev               | `~/deploy/intexuraos`                      |
| **prod**    | intexuraos.cloud     | Hetzner PM2/nginx + retained GCP data plane  | Hetzner                | GitHub Actions deploy to `/opt/intexuraos` |

**Single retained GCP project.** Local, dev, and prod use the SAME retained GCP project `intexuraos-dev-pbuchman` for Firestore, Cloud Storage, Secret Manager, and Auth0 configuration. The `-dev-pbuchman` suffix is legacy; there is no separate prod GCP project. The environment distinction is about runtime target and routing, not project ownership.

**Local follows the same data/async pattern as dev.** Local and dev both use real retained GCP Firestore/Storage/Auth0, versioned runtime configuration, and actual secrets from Secret Manager. Both use a per-host Pub/Sub emulator on `localhost:8102`. The difference is process location: local runs the current checkout on the developer host; dev runs the deployed checkout on `home-dev`.

**Firestore is SHARED across local, dev, and prod.** Same database, same collections. Treat local data writes as writes to the shared retained project.

**Budget background Firestore scans across every enabled runtime.** Pollers in local, dev, and prod consume the same retained project quota. Any new or changed scanner must avoid unbounded repeated reads, calculate its aggregate daily read floor across all enabled runtimes, and keep a test that enforces the intended budget.

## Environment Detection Signals

| Signal                           | local                                             | dev                                       | prod                                |
| -------------------------------- | ------------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| URL (public)                     | `http://localhost:3000` or `http://localhost:*`   | `https://dev.intexuraos.cloud`            | `https://intexuraos.cloud`          |
| URL (internal)                   | `http://localhost:81xx` on current developer host | `localhost:*` service URLs on home-dev    | `127.0.0.1:*` on the Hetzner VM     |
| User says                        | "local", "localhost", "pnpm run dev"              | "dev", "dev environment"                  | "prod", "production", "cloud"       |
| `uname -n`                       | developer machine hostname, often Darwin/mac-dev  | `home-dev`                                | Hetzner VM hostname                 |
| Logs via                         | local `pnpm exec pm2 logs <name>`                 | `pm2 logs <name>` on home-dev             | SSH to Hetzner, then PM2/nginx logs |
| `INTEXURAOS_ENVIRONMENT` env var | currently `dev` for service compatibility         | `dev`                                     | `prod`                              |
| Pub/Sub                          | own Docker emulator `localhost:8102`              | own emulator on home-dev `localhost:8102` | Hetzner-targeted async plane        |

Do not classify an issue from `localhost` alone. First identify the machine and context: local developer checkout, home-dev internal service URL, or Hetzner internal URL.

## SentryBox Routing

Error routing uses Sentry-compatible DSNs served by the private SentryBox instance on home-dev.
Runtime labels remain `dev` and `prod`; local currently runs with the dev service label for
compatibility. Project, release, and environment tags provide the retained filtering dimensions.

| Runtime                | SentryBox backend project | SentryBox web project | `INTEXURAOS_ENVIRONMENT` |
| ---------------------- | ------------------------- | --------------------- | ------------------------ |
| local                  | `intexuraos-backend`      | `intexuraos-web`      | `dev`                    |
| dev                    | `intexuraos-backend`      | `intexuraos-web`      | `dev`                    |
| retained transcription | `intexuraos-backend`      | n/a                   | `dev`                    |
| prod                   | `intexuraos-backend`      | `intexuraos-web`      | `prod`                   |

Home-dev PM2 must force `INTEXURAOS_ENVIRONMENT=dev` even if the shell exports older values such as `development`. The home-dev orchestrator systemd env file at `~/.code-orchestrator/env` must also set `INTEXURAOS_ENVIRONMENT=dev`, `INTEXURAOS_RUNTIME=dev`, and the private `.ts.net:8443` `INTEXURAOS_ERROR_HUB_HOST`. Production receives the SentryBox DSNs from versioned runtime configuration via `scripts/hetzner/load-secrets.sh`; the web DSN is baked into the static bundle by `scripts/hetzner/deploy-web.sh`.

The retained transcription Cloud Function receives its runtime `INTEXURAOS_SENTRY_DSN` as a plain environment variable from `config/environments/dev.json`.

## Runtime Configuration And Secret Packages

**Classification sources of truth:** `config/environments/policy.json`,
`config/environments/secret-packages.json`, and
[the runtime configuration policy](../../docs/operations/runtime-configuration.md).

Repository-backed environment files contain reviewable non-secret settings.
Privileged runtime values are consolidated into two atomic Secret Manager
packages: `INTEXURAOS_SECRET_PACKAGE_DEV` and
`INTEXURAOS_SECRET_PACKAGE_PROD`. Each consumer uses an exact positive numeric
version; `latest`, aliases, per-field fallback, and direct reads of legacy
individual secrets are forbidden.

The only native individual application secrets are
`INTEXURAOS_INTERNAL_AUTH_TOKEN` and
`INTEXURAOS_SPEECHMATICS_APP_API_KEY`, retained for the transcription function.
Internal auth is also a member of DEV and PROD; Speechmatics is also a DEV
member but is not needed in PROD.
`INTEXURAOS_FIREBASE_API_KEY` is a build-time member of both packages. It remains
public in the compiled SPA, but is not tracked so it can be rotated coherently.

| Environment | Runtime loading                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| local       | exact DEV version plus versioned config, rendered under `${HOME}/.config/intexuraos/secret-packages/dev/current` and projected to mode-`0600` `.envrc`/approved files |
| dev         | the same pinned four-file DEV projection root on home-dev; PM2, observability, and orchestrator receive separate allowlisted projections                              |
| prod        | exact PROD version fetched by the external Hetzner provisioner, validated and atomically projected to `/etc/intexuraos/.env.prod` and protected files                 |

Renderers may access only their environment package. Runtime services,
orchestrator processes, and code workers do not receive Secret Manager access.
The provisioner/bootstrap credential always remains outside the package it
opens. See [Secret Packages Operations](../../docs/operations/secret-packages.md)
for one-shot publication, rendering, rotation, and verification.

Local and dev PM2 services must not inherit `FIRESTORE_EMULATOR_HOST` or `STORAGE_EMULATOR_HOST`; they must use real retained GCP Firestore/Storage. Local and dev PM2 services must set `PUBSUB_EMULATOR_HOST=localhost:8102` against their own host-local Pub/Sub emulator.

Automated login credentials live outside the repo in `~/.intexuraos/logins.md` with mode `0600`. The file must contain at least two Auth0 username/password accounts using `kontakt+...@pbuchman.com`. The same Auth0 tenant/client configuration is shared by local, dev, and prod, so these credentials are intended to work across all three application environments. Local browser login tests must use `http://localhost:3000/#/login`; `127.0.0.1` is not a configured SPA callback URL. Never commit or paste the passwords.

## Local Environment

Use local when the goal is edit-run-verify feedback on the current checkout. It is dev running on the current machine: same shared GCP resources, same Auth0, same Pub/Sub-emulator alias pattern, different process location.

| Component             | Manager | Commands                                                                                                                                 |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Secret sync           | direnv  | `SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS=<renderer-key> ./scripts/sync-secrets.sh --version <dev-numeric-version> && direnv allow` |
| Pub/Sub emulator + UI | Docker  | `node scripts/dev-setup.mjs`                                                                                                             |
| Apps (services + web) | PM2     | `pnpm run dev` or `pnpm run services:start`                                                                                              |
| Logs                  | PM2     | `pnpm exec pm2 logs <name>`                                                                                                              |
| Status                | PM2     | `pnpm exec pm2 status`                                                                                                                   |

`pnpm run dev` is the simple path: it runs `scripts/dev-setup.mjs`, starts PM2 from `ecosystem.config.cjs` with `--update-env`, and tails logs. Services run through `tsx` from `src/` and PM2 watches source files for automatic reload. The web app runs through Vite on port `3000`.

Local/home-dev PM2 uses the external
`${HOME}/.config/intexuraos/home-runtime-sa-key.json`; home-dev orchestrator uses
the separate generator-fixed
`${HOME}/.config/intexuraos/home-orchestrator-sa-key.json`. Neither belongs in a
package or worker, and neither identity has Secret Manager access.

If Docker Desktop config uses a GUI credential store, `scripts/dev-setup.mjs` creates a temporary Docker config for compose startup that removes `credsStore` while preserving CLI plugins. This avoids credential-helper hangs without modifying `~/.docker/config.json`.

## Dev Environment On home-dev

| Component                 | Manager | Commands                                                         |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| Apps (18 services + web)  | PM2     | `pm2 status`, `pm2 logs <name>`, `pm2 restart <name>`            |
| Orchestrator              | systemd | `sudo systemctl status/restart intexuraos-orchestrator@pbuchman` |
| Workers (cloud functions) | Direct  | `pnpm dev` (tsx watch) or `node dist/index.js`                   |

**Orchestrator is NOT in PM2.** Runs under systemd as `intexuraos-orchestrator@pbuchman`, executing compiled `dist/index.js`. Check with `systemctl status`, not `pm2 status`.

**Auto-deploy via webhook handler.** A GitHub webhook at `~/tools/webhook-handler/` receives push events to `development`, detects changed files, and restarts affected services. PM2 services restart via `pm2 restart`; the orchestrator rebuilds (`pnpm --filter orchestrator build`) then restarts via `systemctl restart`. PM2 file watching is disabled on home-dev.

**Pub/Sub on home-dev uses emulator aliases, not Terraform topic names.** PM2 services publish to `PUBSUB_EMULATOR_HOST=localhost:8102`, so `ecosystem.config.cjs` fallbacks MUST match the aliases configured in `tools/pubsub-ui/server.mjs` (for WhatsApp: `whatsapp-send-message`, `whatsapp-media-cleanup`, `whatsapp-webhook-process`, `whatsapp-transcription`, `commands-ingest`, `approval-reply`). Do NOT use Terraform-managed `intexuraos-*-dev` topic names as PM2 fallbacks on home-dev; those names exist in Cloud Run/GCP, not in the local emulator.

**Port reference:** See `ecosystem.config.cjs` for the full port map of all local/dev PM2 services.

## Development Machines

Code tasks are forwarded from both dev and prod to one of two development machines. Both machines serve as task workers:

| Machine      | OS     | `uname -n` | Role                                       | SSH Access               |
| ------------ | ------ | ---------- | ------------------------------------------ | ------------------------ |
| **mac-dev**  | Darwin | varies     | Code editing, commits, pushes, local stack | Can SSH to home-dev      |
| **home-dev** | Linux  | `home-dev` | Runs dev environment, auto-deploys on push | Has dev services running |

**Both use `~/deploy/intexuraos/` as project path when running the deployed checkout.** Local developer checkouts may also exist under `~/personal/`.

**Key differences between machines:**

- `home-dev`: Has auto-deploy webhook; pushing to `development` automatically updates and restarts services.
- `mac-dev`: Can run the local stack from the current checkout with `pnpm run dev`; there is no auto-hook from pushes.
- From `mac-dev` you can access both machines: `home-dev` is reachable via SSH; mac-dev services run locally.

**When investigating any issue: first determine which machine and environment you are on**, then use the appropriate access method. If you're on `mac-dev` and the issue is on `home-dev`, SSH there.

**home-dev configuration reference:** The repo at `~/personal/pbuchman-dev/` documents all configuration, services, and infrastructure on `home-dev`. It must be kept up to date with the real state of services/configs/infra for future recovery. Always consult it when investigating home-dev service issues.

**Code Task Investigation:** For any code task issue, FIRST check the Firestore `code_tasks` document for the task. The `workerLocation` field contains a user-configured string (e.g., `"mac-dev"`, `"office-pc"`) — read whatever value is stored; it is not a fixed hostname.

## Code Task Worker Location vs Environment Ownership

**Orchestrator is deployment-independent.** A code task may run on `home-dev`, `mac-dev`, or another worker machine for either dev or prod. `workerLocation` answers "which machine is executing this task"; it does NOT answer "which environment owns this task."

The owning environment is carried by the task callback URLs:

| Owner | Canonical callback base                 |
| ----- | --------------------------------------- |
| dev   | `https://dev.intexuraos.cloud/api/code` |
| prod  | `https://intexuraos.cloud/api/code`     |

For task logs, lifecycle events, turn metrics, status updates, and completion callbacks, orchestrator MUST use the task-provided `webhookUrl` to derive sibling callback URLs. It MUST NOT infer callback destination from hostname, `workerLocation`, or its own fallback `INTEXURAOS_CODE_AGENT_URL` when `webhookUrl` is present.

## Forbidden Assumptions

- "localhost means dev" — WRONG. Check whether it is the local checkout, home-dev internals, or Hetzner internals.
- "This is a prod issue" — verify first by checking URL, callback base, machine, and logs source.
- "Platform is darwin therefore home-dev" — WRONG. darwin = mac-dev/developer machine, home-dev is Linux.
- "I can't access that service" — on local and home-dev, you usually can through localhost.
- "We need to restart/deploy" — home-dev webhook auto-deploys on push to development; local needs PM2 restart only when env/process config changes.
