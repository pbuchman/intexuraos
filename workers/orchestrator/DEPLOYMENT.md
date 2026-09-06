# Orchestrator Deployment & Build Reference

Consolidated reference for building, deploying, and managing the orchestrator and its code-worker containers.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ home-dev (Linux VM) or macOS Host                           │
│                                                             │
│  orchestrator (Node.js via systemd or LaunchAgent)          │
│  ├── Fastify HTTP server on :8199                           │
│  ├── Cloudflare Tunnel → cc-home.intexuraos.cloud           │
│  ├── OAuth credential management (Anthropic Max sub)        │
│  └── Docker SDK (dockerode) → spawns worker containers      │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ code-worker container (Docker)                       │   │
│  │ Image: europe-central2-docker.pkg.dev/.../code-     │   │
│  │        worker:latest                                 │   │
│  │ Runs: claude --print or codex exec                  │   │
│  │ Mounts: /repo plus task-specific allowlisted files   │   │
│  │ Network: code-worker-net                             │   │
│  │ Deps: container runs its own pnpm install           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

The orchestrator is **not** containerized — it runs as a native Node.js process.
Only the code-worker runs in Docker. The host renders one exact numeric DEV
package version before orchestrator startup. Neither process receives Secret
Manager IAM; a worker gets only a task-specific projection of approved names
and files, never the package payload.

---

## Orchestrator (Node.js Process)

### Build

```bash
pnpm --filter orchestrator build
```

Produces `workers/orchestrator/dist/index.js` — a bundled ESM file with all workspace dependencies inlined.

### Run Locally (Dev)

```bash
pnpm --filter orchestrator dev     # tsx watch mode
```

### Run in Production

```bash
node workers/orchestrator/dist/index.js
```

Or via systemd (Linux) or macOS LaunchAgent (see `workers/orchestrator/README.md`).

### Key Files

| File                                        | Purpose                                          |
| ------------------------------------------- | ------------------------------------------------ |
| `src/index.ts`                              | Entry point, env validation, server start        |
| `src/main.ts`                               | Fastify app factory                              |
| `src/routes.ts`                             | HTTP endpoints                                   |
| `src/services/`                             | Business logic (task-dispatcher, worktree, etc.) |
| `src/services/isolation/docker-provider.ts` | Docker container lifecycle                       |
| `scripts/start.sh`                          | Production wrapper (exec node)                   |
| `dist/index.js`                             | Built artifact                                   |

---

## Code Worker (Docker Image)

### Image Registry

```
europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest
```

The orchestrator should follow the mutable `:latest` tag so every worker launch
pulls the newest published image:

```bash
export INTEXURAOS_CODE_WORKER_IMAGE=europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest
```

### Build

```bash
# Via helper script
./scripts/build-worker-image.sh [tag]

# Or directly from root context (Dockerfile uses root-relative COPY paths)
docker build --no-cache --platform linux/amd64 \
  -t europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest \
  -f docker/code-worker/Dockerfile \
  .
```

### Push

```bash
# Via helper script
PUSH=true ./scripts/build-worker-image.sh latest

# Or directly
docker push europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest
```

No digest pin update is needed after push. The orchestrator should keep following
`code-worker:latest`.

### Cache Busting

Docker layer cache can mask entrypoint changes because `COPY entrypoint.sh` is a late layer.
Always use `--no-cache` when the entrypoint or any COPY'd file has changed.

### Key Files

| File                                 | Purpose                                               |
| ------------------------------------ | ----------------------------------------------------- |
| `docker/code-worker/Dockerfile`      | Production image (node:22-alpine + Claude/Codex CLIs) |
| `docker/code-worker/Dockerfile.test` | Test image (claude-stub instead of real CLI)          |
| `docker/code-worker/entrypoint.sh`   | Container entrypoint (dispatches Claude or Codex)     |
| `scripts/build-worker-image.sh`      | Build + optional push helper                          |

### What the Entrypoint Does

1. Verifies non-root execution (UID 1001)
2. Network restriction check (metadata server blocked)
3. Creates runtime directories and validates task-specific mounts
4. Verifies `/repo` mount and git state
5. Validates any explicitly allowlisted GCP credential projection without printing it
6. Loads GitHub token (with background refresh loop)
7. In managed mode, installs dependencies once and waits for `run-attempt` invocations
8. For each attempt (`/entrypoint.sh run-attempt`), runs the runtime-specific CLI (`claude --print --output-format stream-json` or `codex exec --json`)

