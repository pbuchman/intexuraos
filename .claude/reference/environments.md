# Environments

## Overview

| Environment | Domain               | Infra                                       | Machine  | Deploy Target                              |
| ----------- | -------------------- | ------------------------------------------- | -------- | ------------------------------------------ |
| **dev**     | dev.intexuraos.cloud | PM2                                         | home-dev | `~/deploy/intexuraos`                      |
| **prod**    | intexuraos.cloud     | Hetzner PM2/nginx + retained GCP data plane | Hetzner  | GitHub Actions deploy to `/opt/intexuraos` |

**⛔ There is NO "local" environment. Only dev and prod exist. If you think about local, STOP - you are wrong.**

**Single GCP project.** Both `dev.intexuraos.cloud` and `intexuraos.cloud` use the SAME retained GCP project `intexuraos-dev-pbuchman` for data-plane resources. The `-dev-pbuchman` suffix is legacy — there is no separate prod GCP project. The dev/prod distinction is about _deployment target_ (PM2 on `home-dev` vs PM2/nginx on Hetzner), not about project ownership. `terraform/environments/dev/` owns retained GCP resources; `terraform/hetzner-prod/` owns the production Hetzner host and Hetzner-targeted async/control-plane resources.

## Environment Detection Signals

| Signal                           | dev                                      | prod                                   |
| -------------------------------- | ---------------------------------------- | -------------------------------------- |
| URL (public)                     | `dev.intexuraos.cloud`                   | `intexuraos.cloud` (without `dev.`)    |
| URL (internal)                   | `localhost:*` (service URLs on home-dev) | `127.0.0.1:*` on the Hetzner VM        |
| User says                        | "dev", "dev environment"                 | "prod", "production", "cloud"          |
| `uname -n`                       | `home-dev`                               | Hetzner VM hostname                    |
| Logs via                         | `pm2 logs <name>`                        | SSH to Hetzner, then `pm2 logs <name>` |
| `INTEXURAOS_ENVIRONMENT` env var | `dev`                                    | `prod`                                 |

**Firestore is SHARED between both environments.** Same database, same collections.

## Sentry Routing

Sentry routing is DSN-based; environment labels are still only `dev` and `prod`.

| Runtime | Backend project       | Web project               | `INTEXURAOS_ENVIRONMENT` |
| ------- | --------------------- | ------------------------- | ------------------------ |
| dev     | `intexuraos-home-dev` | `intexuraos-web-home-dev` | `dev`                    |
| prod    | `intexuraos-hetzner`  | `intexuraos-web-hetzner`  | `prod`                   |

Home-dev PM2 must force `INTEXURAOS_ENVIRONMENT=dev` even if the shell exports
older values such as `development`. The home-dev orchestrator systemd env file
at `~/.code-orchestrator/env` must also set `INTEXURAOS_ENVIRONMENT=dev` and
`INTEXURAOS_RUNTIME=dev`. Production receives the Hetzner DSNs from Secret
Manager via `scripts/hetzner/load-secrets.sh`; the web DSN is baked into the
static bundle by `scripts/hetzner/deploy-web.sh`.

**Credentials source of truth:** GCP Secret Manager

- **prod:** Uses secrets directly from Secret Manager
- **dev:** Syncs secrets + overrides via `.envrc.local`

## ⛔ Environment Awareness — BEFORE Investigating Any Runtime Issue

**RULE: Identify WHERE the issue is happening before investigating.** Wrong assumptions waste time.

```
STEP 1: Check the URL/context. Does it contain dev.intexuraos.cloud or localhost? → dev
STEP 2: Does it contain intexuraos.cloud (no dev.)? → prod
STEP 3: For code tasks: check Firestore `code_tasks` collection for workerLocation field
STEP 4: Check service status with the right tool (pm2 on home-dev for dev, SSH + pm2 on Hetzner for prod)
```

## On home-dev (dev environment)

| Component                 | Manager | Commands                                                         |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| Apps (18 services + web)  | PM2     | `pm2 status`, `pm2 logs <name>`, `pm2 restart <name>`            |
| Orchestrator              | systemd | `sudo systemctl status/restart intexuraos-orchestrator@pbuchman` |
| Workers (cloud functions) | Direct  | `pnpm dev` (tsx watch) or `node dist/index.js`                   |

**Orchestrator is NOT in PM2.** Runs under systemd as `intexuraos-orchestrator@pbuchman`, executing compiled `dist/index.js`. Check with `systemctl status`, not `pm2 status`.

**Auto-deploy via webhook handler.** A GitHub webhook at `~/tools/webhook-handler/` receives push events to `development`, detects changed files, and restarts affected services. PM2 services restart via `pm2 restart`; the orchestrator rebuilds (`pnpm --filter orchestrator build`) then restarts via `systemctl restart`. PM2 file watching is disabled (`watch: false`).

**Pub/Sub on home-dev uses emulator aliases, not Terraform topic names.** PM2 services publish to `PUBSUB_EMULATOR_HOST=localhost:8102`, so `ecosystem.config.cjs` fallbacks MUST match the aliases configured in `tools/pubsub-ui/server.mjs` (for WhatsApp: `whatsapp-send-message`, `whatsapp-media-cleanup`, `whatsapp-webhook-process`, `whatsapp-transcription`, `commands-ingest`, `approval-reply`). Do NOT use Terraform-managed `intexuraos-*-dev` topic names as PM2 fallbacks on home-dev; those names exist in Cloud Run/GCP, not in the local emulator.

**Port reference:** See `ecosystem.config.cjs` for the full port map of all dev services.

## Development Machines

Code tasks are forwarded from **both dev and prod** to one of two development machines. Both machines serve as task workers:

| Machine      | OS     | `uname -n` | Role                                       | SSH Access               |
| ------------ | ------ | ---------- | ------------------------------------------ | ------------------------ |
| **mac-dev**  | Darwin | varies     | Code editing, commits, pushes              | Can SSH to home-dev      |
| **home-dev** | Linux  | `home-dev` | Runs dev environment, auto-deploys on push | Has dev services running |

**Both use `~/deploy/intexuraos/` as project path (relative to home).**

**Key differences between machines:**

- `home-dev`: Has auto-deploy webhook — pushing to `development` automatically updates and restarts services.
- `mac-dev`: Runs the project via `pnpm` in `~/deploy/intexuraos/` but has **no auto-hook** — codebase does not update automatically on push.
- From `mac-dev` you can access both machines: `home-dev` is reachable via SSH; `mac-dev` services run locally.

**When investigating any issue: first determine which machine you are on**, then use the appropriate access method. If you're on `mac-dev` and the issue is on `home-dev`, SSH there.

**home-dev configuration reference:** The repo at `~/personal/pbuchman-dev/` documents all configuration, services, and infrastructure on `home-dev`. It **must be kept up to date** with the real state of services/configs/infra for future recovery. Always consult it when investigating home-dev service issues.

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

- "This is local" — WRONG. There is NO local. Only dev or prod.
- "Platform is darwin therefore home-dev" — WRONG. darwin = mac-dev, home-dev is Linux.
- "This is a prod issue" — verify first by checking URL or logs source.
- "I can't access that service" — on home-dev, you CAN. It's localhost.
- "We need to restart/deploy" — webhook auto-deploys on push to development. Just push.
