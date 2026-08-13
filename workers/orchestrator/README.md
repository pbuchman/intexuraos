# Orchestrator

Local worker orchestration service for code task execution.

## Overview

The orchestrator runs on local machines (Mac or VM) behind Cloudflare Tunnel. It receives task dispatch requests from `code-agent`, spawns Claude Code or Codex sessions in isolated Docker containers, and reports results via webhooks.

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
- Execution verification is semantic validation through OpenRouter (latest response first, prior responses fallback)
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
    +- TaskDispatcher: manages code-worker runtime sessions via Docker
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

The host renderer fetches one exact numeric DEV package version and merges its
validated env projection with repository-backed configuration. The systemd
service never receives the full host environment or Secret Manager access:
`scripts/generate-orchestrator-env.mjs` writes its strict mode-`0600` env file,
and the DEV package's GitHub App PEM is rendered to a protected host path.
`.envrc.local` is only for host-specific non-secret overrides.

### Required (startup fails if missing)

| Variable                            | Source                    | Description                                                                                                        |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `INTEXURAOS_REPOSITORY_URL`         | versioned config          | GitHub repo URL for clone/fetch                                                                                    |
| `INTEXURAOS_CODE_AGENT_URL`         | host default/override     | Webhook callback URL                                                                                               |
| `INTEXURAOS_ORCHESTRATOR_SECRET`    | DEV projection            | HMAC signing secret                                                                                                |
| `INTEXURAOS_USAGE_WEBHOOK_URL`      | `.envrc.local`            | Usage events webhook URL (code-agent gateway)                                                                      |
| `INTEXURAOS_PROJECT_ID`             | generated                 | Retained GCP project metadata                                                                                      |
| `INTEXURAOS_ENVIRONMENT`            | generated                 | Fixed home-dev environment tag (`dev`)                                                                             |
| `INTEXURAOS_RUNTIME`                | generated                 | Fixed home-dev runtime tag (`dev`)                                                                                 |
| `INTEXURAOS_GITHUB_APP_ID`          | versioned config          | GitHub App ID                                                                                                      |
| `INTEXURAOS_GITHUB_INSTALLATION_ID` | versioned config          | GitHub App installation ID                                                                                         |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`    | DEV projection            | Service-to-service auth                                                                                            |
| `INTEXURAOS_LINEAR_API_KEY`         | DEV projection            | Linear API key (passed only to eligible workers)                                                                   |
| `INTEXURAOS_ERROR_HUB_HOST`         | `.envrc.local`            | Private SentryBox `.ts.net:8443` host for workers                                                                  |
| `INTEXURAOS_MINIMAX_APP_API_KEY`    | DEV projection            | MiniMax worker API key                                                                                             |
| `INTEXURAOS_MIMO_APP_API_KEY`       | DEV projection            | MiMo worker API key                                                                                                |
| `INTEXURAOS_DASHSCOPE_APP_API_KEY`  | DEV projection            | Dashscope worker API key                                                                                           |
| `INTEXURAOS_KIMI_APP_API_KEY`       | DEV projection            | Kimi Code worker API key                                                                                           |
| `INTEXURAOS_OPENROUTER_APP_API_KEY` | DEV projection            | OpenRouter validation API key                                                                                      |
| `GITHUB_APP_PRIVATE_KEY_PATH`       | rendered DEV file         | Mode-`0600` GitHub App PEM path                                                                                    |
| `GOOGLE_APPLICATION_CREDENTIALS`    | generator-fixed host path | `${HOME}/.config/intexuraos/home-orchestrator-sa-key.json`; dedicated Artifact Registry reader, never a DEV member |

### Optional

| Variable                                    | Default                                                  | Description                                                                                 |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `INTEXURAOS_REPOSITORY_PATH`                | `~/.code-orchestrator/repo`                              | Local repo clone path                                                                       |
| `INTEXURAOS_WORKER_CAPACITY`                | `3`                                                      | Max concurrent tasks                                                                        |
| `INTEXURAOS_CODE_WORKER_IMAGE`              | `.../code-worker:latest`                                 | Worker image reference (tag or digest)                                                      |
| `INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS` | `or:google/gemma-4-31b-it,or:deepseek/deepseek-v4-flash` | Comma-separated OpenRouter model list for completion verification and compliance validation |
| `INTEXURAOS_PRESERVE_WORKER_CONTAINERS`     | `1`                                                      | Keep worker containers after task completion for debugging                                  |
| `INTEXURAOS_GIT_USER_NAME`                  | Host `git config user.name`                              | Git author name for worker commits                                                          |
| `INTEXURAOS_GIT_USER_EMAIL`                 | Host `git config user.email`                             | Git author email for worker commits                                                         |
| `PORT`                                      | `8199`                                                   | HTTP server port                                                                            |
| `LOG_LEVEL`                                 | `info`                                                   | Pino log level                                                                              |

---

## Local Development Setup

### Prerequisites

Node.js 22+, Docker, gcloud CLI, cloudflared. pnpm is needed for building, not at runtime.

### Steps

```bash
# 1. Clone and install
git clone https://github.com/pbuchman/intexuraos.git && cd intexuraos
pnpm install && pnpm build

