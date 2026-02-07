# Orchestrator

Local worker orchestration service for code task execution.

## Overview

The orchestrator runs on local machines (Mac or VM) behind Cloudflare Tunnel. It receives task dispatch requests from `code-agent`, spawns Claude Code sessions in isolated Docker containers, and reports results via webhooks.

```
code-agent (Cloud Run)
    |
    v POST /tasks (HMAC signed)
orchestrator (local)
    |
    +- TaskDispatcher: manages Claude Code sessions via Docker
    +- WorktreeManager: creates isolated git worktrees
    +- GitHubTokenService: manages GitHub App installation tokens
    +- WebhookClient: reports status to code-agent
    +- StatePersistence: survives restarts
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

## Environment Variables

All vars come from `.envrc` (synced from GCP via `sync-secrets.sh`) and `.envrc.local` (local overrides). See `.envrc.local.example` for the full list.

### Required (startup fails if missing)

| Variable                            | Source         | Description                        |
| ----------------------------------- | -------------- | ---------------------------------- |
| `INTEXURAOS_REPOSITORY_URL`         | `.envrc.local` | GitHub repo URL for clone/fetch    |
| `INTEXURAOS_CODE_AGENT_URL`         | `.envrc.local` | Webhook callback URL (Cloud Run)   |
| `INTEXURAOS_ORCHESTRATOR_SECRET`    | `.envrc`       | HMAC signing secret                |
| `INTEXURAOS_PROJECT_ID`             | `.envrc.local` | GCP project for Secret Manager     |
| `INTEXURAOS_GITHUB_APP_ID`          | `.envrc`       | GitHub App ID                      |
| `INTEXURAOS_GITHUB_INSTALLATION_ID` | `.envrc`       | GitHub App installation ID         |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`    | `.envrc`       | Service-to-service auth            |
| `INTEXURAOS_LINEAR_API_KEY`         | `.envrc`       | Linear API key (passed to workers) |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`      | `.envrc`       | Sentry auth (passed to workers)    |
| `GOOGLE_APPLICATION_CREDENTIALS`    | `.envrc.local` | GCP SA key path                    |

### Optional

| Variable                       | Default                       | Description                  |
| ------------------------------ | ----------------------------- | ---------------------------- |
| `INTEXURAOS_REPOSITORY_PATH`   | `~/.claude-orchestrator/repo` | Local repo clone path        |
| `INTEXURAOS_ANTHROPIC_API_KEY` | `""`                          | Claude API key (for workers) |
| `INTEXURAOS_ZAI_API_KEY`       | `""`                          | ZAI API key (for workers)    |
| `INTEXURAOS_WORKER_CAPACITY`   | `2`                           | Max concurrent tasks         |
| `PORT`                         | `8199`                        | HTTP server port             |
| `LOG_LEVEL`                    | `info`                        | Pino log level               |

---

## Local Development Setup

### Prerequisites

Node.js 22+, pnpm, Docker, gcloud CLI, cloudflared

### Steps

```bash
# 1. Clone and install
git clone https://github.com/pbuchman/intexuraos.git && cd intexuraos
pnpm install && pnpm build

# 2. Sync secrets from GCP (creates .envrc)
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json
PROJECT_ID=intexuraos-dev-pbuchman ./scripts/sync-secrets.sh

# 3. Add orchestrator vars to .envrc.local (see .envrc.local.example for full list)
cat >> .envrc.local << 'EOF'
export INTEXURAOS_REPOSITORY_URL=https://github.com/pbuchman/intexuraos.git
export INTEXURAOS_REPOSITORY_PATH=$HOME/claude-orchestrator/intexuraos
export INTEXURAOS_PROJECT_ID=$PROJECT_ID
export INTEXURAOS_CODE_AGENT_URL=https://intexuraos-code-agent-cj44trunra-lm.a.run.app/
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json
EOF

# 4. Reload env
direnv allow

# 5. Create directories
mkdir -p ~/.claude-orchestrator/logs ~/claude-workers/worktrees

# 6. Start orchestrator
pnpm --filter orchestrator dev

