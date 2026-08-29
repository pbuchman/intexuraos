# Environments

## Overview

| Environment | Domain                 | Normal state                                      | Runtime owner              |
| ----------- | ---------------------- | ------------------------------------------------- | -------------------------- |
| **local**   | `localhost`            | Optional PM2/Vite + per-host Pub/Sub emulator     | Current developer checkout |
| **DEV**     | `dev.intexuraos.cloud` | Retained configuration label, normally hibernated | No application runtime     |
| **prod**    | `intexuraos.cloud`     | Hetzner PM2/nginx + retained GCP data plane       | Hetzner                    |

**Single retained GCP project.** Local, dev, and prod use the SAME retained GCP project `intexuraos-dev-pbuchman` for Firestore, Cloud Storage, Secret Manager, and Auth0 configuration. The `-dev-pbuchman` suffix is legacy; there is no separate prod GCP project. The environment distinction is about runtime target and routing, not project ownership.

**DEV is a retained configuration label and is normally hibernated.** Its checkout, profiles,
credentials, data, and recovery path remain available, but its PM2 tree, Pub/Sub emulator, UI,
and DEV-owned observability units are stopped. `dev.intexuraos.cloud` returns deterministic,
non-cacheable `503 Service Unavailable`. Only the reviewed `intexuraos-dev-mode` workflow may
perform a temporary resume and it must finish by re-hibernating the runtime.

**Home Dev is a production-owned worker host.** The production-owned orchestrator and unrelated
shared services remain active there. The host name and legacy `dev` observability tags do not make
it a live DEV application environment.

**Local retains the old development data/async pattern.** It uses real retained GCP
Firestore/Storage/Auth0, the versioned DEV configuration package, and its own Pub/Sub emulator on
`localhost:8102`, but runs only when an operator explicitly starts the current checkout.

**Firestore is SHARED across local, dev, and prod.** Same database, same collections. Treat local data writes as writes to the shared retained project.

**Budget background Firestore scans across every enabled runtime.** Pollers in production, an
explicitly started local stack, and any temporary DEV recovery window consume the same retained
project quota. Any new or changed scanner must avoid unbounded repeated reads, calculate its
aggregate daily read floor across all enabled runtimes, and keep a test that enforces the intended
budget.

## Environment Detection Signals

| Signal                         | Meaning                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `http://localhost:*`           | Identify the machine and process; it may be a local stack or a host-local retained service |
| `https://dev.intexuraos.cloud` | Historical link or retained DEV profile; not proof of a running runtime                    |
| `https://intexuraos.cloud`     | Live production application                                                                |
| `uname -n=home-dev`            | Physical worker/shared-service host; not environment ownership                             |
| `INTEXURAOS_ENVIRONMENT=dev`   | Legacy observability/configuration tag; not routing authority                              |
| `MODE=hibernated`              | DEV application units and emulator must remain inactive; public DEV route returns `503`    |

Do not classify an issue from `localhost` alone. First identify the machine and context: local developer checkout, home-dev internal service URL, or Hetzner internal URL.

## SentryBox Routing

Error routing uses Sentry-compatible DSNs served by the private SentryBox instance on home-dev.
Runtime labels remain `dev` and `prod`; local currently runs with the dev service label for
compatibility. Project, release, and environment tags provide the retained filtering dimensions.

| Runtime                | SentryBox backend project | SentryBox web project | `INTEXURAOS_ENVIRONMENT` |
| ---------------------- | ------------------------- | --------------------- | ------------------------ |
| local                  | `intexuraos-backend`      | `intexuraos-web`      | `dev`                    |
| retained DEV profile   | `intexuraos-backend`      | `intexuraos-web`      | `dev`                    |
| retained transcription | `intexuraos-backend`      | n/a                   | `dev`                    |
| prod                   | `intexuraos-backend`      | `intexuraos-web`      | `prod`                   |