# 2. Render one reviewed version. On home-dev, select the renderer credential
# for this command only; do not export it into .envrc or the systemd service.
SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS=/home/pbuchman/.config/intexuraos/secret-renderer-sa-key.json \
  ./scripts/sync-secrets.sh --version <dev-numeric-version>
# Local Mac should instead use user ADC + impersonation of
# ixos-home-secret-renderer-dev.

# 3. Copy .envrc.local.example to .envrc.local and set only required host paths/
# URLs. Do not copy package values or an operator/provisioner credential into it.

# 4. Reload env
direnv allow

# 5. Create directories
mkdir -p ~/.code-orchestrator/logs ~/code-workers/worktrees

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
- Env vars loaded from mode-600 `~/.code-orchestrator/env` (strict generated allowlist)
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
set -a && source ~/.code-orchestrator/env && set +a

# 3. Run with tsx watch (hot-reload on source changes)
pnpm --filter orchestrator dev

# 4. When done, restore the service
# Press Ctrl+C to stop dev mode, then:
sudo systemctl start intexuraos-orchestrator@pbuchman
```

#### Updating Runtime Configuration Or Secrets

The orchestrator env file and GitHub App PEM are not auto-synced. Regenerate
them after a versioned configuration change or DEV package promotion:

```bash
# 1. Fetch/validate one exact DEV version and render the host projection
cd ~/deploy/intexuraos
SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/intexuraos/secret-renderer-sa-key.json" \
  ./scripts/sync-secrets.sh --version <dev-numeric-version>

# 2. Source .envrc plus the final .envrc.local overrides and generate only the
# orchestrator allowlist. The generator writes atomically with mode 0600.
direnv exec . node scripts/generate-orchestrator-env.mjs \
  --output "$HOME/.code-orchestrator/env"

# 3. Verify the PEM/env owners and modes without printing content, then restart
stat -c '%U:%G %a %n' \
  "$HOME/.code-orchestrator/env" \
  "$HOME/.code-orchestrator/github-app.pem"
sudo systemctl restart intexuraos-orchestrator@pbuchman
curl -fsS http://localhost:8199/health | jq .
```

The orchestrator reads the rendered files only. Its principal must fail any
direct Secret Manager access attempt. Start one code-worker canary, confirm its
environment/file names match the task allowlist and it cannot access Secret
Manager, then replace remaining workers. Do not print worker environment values.
The generator always replaces any inherited `GOOGLE_APPLICATION_CREDENTIALS`
with `${HOME}/.config/intexuraos/home-orchestrator-sa-key.json`; that dedicated
identity can only pull from the DEV Artifact Registry repository. It is a host
bootstrap file, is never packaged, and is never forwarded to a code worker.

#### Full Recovery (from scratch)

If the orchestrator needs to be set up from zero on a new machine:

```bash
# 1. Create directories
mkdir -p ~/.code-orchestrator/secrets ~/.code-orchestrator/logs
mkdir -p ~/code-workers/worktrees

# 2. Clone orchestrator repo
git clone git@github.com:pbuchman/intexuraos.git ~/.code-orchestrator/repo

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

# Optional: bootstrap shared Codex auth for code-worker
workers/orchestrator/scripts/codex-login.sh

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
    <string>/Users/YOUR_USERNAME/.code-orchestrator/logs/orchestrator.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.code-orchestrator/logs/orchestrator.err.log</string>
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
   - host-rendered DEV projection: `INTEXURAOS_ORCHESTRATOR_SECRET`
   - IntexuraOS UI: Worker Settings -> your worker -> `dispatchSigningSecret`

Both must match or task dispatch fails signature verification.

### GitHub Private Key

The GitHub App private key is rendered from the exact DEV package version to
`~/.code-orchestrator/github-app.pem` as mode `0600` before startup. The
orchestrator reads that path and never calls Secret Manager. Rotate it by
publishing a complete DEV candidate, canarying token issuance, promoting the
numeric version, and retaining the prior package version for package-wide
rollback.

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

## Worker Auth

### Claude Auth (Anthropic Max Subscription)

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
For each task, it copies the credentials into the task's session directory (`~/.code-orchestrator/secrets/{taskId}/`),
which is bind-mounted into the Docker container at `/home/claude/.claude/`. Containers never access the host's global file directly.
When tokens are refreshed, the orchestrator updates both the global file and all active task session directories.

**Re-authentication:** If the refresh token is revoked, SSH tunnel into the VM and run `claude login` again.

### Codex Auth

Codex uses a separate shared auth file mounted into code-worker containers. Bootstrap it with:

```bash
workers/orchestrator/scripts/codex-login.sh
```

Inside the container, run `codex login --device-auth` and complete the ChatGPT device-auth flow.

