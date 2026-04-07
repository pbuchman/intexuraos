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
│  │ Mounts: /repo (worktree), /secrets (GCP SA, tokens) │   │
│  │ Network: code-worker-net                             │   │
│  │ Deps: container runs its own pnpm install           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

The orchestrator is **not** containerized — it runs as a native Node.js process. Only the code-worker runs in Docker. Dependency installation (`pnpm install`) happens inside the Docker container, not on the host.

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

For deterministic runtime behavior, prefer digest pinning in orchestrator env:

```bash
export INTEXURAOS_CODE_WORKER_IMAGE=europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker@sha256:<digest>
```

### Build

```bash
# Via helper script
./scripts/build-worker-image.sh [tag]

# Or directly from root context (Dockerfile uses root-relative COPY paths)
docker build --no-cache --platform linux/amd64 \
  -t europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest \
  -f workers/code-worker/Dockerfile \
  .
```

### Push

```bash
# Via helper script
PUSH=true ./scripts/build-worker-image.sh latest

# Or directly
docker push europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest
```

After push, capture digest and update `INTEXURAOS_CODE_WORKER_IMAGE` (digest form) on orchestrator host.

### Cache Busting

Docker layer cache can mask entrypoint changes because `COPY entrypoint.sh` is a late layer.
Always use `--no-cache` when the entrypoint or any COPY'd file has changed.

### Key Files

| File                                  | Purpose                                               |
| ------------------------------------- | ----------------------------------------------------- |
| `workers/code-worker/Dockerfile`      | Production image (node:22-alpine + Claude/Codex CLIs) |
| `workers/code-worker/Dockerfile.test` | Test image (claude-stub instead of real CLI)          |
| `workers/code-worker/entrypoint.sh`   | Container entrypoint (dispatches Claude or Codex)     |
| `scripts/build-worker-image.sh`       | Build + optional push helper                          |

### What the Entrypoint Does

1. Verifies non-root execution (UID 1001)
2. Network restriction check (metadata server blocked)
3. Creates runtime directories (`/home/claude/.config/gcloud`, `/home/claude/.claude`)
4. Verifies `/repo` mount and git state
5. Activates GCP service account
6. Loads GitHub token (with background refresh loop)
7. In managed mode, installs dependencies once and waits for `run-attempt` invocations
8. For each attempt (`/entrypoint.sh run-attempt`), runs the runtime-specific CLI (`claude --print --output-format stream-json` or `codex exec --json`)

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
| `WORKER_MANAGED_MODE`            | Hardcoded `1`         | Enable managed run-attempt mode   |
| `WORKER_CONTINUE`                | Per-attempt config    | Resume previous runtime session   |

---

## E2E Testing

### Prerequisites

```bash
# Create docker network
./scripts/setup-worker-network.sh

# Build test image (uses claude-stub instead of real CLI)
cd workers/code-worker
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

### When `entrypoint.sh` Changes

1. Build image: `docker build --no-cache ...`
2. Push image: `docker push europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest`
3. Capture pushed digest and update `INTEXURAOS_CODE_WORKER_IMAGE` to that digest
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
3. Update orchestrator env (`INTEXURAOS_CODE_WORKER_IMAGE=@sha256:...`)
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