The retained DEV PM2 profile forces `INTEXURAOS_ENVIRONMENT=dev` only when explicitly resumed.
The production-owned Home Dev orchestrator systemd env file at `~/.code-orchestrator/env` also
retains `INTEXURAOS_ENVIRONMENT=dev`, `INTEXURAOS_RUNTIME=dev`, and the private `.ts.net:8443`
`INTEXURAOS_ERROR_HUB_HOST`, while its generator pins
`INTEXURAOS_CODE_AGENT_URL=https://intexuraos.cloud/api/code` and
`INTEXURAOS_USAGE_WEBHOOK_URL=https://intexuraos.cloud/api/code/internal/webhooks/usage-events`.
Those `dev` values are legacy physical-host/observability tags and are not routing authority; see
[the identity decision](../../docs/operations/orchestrator-identity-decision.md). Production
receives the SentryBox DSNs from versioned runtime configuration via
`scripts/hetzner/load-secrets.sh`; the web DSN is baked into the static bundle by
`scripts/hetzner/deploy-web.sh`.

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

| Environment  | Runtime loading                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| local        | exact DEV version plus versioned config, rendered under `${HOME}/.config/intexuraos/secret-packages/dev/current` and projected to mode-`0600` `.envrc`/approved files |
| retained DEV | pinned DEV projection retained on Home Dev for controlled resume; it is not evidence that PM2 or emulator units are running                                           |
| prod         | exact PROD version fetched by the external Hetzner provisioner, validated and atomically projected to `/etc/intexuraos/.env.prod` and protected files                 |

Renderers may access only their environment package. Runtime services,
orchestrator processes, and code workers do not receive Secret Manager access.
The provisioner/bootstrap credential always remains outside the package it
opens. See [Secret Packages Operations](../../docs/operations/secret-packages.md)
for one-shot publication, rendering, rotation, and verification.

Local and temporarily resumed DEV PM2 services must not inherit `FIRESTORE_EMULATOR_HOST` or
`STORAGE_EMULATOR_HOST`; they use real retained GCP Firestore/Storage. They set
`PUBSUB_EMULATOR_HOST=localhost:8102` only while their own host-local emulator is running.

Automated login credentials live outside the repo in `~/.intexuraos/logins.md` with mode `0600`.
The same Auth0 tenant/client configuration is retained for local, DEV recovery, and production;
keeping a DEV callback does not imply a live DEV runtime. Local browser login tests must use
`http://localhost:3000/#/login`; `127.0.0.1` is not a configured SPA callback URL. Never commit or
paste passwords.

## Local Environment

Use local for edit-run-verify feedback on the current checkout. It reuses the retained DEV
configuration/data contract, but it is a separate, explicitly started local runtime—not the
hibernated DEV environment.

| Component             | Manager | Commands                                                                                                                                 |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Secret sync           | direnv  | `SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS=<renderer-key> ./scripts/sync-secrets.sh --version <dev-numeric-version> && direnv allow` |
| Pub/Sub emulator + UI | Docker  | `node scripts/dev-setup.mjs`                                                                                                             |
| Apps (services + web) | PM2     | `pnpm run dev` or `pnpm run services:start`                                                                                              |
| Logs                  | PM2     | `pnpm exec pm2 logs <name>`                                                                                                              |
| Status                | PM2     | `pnpm exec pm2 status`                                                                                                                   |

`pnpm run dev` is the simple path: it runs `scripts/dev-setup.mjs`, starts PM2 from `ecosystem.config.cjs` with `--update-env`, and tails logs. Services run through `tsx` from `src/` and PM2 watches source files for automatic reload. The web app runs through Vite on port `3000`.

Local and the retained Home Dev PM2 recovery profile use the external
`${HOME}/.config/intexuraos/home-runtime-sa-key.json`; the Home Dev orchestrator uses
the separate generator-fixed
`${HOME}/.config/intexuraos/home-orchestrator-sa-key.json`. Neither belongs in a
package or worker, and neither identity has Secret Manager access.

If Docker Desktop config uses a GUI credential store, `scripts/dev-setup.mjs` creates a temporary Docker config for compose startup that removes `credsStore` while preserving CLI plugins. This avoids credential-helper hangs without modifying `~/.docker/config.json`.

## Retained DEV Profile On Home Dev

| Component                    | Normal hibernated state | Owner                                  |
| ---------------------------- | ----------------------- | -------------------------------------- |
| DEV apps + web               | stopped/disabled        | `pm2-pbuchman.service`                 |
| DEV Pub/Sub emulator + UI    | stopped/disabled        | `intexuraos-emulators.service`         |
| DEV log bridge/observability | stopped/disabled        | DEV mode-controller policy             |
| Orchestrator                 | active/enabled          | `intexuraos-orchestrator@pbuchman`     |
| Caddy/Cloudflare/shared apps | active                  | Shared-host configuration, not DEV PM2 |