Orchestrator reuses the same container for follow-up attempts and invokes `--continue` when resuming.

The env/file builder uses an explicit allowlist per task/runtime. It rejects
unknown package names, full `.envrc`, package JSON, provisioner/operator keys,
and any credential that grants Secret Manager access. Sensitive files are
copied into the task session with mode `0600`, mounted read-only where possible,
and removed with the task. Logs and diagnostics may show names and presence
only.

### Secret Package Rollout

1. Fetch and validate an exact numeric DEV package on the host through
   `scripts/sync-secrets.sh`; `latest` and aliases are forbidden.
2. Render `.envrc`, `~/.code-orchestrator/env`, and
   `~/.code-orchestrator/github-app.pem` to private staging, then atomically
   activate them after CRC/schema/membership/mode checks.
3. Restart the orchestrator and require health plus GitHub App installation
   token issuance.
4. Create one code-worker canary. Verify projected names, mounted file modes,
   the minimum GCP operation if required, inability to access Secret Manager,
   and callback flow.
5. Replace remaining workers and record commit plus numeric DEV version only.
   Never record values or container environments.

Rollback fetches and validates the previously verified numeric DEV version,
atomically replaces the complete host projection, restarts the orchestrator,
and recreates workers. Per-field rollback and copying a file from another
version are forbidden. See
[Secret Packages Operations](../../docs/operations/secret-packages.md).

### Container Environment Variables

Set by `docker-provider.ts` when creating containers:

| Variable                         | Source                  | Purpose                                                                      |
| -------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `TASK_ID`                        | Task config             | Task identifier                                                              |
| `ANTHROPIC_API_KEY`              | OAuth access token      | Claude API authentication                                                    |
| `ANTHROPIC_BASE_URL`             | Worker type config      | API endpoint (varies by provider)                                            |
| `ANTHROPIC_MODEL`                | Worker type config      | Model override (optional)                                                    |
| `LINEAR_API_KEY`                 | filtered DEV projection | Linear MCP integration for eligible tasks                                    |
| `ERROR_HUB_HOST`                 | Orchestrator config     | Private SentryBox `.ts.net:8443` host                                        |
| `GOOGLE_APPLICATION_CREDENTIALS` | optional task file      | Separate least-privilege credential path; never from DEV or a host admin key |
| `CLAUDE_PROJECT_DIR`             | Hardcoded `/repo`       | Hook path resolution                                                         |
| `WORKER_MANAGED_MODE`            | Hardcoded `1`           | Enable managed run-attempt mode                                              |
| `WORKER_CONTINUE`                | Per-attempt config      | Resume previous runtime session                                              |

---

## Shutdown Behavior

INT-1551 §E.7-§E.8 replaced the orchestrator's legacy 10-minute polling
shutdown loop with an `AbortController` + `Promise.race` graceful drain.

### Drain Budget

`SHUTDOWN_TIMEOUT_MS = 30_000` (30 s) — defined in
`workers/orchestrator/src/main.ts`. On SIGTERM / SIGINT the shutdown handler:

1. Closes the Fastify HTTP server (no new requests).
2. Clears background intervals (token refresh, webhook retry, isolation
   periodic cleanup, isolation health monitor, heartbeat).
3. Aborts a top-level `AbortController` threaded into `TaskDispatcher` →
   `TaskTimers` (cancels per-task `setTimeout` / `setInterval` handles)
   and `TaskRunner` (refuses brand-new container creations).
4. Awaits in-flight handler promises via
   `Promise.race([Promise.allSettled(getInFlightPromises()), 30s timeout])`.
5. Calls the optional `flush()` (Pino + Sentry) before `process.exit(0)`.

### Process-Supervisor Contract

The process supervisor (systemd / LaunchAgent / PM2) MUST grant the
orchestrator at least **32 seconds** between SIGTERM and SIGKILL — that
gives the in-process drain (30 s) a 2 s safety margin for the `app.close()`

- interval cleanup + flush that bracket the race.

| Supervisor                    | Setting                               | Required value |
| ----------------------------- | ------------------------------------- | -------------- |
| systemd                       | `TimeoutStopSec=` in the service unit | `>= 32s`       |
| macOS LaunchAgent (`launchd`) | `ExitTimeOut` plist key               | `>= 32`        |
| PM2 (`ecosystem.config.cjs`)  | `kill_timeout` (ms)                   | `>= 32000`     |

