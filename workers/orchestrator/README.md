# Orchestrator

Local worker orchestration service for code task execution.

## Overview

The orchestrator runs on local machines (Mac or VM) behind Cloudflare Tunnel. It receives task dispatch requests from `code-agent`, spawns Claude Code sessions in isolated Docker containers, and reports results via webhooks.

### Agent-Based Routing (Current)

Task dispatch is now agent-based (not phase-based):

- `pull_request`: PR/comment/review-triggered tasks
- `planning`: Linear issue tasks without `code-task`
- `execution`: Linear issue tasks with `code-task`

Prompts preserve `[WORKER-MODE]` and inject exactly one agent marker:

- `[AGENT:PLANNING]`
- `[AGENT:EXECUTION]`
- `[AGENT:PULL_REQUEST]`

Completion contracts use these final block names (no legacy fallback):

- `PLANNING_AGENT_FINAL`
- `EXECUTION_AGENT_FINAL`
- `PULL_REQUEST_AGENT_FINAL`

Planning Agent outcomes:

- `planned` -> orchestrator webhook `status=completed`
- `unclear` -> orchestrator webhook `status=failed` with `error.code=PLANNING_AGENT_UNCLEAR`

For all Planning Agent runs, orchestrator flattens verifier metadata into webhook `result` using `planning_*` fields. `code-agent` owns deterministic Linear mutations after receiving the webhook.

Execution Agent notes:

- `implemented` is sent as webhook `status=completed`
- Execution verification is Gemini semantic validation of Claude responses (latest response first, prior responses fallback)
- Orchestrator flattens execution verifier metadata into webhook `result` using `execution_*` fields:
  - `execution_outcome_label`
  - `execution_superpowers_executing_plans_used`
  - `execution_superpowers_requesting_code_review_used`
  - `execution_trivial_task`
  - `execution_subagents`
  - `execution_review_iterations`
  - `execution_linear_issue_url`
- Ownership split:
  - Worker owns GitHub execution (code/tests/CI/PR/review loop)
  - `code-agent` owns deterministic Linear enforcement on successful execution callbacks (executed issue only)

```
code-agent (Cloud Run)
    |
    v POST /tasks (HMAC signed)
orchestrator (local)
    |
    +- TaskDispatcher: manages Claude Code sessions via Docker
    +- WorktreeManager: creates isolated git worktrees (source only, no deps)
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

All vars come from `.envrc` (synced from GCP via `sync-secrets.sh`) and `.envrc.local` (local overrides). If secrets are missing, run `./scripts/sync-secrets.sh --add-new`.

### Required (startup fails if missing)

| Variable                            | Source         | Description                                       |
| ----------------------------------- | -------------- | ------------------------------------------------- |
| `INTEXURAOS_REPOSITORY_URL`         | `.envrc.local` | GitHub repo URL for clone/fetch                   |
| `INTEXURAOS_CODE_AGENT_URL`         | `.envrc.local` | Webhook callback URL (Cloud Run)                  |
| `INTEXURAOS_ORCHESTRATOR_SECRET`    | `.envrc`       | HMAC signing secret                               |
| `INTEXURAOS_PROJECT_ID`             | `.envrc.local` | GCP project for Secret Manager                    |
| `INTEXURAOS_GITHUB_APP_ID`          | `.envrc`       | GitHub App ID                                     |
| `INTEXURAOS_GITHUB_INSTALLATION_ID` | `.envrc`       | GitHub App installation ID                        |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`    | `.envrc`       | Service-to-service auth                           |
| `INTEXURAOS_LINEAR_API_KEY`         | `.envrc`       | Linear API key (passed to workers)                |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`      | `.envrc`       | Sentry auth (passed to workers)                   |
| `INTEXURAOS_ZAI_APP_API_KEY`        | `.envrc`       | ZAI API key (passed to workers)                   |
| `INTEXURAOS_GEMINI_APP_API_KEY`     | `.envrc`       | Gemini API key (required for completion verifier) |
| `GOOGLE_APPLICATION_CREDENTIALS`    | `.envrc.local` | GCP SA key path                                   |

### Optional

| Variable                                | Default                       | Description                                                |
| --------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `INTEXURAOS_REPOSITORY_PATH`            | `~/.claude-orchestrator/repo` | Local repo clone path                                      |
| `INTEXURAOS_WORKER_CAPACITY`            | `2`                           | Max concurrent tasks                                       |
| `INTEXURAOS_CLAUDE_WORKER_IMAGE`        | `.../claude-worker:latest`    | Worker image reference (tag or digest)                     |
| `INTEXURAOS_PRESERVE_WORKER_CONTAINERS` | `1`                           | Keep worker containers after task completion for debugging |
| `INTEXURAOS_GIT_USER_NAME`              | Host `git config user.name`   | Git author name for worker commits                         |
| `INTEXURAOS_GIT_USER_EMAIL`             | Host `git config user.email`  | Git author email for worker commits                        |
| `PORT`                                  | `8199`                        | HTTP server port                                           |
| `LOG_LEVEL`                             | `info`                        | Pino log level                                             |

---

## Local Development Setup

### Prerequisites

Node.js 22+, Docker, gcloud CLI, cloudflared. pnpm is needed for building, not at runtime.

### Steps

```bash
# 1. Clone and install
git clone https://github.com/pbuchman/intexuraos.git && cd intexuraos
pnpm install && pnpm build