**Orchestrator is not in PM2 and remains active.** It runs under systemd as
`intexuraos-orchestrator@pbuchman`, executing compiled `dist/index.js`. Check it with `systemctl`,
not `pm2 status`.

**No normal deployment may resurrect DEV.** The old IntexuraOS webhook handler is masked. Every
remaining deployment path must read `/var/lib/intexuraos-dev/runtime-mode.env` and refuse to start
PM2, emulators, or an active DEV edge profile while `MODE=draining|hibernated`. Use the reviewed
`intexuraos-dev-mode` controller and exact revision/evidence contracts for resume or cutover.

**The emulator alias contract is retained only for resume.** If DEV is explicitly resumed, PM2
services publish to `PUBSUB_EMULATOR_HOST=localhost:8102` and aliases from
`tools/pubsub-ui/server.mjs`; Terraform-managed `intexuraos-*-dev` names are not emulator aliases.

**Port reference:** See `ecosystem.config.cjs` for the retained local/DEV map. In hibernated mode,
those DEV listeners must be absent.

## Development Machines

Production code tasks can be forwarded to either development machine. Both machines serve as task
workers independently of application-environment ownership:

| Machine      | OS     | `uname -n` | Role                                               | SSH Access                        |
| ------------ | ------ | ---------- | -------------------------------------------------- | --------------------------------- |
| **mac-dev**  | Darwin | varies     | Code editing, commits, pushes, local stack         | Can SSH to home-dev               |
| **home-dev** | Linux  | `home-dev` | Production-owned orchestrator worker + shared host | Has retained DEV recovery profile |

**Both use `~/deploy/intexuraos/` as project path when running the deployed checkout.** Local developer checkouts may also exist under `~/personal/`.

**Key differences between machines:**

- `home-dev`: Keeps the production-owned orchestrator; normal deploys cannot start the retained DEV runtime.
- `mac-dev`: Can run the local stack from the current checkout with `pnpm run dev`; there is no auto-hook from pushes.
- From `mac-dev` you can access both machines: `home-dev` is reachable via SSH; mac-dev services run locally.

**When investigating any issue: first determine which machine and environment you are on**, then use the appropriate access method. If you're on `mac-dev` and the issue is on `home-dev`, SSH there.

**home-dev configuration reference:** The repo at `~/personal/pbuchman-dev/` documents all configuration, services, and infrastructure on `home-dev`. It must be kept up to date with the real state of services/configs/infra for future recovery. Always consult it when investigating home-dev service issues.

**Code Task Investigation:** For any code task issue, FIRST check the Firestore `code_tasks` document for the task. The `workerLocation` field contains a user-configured string (e.g., `"mac-dev"`, `"office-pc"`) — read whatever value is stored; it is not a fixed hostname.

## Code Task Worker Location vs Environment Ownership

**Orchestrator is deployment-independent.** A production code task may run on `home-dev`,
`mac-dev`, or another worker machine. `workerLocation` answers "which machine is executing this
task"; it does not answer who owns callbacks.

Every new callback is production-owned. The task's required HTTP(S) callback URL remains the
runtime authority for all sibling callbacks:

| Contract          | Canonical callback base             |
| ----------------- | ----------------------------------- |
| New task          | `https://intexuraos.cloud/api/code` |
| Legacy DEV record | Historical/recovery input only      |

For task logs, lifecycle events, turn metrics, status updates, and completion callbacks, orchestrator MUST use the task-provided `webhookUrl` to derive sibling callback URLs. It MUST NOT infer callback destination from hostname, `workerLocation`, or its own fallback `INTEXURAOS_CODE_AGENT_URL` when `webhookUrl` is present.

## Forbidden Assumptions

- "localhost means dev" — WRONG. Check whether it is the local checkout, home-dev internals, or Hetzner internals.
- "This is a prod issue" — verify first by checking URL, callback base, machine, and logs source.
- "Platform is darwin therefore home-dev" — WRONG. darwin = mac-dev/developer machine, home-dev is Linux.
- "home-dev means DEV" — WRONG. It is a physical production-owned worker/shared-service host.
- "We need to restart DEV" — first read the mode record; normal diagnosis/deployment must not
  bypass hibernation or the reviewed resume workflow.