This writes shared auth to `~/.code-orchestrator/codex-auth/auth.json`.

Check worker auth status: `curl http://localhost:8199/health | jq .workerAuths`

#### Health Endpoint Examples

**Healthy (worker auth active):**

```json
{
  "status": "ready",
  "capacity": 2,
  "running": 0,
  "available": 2,
  "githubTokenExpiresAt": "2026-02-13T14:30:00.000Z",
  "workerAuths": {
    "claude": {
      "status": "active",
      "authMode": "oauth",
      "refreshSupported": true,
      "expiresAt": "2026-02-13T18:00:00.000Z",
      "expiresInMinutes": 210,
      "subscriptionType": "max"
    },
    "codex": {
      "status": "active",
      "authMode": "chatgpt",
      "refreshSupported": true,
      "expiresAt": "2026-02-13T17:40:00.000Z",
      "expiresInMinutes": 190,
      "lastRefreshAt": "2026-02-13T14:25:00.000Z"
    }
  }
}
```

**Degraded (one provider expired, awaiting refresh):**

```json
{
  "workerAuths": {
    "claude": {
      "status": "expired",
      "authMode": "oauth",
      "refreshSupported": true,
      "message": "Access token expired - awaiting refresh"
    },
    "codex": {
      "status": "active",
      "authMode": "chatgpt",
      "refreshSupported": true
    }
  }
}
```

**Not configured (provider auth missing):**

```json
{
  "workerAuths": {
    "claude": {
      "status": "active",
      "authMode": "oauth",
      "refreshSupported": true
    },
    "codex": {
      "status": "not_configured",
      "authMode": null,
      "refreshSupported": false,
      "message": "Codex auth not found"
    }
  }
}
```

---

## Container Cleanup Cron

The orchestrator's in-process `cleanupOrphanedContainers()` removes stale containers on startup, but containers can also accumulate between restarts (e.g., orchestrator crash, long-running preserved containers). A cron-based cleanup script provides continuous garbage collection of exited `code-worker-*` containers older than a configurable retention period.

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

1. Lists all Docker containers matching the `CONTAINER_PREFIX` (default: `code-worker-`)
2. Skips **running** containers unconditionally (never killed)
3. Skips containers younger than `RETENTION_DAYS` (default: 1 day)
4. Re-checks container state immediately before removal (TOCTOU protection)
5. Removes eligible containers with `docker rm` (no `-f` flag — running containers fail safely)
6. Queries the orchestrator `/health` endpoint (best-effort, falls back to age-based cleanup)

### Configuration

All via environment variables (all optional):

| Variable           | Default                 | Description                   |
| ------------------ | ----------------------- | ----------------------------- |
| `CONTAINER_PREFIX` | `code-worker-`          | Docker name prefix to match   |
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

| Requirement    | Check Command                           | Install                           |
| -------------- | --------------------------------------- | --------------------------------- |
| Docker daemon  | `docker info`                           | Docker Desktop                    |
| Docker network | `./scripts/setup-worker-network.sh`     | Same command creates or validates |
| Test image     | `docker image inspect code-worker:test` | See below                         |

```bash
# Setup
./scripts/setup-worker-network.sh
cd docker/code-worker && docker build -t code-worker:test -f Dockerfile.test .
cd ../../workers/orchestrator && pnpm test:e2e
```

---

## Directory Structure

```
~/.claude/
+-- .credentials.json       # OAuth credentials (created by `claude login`)

~/code-workers/
+-- worktrees/              # Git worktrees for tasks (auto-created)

~/.code-orchestrator/
+-- github-app.pem          # GitHub App private key (host-rendered DEV projection)
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
| Missing `INTEXURAOS_REPOSITORY_URL` | Validate `config/environments/common.json`, then rerun sync and generator    |
| 502 from tunnel                     | Orchestrator not running: `pnpm --filter orchestrator dev`                   |
| HMAC signature mismatch             | `dispatchSigningSecret` in UI must match `INTEXURAOS_ORCHESTRATOR_SECRET`    |
| DEV package render failed           | Verify external renderer identity, numeric version, CRC/schema, and manifest |
| GitHub App PEM missing              | Re-render the same DEV version; verify mode `0600`; do not fetch in process  |
| Tests skipped                       | Check E2E prerequisites above                                                |
| "Network not found"                 | `./scripts/setup-worker-network.sh`                                          |
| "Image not found"                   | `docker build -t code-worker:test -f Dockerfile.test .`                      |
| Container name conflict             | `docker rm -f $(docker ps -aq --filter name=code-worker-)`                   |
| OAuth credentials missing           | Run `claude login` on VM (use SSH tunnel for headless)                       |
| OAuth token expired                 | Orchestrator auto-refreshes; if refresh token revoked, re-run `claude login` |

### Worker Image Policy

- Orchestrator pulls the worker image before each new task container.
- Pull failure is fail-fast (no cached-image fallback) to prevent stale runtime behavior.
- Startup logs include requested image ref and resolved digest.