# 2. Sync secrets from GCP (creates .envrc)
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json
PROJECT_ID=intexuraos-dev-pbuchman ./scripts/sync-secrets.sh

# Optional: prompt to add missing Terraform-defined secret values
PROJECT_ID=intexuraos-dev-pbuchman ./scripts/sync-secrets.sh --add-new

# 3. Add orchestrator vars to .envrc.local (see .envrc.local.example for full list)
cat >> .envrc.local << 'EOF'
export INTEXURAOS_REPOSITORY_URL=https://github.com/pbuchman/intexuraos.git
export INTEXURAOS_REPOSITORY_PATH=$HOME/claude-orchestrator/intexuraos
export INTEXURAOS_PROJECT_ID=$PROJECT_ID
export INTEXURAOS_CODE_AGENT_URL=https://intexuraos-code-agent-cj44trunra-lm.a.run.app/
# Optional but recommended: pin to immutable digest
# export INTEXURAOS_CLAUDE_WORKER_IMAGE=europe-central2-docker.pkg.dev/.../claude-worker@sha256:<digest>
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json
EOF

# 4. Reload env
direnv allow

# 5. Create directories
mkdir -p ~/.claude-orchestrator/logs ~/claude-workers/worktrees

# 6. Start orchestrator (dev mode with hot-reload)
pnpm --filter orchestrator dev

# 7. Verify
curl http://localhost:8199/health
```

---

## Running as a Service (Production)

### Build

```bash
pnpm --filter orchestrator build
```

Creates `workers/orchestrator/dist/index.js` — bundled ESM with all workspace dependencies.

### systemd Setup (Linux — home-dev VM)

The orchestrator runs as a systemd template service. The service file lives at `/etc/systemd/system/intexuraos-orchestrator@.service` and uses `%i` for the username.

**Key details:**

- Runs `node dist/index.js` from `~/deploy/intexuraos/workers/orchestrator/`
- Env vars loaded from `~/.claude-orchestrator/env` (43 vars, extracted from Secret Manager)
- Auto-restarts on failure (`Restart=on-failure`, `RestartSec=10`)
- Rate-limited to 5 restarts per 5 minutes (`StartLimitBurst=5`, `StartLimitIntervalSec=300`)
- Logs to journald (`journalctl -u intexuraos-orchestrator@pbuchman`)

#### Service Operations

```bash
# Check status
sudo systemctl status intexuraos-orchestrator@pbuchman

# View logs (live)
journalctl -u intexuraos-orchestrator@pbuchman -f

# View recent logs
journalctl -u intexuraos-orchestrator@pbuchman --no-pager -n 50

# Stop (prevents auto-restart)
sudo systemctl stop intexuraos-orchestrator@pbuchman

