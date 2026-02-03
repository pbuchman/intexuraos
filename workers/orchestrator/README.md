# Orchestrator

Local worker orchestration service for code task execution.

## Overview

The orchestrator runs on local machines (Mac or VM) behind Cloudflare Tunnel. It receives task dispatch requests from `code-agent`, spawns Claude Code sessions in isolated Docker containers, and reports results via webhooks.

```
code-agent (Cloud Run)
    │
    ▼ POST /tasks (HMAC signed)
orchestrator (local)
    │
    ├─ TaskDispatcher: manages Claude Code sessions via Docker
    ├─ WorktreeManager: creates isolated git worktrees
    ├─ GitHubTokenService: manages GitHub App installation tokens
    ├─ WebhookClient: reports status to code-agent
    └─ StatePersistence: survives restarts
```

## Endpoints

| Method | Path                   | Auth | Description                            |
| ------ | ---------------------- | ---- | -------------------------------------- |
| POST   | `/tasks`               | HMAC | Submit new task                        |
| GET    | `/tasks/:id`           | None | Get task status                        |
| DELETE | `/tasks/:id`           | None | Cancel task                            |
| GET    | `/health`              | None | Health check (capacity, running count) |
| POST   | `/admin/refresh-token` | None | Force GitHub token refresh             |
| POST   | `/admin/shutdown`      | None | Graceful shutdown                      |

---

## Quick Start (Fresh Clone)

**Prerequisites:** Node.js 22+, pnpm, Docker, gcloud CLI, cloudflared

```bash
# 1. Clone and install
git clone https://github.com/pbuchman/intexuraos.git && cd intexuraos
pnpm install && pnpm build

# 2. Sync secrets from GCP (creates .envrc)
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json
PROJECT_ID=intexuraos-dev-pbuchman ./scripts/sync-secrets.sh
direnv allow

# 3. Create directories
mkdir -p ~/.claude-orchestrator/logs ~/claude-workers/worktrees

# 4. Start orchestrator
pnpm --filter orchestrator dev
```

---

## Environment Variables

The orchestrator reads from the monorepo's `.envrc` (synced from GCP Secret Manager via `sync-secrets.sh`).

### Required Variables

| Variable                            | Source         | Description                            |
| ----------------------------------- | -------------- | -------------------------------------- |
| `INTEXURAOS_PROJECT_ID`             | .envrc.local   | GCP project for Secret Manager access  |
| `INTEXURAOS_CODE_AGENT_URL`         | .envrc.local   | Webhook callback URL                   |
| `INTEXURAOS_ORCHESTRATOR_SECRET`    | .envrc.local   | HMAC signing secret (see below)        |
| `INTEXURAOS_GITHUB_APP_ID`          | GCP Secret Mgr | GitHub App ID                          |
| `INTEXURAOS_GITHUB_INSTALLATION_ID` | GCP Secret Mgr | GitHub App installation ID             |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`    | .envrc.local   | Service-to-service auth                |
| `INTEXURAOS_ANTHROPIC_API_KEY`      | GCP Secret Mgr | Claude API key (passed to workers)     |
| `INTEXURAOS_LINEAR_API_KEY`         | GCP Secret Mgr | Linear integration (passed to workers) |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`      | GCP Secret Mgr | Sentry integration (passed to workers) |

### Optional Variables

| Variable                 | Default                 | Description          |
| ------------------------ | ----------------------- | -------------------- |
| `PORT`                   | 8199                    | HTTP server port     |
| `WORKER_CAPACITY`        | 1                       | Max concurrent tasks |
| `REPOSITORY_PATH`        | ~/personal/intexuraos-3 | Repo path            |
| `INTEXURAOS_ZAI_API_KEY` | -                       | ZAI API (optional)   |

### HMAC Signing (INTEXURAOS_ORCHESTRATOR_SECRET)

The orchestrator secret is used for request signing between code-agent and orchestrator:

1. **Generate:** `openssl rand -hex 32`
2. **Store in two places:**
   - `.envrc.local`: `export INTEXURAOS_ORCHESTRATOR_SECRET=<secret>`
   - IntexuraOS UI: Worker Settings → your worker → `dispatchSigningSecret`

