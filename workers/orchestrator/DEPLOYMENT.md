# Orchestrator Deployment & Build Reference

Consolidated reference for building, deploying, and managing the orchestrator and its claude-worker containers.

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
│  │ claude-worker container (Docker)                     │   │
│  │ Image: europe-central2-docker.pkg.dev/.../claude-    │   │
│  │        worker:latest                                 │   │
│  │ Runs: claude --dangerously-skip-permissions --verbose │   │
│  │ Mounts: /repo (worktree), /secrets (GCP SA, tokens)  │   │
│  │ Network: claude-worker-net                           │   │
│  │ Deps: container runs its own pnpm install            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

The orchestrator is **not** containerized — it runs as a native Node.js process. Only the claude-worker runs in Docker. Dependency installation (`pnpm install`) happens inside the Docker container, not on the host.

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

## Claude Worker (Docker Image)

### Image Registry

```
europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest
```

For deterministic runtime behavior, prefer digest pinning in orchestrator env:

```bash
export INTEXURAOS_CLAUDE_WORKER_IMAGE=europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker@sha256:<digest>
```

### Build

```bash
# Via helper script
./scripts/build-worker-image.sh [tag]

# Or directly from root context (Dockerfile uses root-relative COPY paths)
docker build --no-cache --platform linux/amd64 \
  -t europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest \
  -f workers/claude-worker/Dockerfile \
  .
```

### Push

```bash
# Via helper script
PUSH=true ./scripts/build-worker-image.sh latest

# Or directly
docker push europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest
```

After push, capture digest and update `INTEXURAOS_CLAUDE_WORKER_IMAGE` (digest form) on orchestrator host.

### Cache Busting

Docker layer cache can mask entrypoint changes because `COPY entrypoint.sh` is a late layer.
Always use `--no-cache` when the entrypoint or any COPY'd file has changed.

### Key Files

| File                                    | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `workers/claude-worker/Dockerfile`      | Production image (node:22-alpine + Claude CLI) |
| `workers/claude-worker/Dockerfile.test` | Test image (claude-stub instead of real CLI)   |
| `workers/claude-worker/entrypoint.sh`   | Container entrypoint (starts Claude)           |
| `scripts/build-worker-image.sh`         | Build + optional push helper                   |

### What the Entrypoint Does

1. Verifies non-root execution (UID 1001)
2. Network restriction check (metadata server blocked)
3. Creates runtime directories (`/home/claude/.config/gcloud`, `/home/claude/.claude`)
4. Verifies `/repo` mount and git state
5. Activates GCP service account
6. Loads GitHub token (with background refresh loop)
7. In managed mode, installs dependencies once and waits for `run-attempt` invocations
8. For each attempt (`/entrypoint.sh run-attempt`), runs Claude in `--print --output-format stream-json`

Orchestrator reuses the same container for follow-up attempts and invokes `--continue` when resuming.

### Container Environment Variables

Set by `docker-provider.ts` when creating containers:

| Variable                         | Source                | Purpose                           |
| -------------------------------- | --------------------- | --------------------------------- |
| `TASK_ID`                        | Task config           | Task identifier                   |
| `ANTHROPIC_API_KEY`              | OAuth access token    | Claude API authentication         |
| `ANTHROPIC_BASE_URL`             | Worker type config    | API endpoint (varies by provider) |
| `ANTHROPIC_MODEL`                | Worker type config    | Model override (optional)         |
| `LINEAR_API_KEY`                 | Secrets               | Linear MCP integration            |
| `SENTRY_AUTH_TOKEN`              | Secrets               | Sentry MCP integration            |
| `GOOGLE_APPLICATION_CREDENTIALS` | Hardcoded `/secrets/` | GCP auth inside container         |
| `CLAUDE_PROJECT_DIR`             | Hardcoded `/repo`     | Hook path resolution              |
| `CLAUDE_MANAGED_MODE`            | Hardcoded `1`         | Enable managed run-attempt mode   |
| `CLAUDE_CONTINUE`                | Per-attempt config    | Resume previous Claude session    |

---

## E2E Testing

### Prerequisites

```bash
# Create docker network
./scripts/setup-worker-network.sh

# Build test image (uses claude-stub instead of real CLI)
cd workers/claude-worker
docker build -t claude-worker:test -f Dockerfile.test .
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

### When `entrypoint.sh` Changes

1. Build image: `docker build --no-cache ...`
2. Push image: `docker push europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest`
3. Capture pushed digest and update `INTEXURAOS_CLAUDE_WORKER_IMAGE` to that digest
4. Running containers use the old image until recreated (no hot reload)

### When Orchestrator Source Changes

1. Rebuild: `pnpm --filter orchestrator build`
2. Restart the orchestrator process (LaunchAgent or manual)

### After VM Provisioning

1. Run `claude login` on the VM before starting orchestrator (use SSH tunnel: `ssh -R 8080:localhost:8080 user@vm`)

### When Both Change (e.g., INT-491)

1. Commit and push code
2. Build and push claude-worker image (`--no-cache`)
3. Update orchestrator env (`INTEXURAOS_CLAUDE_WORKER_IMAGE=@sha256:...`)
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
| Docker images | Self-contained                    | Orchestrator spawns claude-worker     |

---

## Useful Commands

```bash
# Check running worker containers
docker ps --filter name=claude-worker-

# View worker logs
docker logs claude-worker-<task-id>

# Kill orphaned containers
docker rm -f $(docker ps -aq --filter name=claude-worker-)

# Check orchestrator health
curl http://localhost:8199/health

# Force rebuild all packages + orchestrator
pnpm build && pnpm --filter orchestrator build
```