# Start
sudo systemctl start intexuraos-orchestrator@pbuchman

# Restart (after rebuild)
sudo systemctl restart intexuraos-orchestrator@pbuchman

# Health check
curl -s http://localhost:8199/health | jq .
```

#### Rebuilding and Deploying Changes

The systemd service runs from a built artifact — it does NOT auto-rebuild on code changes. After modifying orchestrator code:

```bash
# 1. Build new artifact
cd ~/deploy/intexuraos
pnpm build   # builds shared packages
pnpm --filter orchestrator build

# 2. Restart the service (picks up new dist/index.js)
sudo systemctl restart intexuraos-orchestrator@pbuchman

# 3. Verify
curl -s http://localhost:8199/health | jq .

# Note: This is automated by the webhook handler on pushes to development.
```

#### Switching to Dev Mode (Local Development)

To run the orchestrator with hot-reload for development:

```bash
# 1. Stop the systemd service (otherwise it auto-restarts on port 8199)
sudo systemctl stop intexuraos-orchestrator@pbuchman

# 2. Load env vars
cd ~/deploy/intexuraos   # or any workspace
set -a && source ~/.claude-orchestrator/env && set +a

# 3. Run with tsx watch (hot-reload on source changes)
pnpm --filter orchestrator dev

# 4. When done, restore the service
# Press Ctrl+C to stop dev mode, then:
sudo systemctl start intexuraos-orchestrator@pbuchman
```

#### Updating Secrets (env file)

The orchestrator's env file is NOT auto-synced. To update after secrets change in GCP:

```bash
# 1. Sync secrets to .envrc in deploy dir
cd ~/deploy/intexuraos
./scripts/sync-secrets.sh

# 2. Re-extract orchestrator vars
grep -E '^export INTEXURAOS_' .envrc | sed 's/^export //' > ~/.claude-orchestrator/env
echo "GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json" >> ~/.claude-orchestrator/env
echo "PORT=8199" >> ~/.claude-orchestrator/env
echo "INTEXURAOS_WORKER_CAPACITY=3" >> ~/.claude-orchestrator/env
echo "INTEXURAOS_REPOSITORY_PATH=$HOME/.claude-orchestrator/repo" >> ~/.claude-orchestrator/env
echo "LOG_LEVEL=info" >> ~/.claude-orchestrator/env
echo "INTEXURAOS_CODE_AGENT_URL=http://localhost:8128" >> ~/.claude-orchestrator/env
echo "INTEXURAOS_PROJECT_ID=intexuraos-dev-pbuchman" >> ~/.claude-orchestrator/env
chmod 600 ~/.claude-orchestrator/env

# 3. Restart
sudo systemctl restart intexuraos-orchestrator@pbuchman
```

#### Full Recovery (from scratch)

If the orchestrator needs to be set up from zero on a new machine:

```bash
# 1. Create directories
mkdir -p ~/.claude-orchestrator/secrets ~/.claude-orchestrator/logs
mkdir -p ~/claude-workers/worktrees

# 2. Clone orchestrator repo
git clone git@github.com:pbuchman/intexuraos.git ~/.claude-orchestrator/repo

# 3. Build
cd ~/deploy/intexuraos
pnpm install && pnpm build && pnpm --filter orchestrator build

# 4. Set up Docker worker network
bash scripts/setup-worker-network.sh
sudo iptables -I DOCKER-USER -d 169.254.169.254 -j DROP  # block cloud metadata

# 5. Create env file (see "Updating Secrets" above)

# 6. Install Claude Code and login (for Anthropic OAuth)
curl -fsSL https://claude.ai/install.sh | bash
# Use SSH reverse tunnel for headless login:
# From workstation: ssh -R 8080:localhost:8080 user@vm
# On VM: claude login

# 7. Install systemd service
sudo cp ~/personal/pbuchman-dev/machine-setup/config/intexuraos-orchestrator.service \
     /etc/systemd/system/intexuraos-orchestrator@.service
sudo systemctl daemon-reload
sudo systemctl enable intexuraos-orchestrator@pbuchman
sudo systemctl start intexuraos-orchestrator@pbuchman