Both must match or task dispatch fails signature verification.

### GitHub Private Key

The GitHub App private key is **fetched automatically** from GCP Secret Manager on startup (not from a local file). The code caches it at `~/.claude-orchestrator/github-app.pem`.

---

## Development

### Start Dev Server

```bash
cd workers/orchestrator
pnpm dev          # Watch mode with auto-reload
```

### Running Tests

```bash
pnpm test         # Unit tests only
pnpm test:e2e     # E2E container tests (requires Docker)
pnpm test:watch   # Watch mode
```

### Type Checking

```bash
pnpm typecheck
```

---

## Local Testing (Container Isolation)

E2E tests verify Docker container isolation with real containers.

### Prerequisites

| Requirement    | Check Command                              | Install                             |
| -------------- | ------------------------------------------ | ----------------------------------- |
| Docker daemon  | `docker info`                              | Docker Desktop                      |
| Docker network | `docker network inspect claude-worker-net` | `./scripts/setup-worker-network.sh` |
| Test image     | `docker image inspect claude-worker:test`  | See below                           |

### Setup

```bash
# 1. Create network
./scripts/setup-worker-network.sh

# 2. Build test image
cd workers/claude-worker
docker build -t claude-worker:test -f Dockerfile.test .

# 3. Run E2E tests
cd ../orchestrator
pnpm test:e2e
```

The test image uses a Claude stub (`test-fixtures/claude-stub.sh`) instead of real Claude CLI.

### Test Suites

| Suite               | What it tests                          |
| ------------------- | -------------------------------------- |
| Container Lifecycle | Start, stop, destroy containers        |
| Mount Verification  | `/repo` writable, `/secrets` read-only |
| Input/Output        | stdin delivery, exit codes             |
| Resource Limits     | Memory reporting, cgroup limits        |
| Timeout Handling    | Container killed after timeout         |
| Concurrency         | Max workers limit enforced             |

### Troubleshooting

| Issue                   | Fix                                                          |
| ----------------------- | ------------------------------------------------------------ |
| Tests skipped           | Check prerequisites above                                    |
| "Network not found"     | `./scripts/setup-worker-network.sh`                          |
| "Image not found"       | `docker build -t claude-worker:test -f Dockerfile.test .`    |
| Container name conflict | `docker rm -f $(docker ps -aq --filter name=claude-worker-)` |

---

## Production Deployment

### Build

```bash
pnpm --filter orchestrator build
```

Creates `workers/orchestrator/dist/index.js` - bundled ESM with all workspace dependencies.

### Directory Structure

```
~/claude-workers/
└── worktrees/              # Git worktrees for tasks (auto-created)

~/.claude-orchestrator/
├── github-app.pem          # GitHub App private key (auto-fetched)
├── state.json              # Task state (auto-created)
├── github-token            # Current GitHub token (auto-created)
└── logs/
    └── {taskId}.log        # Per-task logs
```

### LaunchAgent Setup (macOS Auto-start)

Create `~/Library/LaunchAgents/com.intexuraos.orchestrator.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.intexuraos.orchestrator</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/YOUR_USERNAME/path/to/intexuraos/workers/orchestrator/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/path/to/intexuraos</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.claude-orchestrator/logs/orchestrator.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.claude-orchestrator/logs/orchestrator.err.log</string>
</dict>
</plist>
```

### Managing the Service

```bash
launchctl load ~/Library/LaunchAgents/com.intexuraos.orchestrator.plist    # Start
launchctl unload ~/Library/LaunchAgents/com.intexuraos.orchestrator.plist  # Stop
launchctl list | grep orchestrator                                          # Status
```

---

## Cloudflare Tunnel

The tunnel routes `cc-mac.intexuraos.cloud` → `localhost:8199`.

```bash
# Check tunnel is running
ps aux | grep cloudflared

# Test connectivity
curl -s -o /dev/null -w "%{http_code}" https://cc-mac.intexuraos.cloud/health
```

Install: `brew install cloudflared && sudo cloudflared service install`
