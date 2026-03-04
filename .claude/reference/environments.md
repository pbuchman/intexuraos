# Environments

## Overview

| Environment | Domain               | Infra                 | Machine  | Deploy Target            |
| ----------- | -------------------- | --------------------- | -------- | ------------------------ |
| **dev**     | dev.intexuraos.cloud | PM2                   | home-dev | `~/deploy/intexuraos`    |
| **prod**    | intexuraos.cloud     | Cloud Run / Functions | GCloud   | CI/CD via GitHub Actions |

**⛔ There is NO "local" environment. Only dev and prod exist. If you think about local, STOP - you are wrong.**

## Environment Detection Signals

| Signal                           | dev                                      | prod                                |
| -------------------------------- | ---------------------------------------- | ----------------------------------- |
| URL (public)                     | `dev.intexuraos.cloud`                   | `intexuraos.cloud` (without `dev.`) |
| URL (internal)                   | `localhost:*` (service URLs on home-dev) | `*.run.app`                         |
| User says                        | "dev", "dev environment"                 | "prod", "production", "cloud"       |
| `uname -n`                       | `home-dev`                               | N/A (Cloud Run)                     |
| Logs via                         | `pm2 logs <name>`                        | `gcloud logging read`               |
| `INTEXURAOS_ENVIRONMENT` env var | `dev`                                    | `prod`                              |

**Firestore is SHARED between both environments.** Same database, same collections.

**Credentials source of truth:** GCP Secret Manager

- **prod:** Uses secrets directly from Secret Manager
- **dev:** Syncs secrets + overrides via `.envrc.local`

## ⛔ Environment Awareness — BEFORE Investigating Any Runtime Issue

**RULE: Identify WHERE the issue is happening before investigating.** Wrong assumptions waste time.

```
STEP 1: Check the URL/context. Does it contain dev.intexuraos.cloud or localhost? → dev
STEP 2: Does it contain intexuraos.cloud (no dev.) or *.run.app? → prod
STEP 3: For code tasks: check Firestore `code_tasks` collection for workerLocation field
STEP 4: Check service status with the right tool (pm2 for dev, gcloud for prod)
```

## On home-dev (dev environment)

| Component                 | Manager | Commands                                                         |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| Apps (18 services + web)  | PM2     | `pm2 status`, `pm2 logs <name>`, `pm2 restart <name>`            |
| Orchestrator              | systemd | `sudo systemctl status/restart intexuraos-orchestrator@pbuchman` |
| Workers (cloud functions) | Direct  | `pnpm dev` (tsx watch) or `node dist/index.js`                   |

**Orchestrator is NOT in PM2.** Runs under systemd as `intexuraos-orchestrator@pbuchman`, executing compiled `dist/index.js`. Check with `systemctl status`, not `pm2 status`.

**Auto-deploy via webhook handler.** A GitHub webhook at `~/tools/webhook-handler/` receives push events to `development`, detects changed files, and restarts affected services. PM2 services restart via `pm2 restart`; the orchestrator rebuilds (`pnpm --filter orchestrator build`) then restarts via `systemctl restart`. PM2 file watching is disabled (`watch: false`).

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

## Forbidden Assumptions

- "This is local" — WRONG. There is NO local. Only dev or prod.
- "Platform is darwin therefore home-dev" — WRONG. darwin = mac-dev, home-dev is Linux.
- "This is a prod issue" — verify first by checking URL or logs source.
- "I can't access that service" — on home-dev, you CAN. It's localhost.
- "We need to restart/deploy" — webhook auto-deploys on push to development. Just push.