# 8. Verify
curl -s http://localhost:8199/health | jq .
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

### Managing the macOS Service

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

## Anthropic OAuth (Max Subscription)

The orchestrator uses Claude Code OAuth credentials (Max subscription) instead of a static API key.

**Prerequisite:** Run `claude login` on the orchestrator machine before first start.

For headless machines (SSH-only, no browser):

1. Open an SSH session with reverse port forwarding from your workstation:

   ```bash
   ssh -R 8080:localhost:8080 user@orchestrator-vm
   ```

   This forwards port 8080 on the VM back to your workstation, allowing the OAuth
   callback to reach your local browser.

2. On the VM, run the Claude login command:

   ```bash
   claude login
   ```

3. A URL is printed to the terminal. Open it in your workstation's browser.
   Complete the Anthropic OAuth consent flow and authorize the CLI.

4. On success, credentials are written to `~/.claude/.credentials.json` on the VM.

5. Start the orchestrator — it reads credentials automatically:
   ```bash
   node workers/orchestrator/dist/index.js
   ```

The orchestrator:

- Reads OAuth credentials from `~/.claude/.credentials.json` at startup
- Logs credential expiry time and subscription type on boot
- Refreshes access tokens automatically (30-minute check cycle, tokens last ~4-5h)
- Persists rotated refresh tokens back to the credentials file
- Alerts code-agent via webhook if the refresh token is revoked
- Rejects new Anthropic tasks when credentials are degraded

**Credential isolation:** The orchestrator reads from the global `~/.claude/.credentials.json` on the host.
For each task, it copies the credentials into the task's session directory (`~/.claude-orchestrator/secrets/{taskId}/`),
which is bind-mounted into the Docker container at `/home/claude/.claude/`. Containers never access the host's global file directly.
When tokens are refreshed, the orchestrator updates both the global file and all active task session directories.

**Re-authentication:** If the refresh token is revoked, SSH tunnel into the VM and run `claude login` again.

Check credential status: `curl http://localhost:8199/health | jq .anthropicOAuth`

#### Health Endpoint Examples

**Healthy (credentials active):**

```json
{
  "status": "ready",
  "capacity": 2,
  "running": 0,
  "available": 2,
  "githubTokenExpiresAt": "2026-02-13T14:30:00.000Z",
  "anthropicOAuth": {
    "status": "active",
    "expiresAt": "2026-02-13T18:00:00.000Z",
    "expiresInMinutes": 210,
    "subscriptionType": "max"
  }
}
```

**Degraded (token expired, awaiting refresh):**

```json
{
  "anthropicOAuth": {
    "status": "expired",
    "message": "Access token expired — awaiting refresh"
  }
}
```

**Not configured (credentials file missing):**

```json
{
  "anthropicOAuth": {
    "status": "not_configured",
    "message": "Anthropic OAuth credentials not found"
  }
}
```

---

## Container Cleanup Cron

The orchestrator's in-process `cleanupOrphanedContainers()` removes stale containers on startup, but containers can also accumulate between restarts (e.g., orchestrator crash, long-running preserved containers). A cron-based cleanup script provides continuous garbage collection of exited `claude-worker-*` containers older than a configurable retention period.

### Scripts

| File                                                       | Purpose                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `workers/scripts/cleanup-containers.sh`                    | Main cleanup script — deletes exited containers past age  |
| `workers/scripts/test-container-cleanup.sh`                | Integration test suite (T1–T12) using real Docker         |
| `workers/scripts/cloud.intexuraos.container-cleanup.plist` | macOS LaunchAgent (6-hour interval)                       |
| `workers/scripts/container-cleanup.service`                | Linux systemd oneshot service                             |
| `workers/scripts/container-cleanup.timer`                  | Linux systemd timer (6-hour interval)                     |
| `workers/scripts/provision-cleanup-cron.sh`                | VM provisioning helper (copies script + installs systemd) |

### How It Works