# 7. Verify
curl http://localhost:8199/health
```

---

## Running Stable Artifact (Production / LaunchAgent)

### Build

```bash
pnpm --filter orchestrator build
```

Creates `workers/orchestrator/dist/index.js` - bundled ESM with all workspace dependencies.

### Run

```bash
node workers/orchestrator/dist/index.js
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

## HMAC Signing

The orchestrator secret is used for request signing between code-agent and orchestrator:

1. **Generate:** `openssl rand -hex 32`
2. **Store in two places:**
   - `.envrc` (synced from Secret Manager): `INTEXURAOS_ORCHESTRATOR_SECRET`
   - IntexuraOS UI: Worker Settings -> your worker -> `dispatchSigningSecret`

Both must match or task dispatch fails signature verification.

### GitHub Private Key

The GitHub App private key is fetched automatically from GCP Secret Manager on startup (not from a local file). The code caches it at `~/.claude-orchestrator/github-app.pem`.

---

## Cloudflare Tunnel & Access

The tunnel routes `cc-mac.intexuraos.cloud` -> `localhost:8199`, protected by Cloudflare Access.

### Check Tunnel Status

```bash
ps aux | grep cloudflared
```

### Testing Connectivity

**Local (no Cloudflare):**

```bash
curl http://localhost:8199/health
```

**Via tunnel (requires Cloudflare Access token):**

```bash
curl -H "CF-Access-Client-Id: <client-id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://cc-mac.intexuraos.cloud/health
```

Without the `CF-Access-*` headers, you'll get a 403 Forbidden response.

### How code-agent Authenticates

The code-agent reads Cloudflare Access credentials from Firestore worker settings:

- `cfAccessClientId` - Service token client ID
- `cfAccessClientSecret` - Service token secret

These are configured per-worker in IntexuraOS -> Settings -> Worker Configuration.

### Install Tunnel

```bash
brew install cloudflared && sudo cloudflared service install
```

---

## Testing

```bash
pnpm test         # Unit tests only
pnpm test:e2e     # E2E container tests (requires Docker)
pnpm test:watch   # Watch mode
pnpm typecheck    # Type checking
```

### E2E Prerequisites

| Requirement    | Check Command                              | Install                             |
| -------------- | ------------------------------------------ | ----------------------------------- |
| Docker daemon  | `docker info`                              | Docker Desktop                      |
| Docker network | `docker network inspect claude-worker-net` | `./scripts/setup-worker-network.sh` |
| Test image     | `docker image inspect claude-worker:test`  | See below                           |

```bash
# Setup
./scripts/setup-worker-network.sh
cd workers/claude-worker && docker build -t claude-worker:test -f Dockerfile.test .
cd ../orchestrator && pnpm test:e2e
```

---

## Directory Structure

```
~/claude-workers/
+-- worktrees/              # Git worktrees for tasks (auto-created)

~/.claude-orchestrator/
+-- github-app.pem          # GitHub App private key (auto-fetched)
+-- state.json              # Task state (auto-created)
+-- github-token            # Current GitHub token (auto-created)
+-- secrets/                # Per-task secrets (auto-created)
+-- logs/
    +-- {taskId}.log        # Per-task logs
```

---

## Troubleshooting

| Issue                               | Fix                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Missing `INTEXURAOS_REPOSITORY_URL` | Add to `.envrc.local`, run `direnv allow`                                 |
| 502 from tunnel                     | Orchestrator not running: `pnpm --filter orchestrator dev`                |
| HMAC signature mismatch             | `dispatchSigningSecret` in UI must match `INTEXURAOS_ORCHESTRATOR_SECRET` |
| "Secret Manager" fetch failed       | Check `GOOGLE_APPLICATION_CREDENTIALS` path exists                        |
| Tests skipped                       | Check E2E prerequisites above                                             |
| "Network not found"                 | `./scripts/setup-worker-network.sh`                                       |
| "Image not found"                   | `docker build -t claude-worker:test -f Dockerfile.test .`                 |
| Container name conflict             | `docker rm -f $(docker ps -aq --filter name=claude-worker-)`              |