The orchestrator is currently **not** governed by PM2 — it runs as a native
Node.js process under systemd (Linux home-dev) or a macOS LaunchAgent. The
default PM2 `kill_timeout` for app services is `5000` ms, which would be
**too short** if the orchestrator were ever migrated; raise it to `32000` ms
in that scenario.

### Diagnostic Logs

| Log message                                                                    | Trigger                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `Shutdown requested` (`signal: SIGTERM\|SIGINT`)                               | Handler entered, idempotent re-entry returns early       |
| `In-flight handlers drained` (`drainedCount: N`)                               | Drain arm of the race won within budget                  |
| `Shutdown timeout reached; forcing exit with in-flight handlers still pending` | Timeout arm won — handlers exceeded 30 s budget          |
| `Orchestrator shutdown complete`                                               | Race resolved (either arm) and flush about to run        |
| `flush() raised during shutdown; continuing exit`                              | Optional flush callback rejected (process still exits 0) |

---

## E2E Testing

### Prerequisites

```bash
# Create docker network
./scripts/setup-worker-network.sh

# Build test image (uses claude-stub instead of real CLI)
cd docker/code-worker
docker build -t code-worker:test -f Dockerfile.test .
```

### Run

```bash
pnpm --filter orchestrator test:e2e
```

### Test Image vs Production Image

| Aspect     | Production (`Dockerfile`)     | Test (`Dockerfile.test`)              |
| ---------- | ----------------------------- | ------------------------------------- |
| Claude CLI | Real (`claude.ai/install.sh`) | Stub (`test-fixtures/claude-stub.sh`) |
| gcloud CLI | Installed                     | Not installed                         |
| Terraform  | Installed                     | Not installed                         |
| python3    | Installed                     | Not installed                         |
| `NODE_ENV` | `production`                  | `test`                                |

---

## Deployment Checklist

### When The DEV Package Changes

1. Record the previous verified numeric version.
2. Validate, publish, refetch, and shadow-compare a complete candidate without
   logging values.
3. Render the host/orchestrator files to staging and verify mode `0600`.
4. Promote atomically, restart the orchestrator, and run one worker canary.
5. Verify the worker cannot access Secret Manager; then recreate the fleet.
6. Retain the prior numeric version until rollback and observation gates pass.

### When `entrypoint.sh` Changes

1. Build image: `docker build --no-cache ...`
2. Push image: `docker push europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest`
3. Ensure `INTEXURAOS_CODE_WORKER_IMAGE` still points at `code-worker:latest`
4. Running containers use the old image until recreated (no hot reload)

### When Orchestrator Source Changes

1. Rebuild: `pnpm --filter orchestrator build`
2. Restart the orchestrator process (LaunchAgent or manual)

### After VM Provisioning

1. Run `claude login` on the VM before starting orchestrator (use SSH tunnel: `ssh -R 8080:localhost:8080 user@vm`)
2. If the machine should run Codex tasks, bootstrap shared Codex auth with `workers/orchestrator/scripts/codex-login.sh`, then run `codex login --device-auth` inside the container

### When Both Change (e.g., INT-491)

1. Commit and push code
2. Build and push code-worker image (`--no-cache`)
3. Ensure orchestrator env uses `INTEXURAOS_CODE_WORKER_IMAGE=.../code-worker:latest`
4. Rebuild orchestrator: `pnpm --filter orchestrator build`
5. Restart orchestrator process

---

## Differences from Standard Apps

| Aspect        | Standard App (`apps/*`)           | Orchestrator (`workers/orchestrator`) |
| ------------- | --------------------------------- | ------------------------------------- |
| Deployment    | Cloud Run (Dockerfile)            | Native Node.js (systemd/LaunchAgent)  |
| Cloud Build   | `cloudbuild.yaml` per service     | None — local build only               |
| Artifact      | Docker image in Artifact Registry | `dist/index.js` bundle                |
| Terraform     | Cloud Run service module          | Not managed by Terraform              |
| Push script   | `push-missing-images.sh`          | Not included (apps/ only)             |
| Docker images | Self-contained                    | Orchestrator spawns code-worker       |

---

## Useful Commands

```bash
# Check running worker containers
docker ps --filter name=code-worker-

# View worker logs
docker logs code-worker-<task-id>

# Kill orphaned containers
docker rm -f $(docker ps -aq --filter name=code-worker-)

# Check orchestrator health
curl http://localhost:8199/health

# Force rebuild all packages + orchestrator
pnpm build && pnpm --filter orchestrator build
```