1. Lists all Docker containers matching the `CONTAINER_PREFIX` (default: `claude-worker-`)
2. Skips **running** containers unconditionally (never killed)
3. Skips containers younger than `RETENTION_DAYS` (default: 1 day)
4. Re-checks container state immediately before removal (TOCTOU protection)
5. Removes eligible containers with `docker rm` (no `-f` flag — running containers fail safely)
6. Queries the orchestrator `/health` endpoint (best-effort, falls back to age-based cleanup)

### Configuration

All via environment variables (all optional):

| Variable           | Default                 | Description                   |
| ------------------ | ----------------------- | ----------------------------- |
| `CONTAINER_PREFIX` | `claude-worker-`        | Docker name prefix to match   |
| `RETENTION_DAYS`   | `1`                     | Age threshold in days         |
| `DRY_RUN`          | `false`                 | Set to `true` to preview only |
| `LOG_FILE`         | (stdout)                | Path to log file              |
| `ORCHESTRATOR_URL` | `http://localhost:8199` | Base URL of the orchestrator  |

### macOS Setup (LaunchAgent)

```bash
# 1. Copy the plist
cp workers/scripts/cloud.intexuraos.container-cleanup.plist \
   ~/Library/LaunchAgents/cloud.intexuraos.container-cleanup.plist

# 2. Edit the script path (ProgramArguments[1]) to your local path

# 3. Load
launchctl load ~/Library/LaunchAgents/cloud.intexuraos.container-cleanup.plist

# 4. Verify
launchctl list | grep intexuraos

# Unload
launchctl unload ~/Library/LaunchAgents/cloud.intexuraos.container-cleanup.plist
```

### Linux Setup (systemd)

**Automated provisioning:**

```bash
sudo ./workers/scripts/provision-cleanup-cron.sh
```

This copies the cleanup script to `/opt/intexuraos/workers/scripts/`, installs the systemd service and timer, configures logrotate, and enables the timer.

**Manual setup:**

```bash
sudo cp workers/scripts/cleanup-containers.sh /opt/intexuraos/workers/scripts/
sudo chmod +x /opt/intexuraos/workers/scripts/cleanup-containers.sh
sudo cp workers/scripts/container-cleanup.service /etc/systemd/system/
sudo cp workers/scripts/container-cleanup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now container-cleanup.timer

# Verify
systemctl list-timers container-cleanup.timer --no-pager

# Manual run
sudo systemctl start container-cleanup.service

# Logs
cat /var/log/intexuraos/container-cleanup.log
```

### Running Tests

```bash
./workers/scripts/test-container-cleanup.sh         # All tests
./workers/scripts/test-container-cleanup.sh T5       # Single test
```

Requires Docker. T1 (no-Docker graceful exit) runs without Docker; T2–T12 are skipped if Docker is unavailable.

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
~/.claude/
+-- .credentials.json       # OAuth credentials (created by `claude login`)

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

| Issue                               | Fix                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Missing `INTEXURAOS_REPOSITORY_URL` | Add to `.envrc.local`, run `direnv allow`                                    |
| 502 from tunnel                     | Orchestrator not running: `pnpm --filter orchestrator dev`                   |
| HMAC signature mismatch             | `dispatchSigningSecret` in UI must match `INTEXURAOS_ORCHESTRATOR_SECRET`    |
| "Secret Manager" fetch failed       | Check `GOOGLE_APPLICATION_CREDENTIALS` path exists                           |
| Tests skipped                       | Check E2E prerequisites above                                                |
| "Network not found"                 | `./scripts/setup-worker-network.sh`                                          |
| "Image not found"                   | `docker build -t claude-worker:test -f Dockerfile.test .`                    |
| Container name conflict             | `docker rm -f $(docker ps -aq --filter name=claude-worker-)`                 |
| OAuth credentials missing           | Run `claude login` on VM (use SSH tunnel for headless)                       |
| OAuth token expired                 | Orchestrator auto-refreshes; if refresh token revoked, re-run `claude login` |

### Worker Image Policy

- Orchestrator pulls the worker image before each new task container.
- Pull failure is fail-fast (no cached-image fallback) to prevent stale runtime behavior.
- Startup logs include requested image ref and resolved digest.
