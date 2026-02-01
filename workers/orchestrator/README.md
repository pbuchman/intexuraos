# Orchestrator

Local worker orchestration service for code task execution.

## Overview

The orchestrator runs on local machines (Mac or VM) behind Cloudflare Tunnel. It receives task dispatch requests from `code-agent`, spawns Claude Code sessions in isolated git worktrees, and reports results via webhooks.

```
code-agent (Cloud Run)
    │
    ▼ POST /tasks (HMAC signed)
orchestrator (local)
    │
    ├─ TaskDispatcher: manages Claude Code sessions via tmux
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

## Development Setup

### Prerequisites

- **Node.js 22+** - Required for `--experimental-strip-types`
- **pnpm** - Workspace package manager
- **cloudflared** - Cloudflare Tunnel client (`brew install cloudflared`)
- **gcloud CLI** - For fetching secrets from GCP
- **tmux** - For managing Claude Code sessions

### 1. Create Directory Structure

```bash
# Orchestrator state and logs
mkdir -p ~/.claude-orchestrator/logs

# Worktrees for task execution
mkdir -p ~/claude-workers/worktrees
```

### 2. Configure GCP Authentication

```bash
# Set up gcloud with the dev service account
gcloud auth activate-service-account --key-file=$HOME/personal/gcloud-claude-code-dev.json

# Or set env var for this session
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json
```

### 3. Create Environment File

The orchestrator requires several secrets. The **DISPATCH_SECRET** is particularly important - it must match the `dispatchSigningSecret` configured in your IntexuraOS worker settings.

#### HMAC Signing (DISPATCH_SECRET)

The `DISPATCH_SECRET` is used for HMAC signature verification between code-agent and orchestrator:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HMAC Signing Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Your Machine (orchestrator)              Cloud (code-agent)               │
│   ┌─────────────────────────────┐         ┌─────────────────────────────┐   │
│   │  ~/.claude-orchestrator/    │         │  Firestore                  │   │
│   │  .env:                      │◄─MUST───│  workerSettings/{userId}    │   │
│   │    DISPATCH_SECRET=abc123   │  MATCH  │    dispatchSigningSecret    │   │
│   │                             │         │    =abc123 (encrypted)      │   │
│   └─────────────────────────────┘         └─────────────────────────────┘   │
│              ▲                                        │                      │
│              │ 2. Verifies signature                  │ 1. Signs request     │
│              └────────────── POST /tasks ─────────────┘                     │
│                            X-Signature: hmac(...)                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Setup Steps

1. **Generate a signing secret** (run once, save the output):

   ```bash
   openssl rand -hex 32
   ```

2. **Configure in IntexuraOS** (via web UI or API):
   - Go to Settings → Worker Configuration
   - Add your worker with the signing secret you generated
   - This stores the secret (encrypted) in Firestore for code-agent to use

3. **Create the env file**:

   ```bash
   cat > ~/.claude-orchestrator/.env << 'EOF'
   PORT=8199
   WORKER_CAPACITY=1

   # HMAC signing secret - MUST match your IntexuraOS worker settings
   DISPATCH_SECRET=<paste-your-generated-secret-here>

   # GitHub App credentials (fetch from GCP Secret Manager)
   EOF

   # Append GitHub secrets
   echo "GH_APP_ID=$(gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_APP_ID --project=intexuraos-dev-pbuchman)" >> ~/.claude-orchestrator/.env
   echo "GH_INSTALLATION_ID=$(gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_INSTALLATION_ID --project=intexuraos-dev-pbuchman)" >> ~/.claude-orchestrator/.env

   # Private key needs special handling (multiline)
   gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_APP_PRIVATE_KEY --project=intexuraos-dev-pbuchman > ~/.claude-orchestrator/github-app.pem
   echo "GH_PRIVATE_KEY_PATH=$HOME/.claude-orchestrator/github-app.pem" >> ~/.claude-orchestrator/.env
   ```

> **Important:** The `DISPATCH_SECRET` in your local `.env` MUST match the `dispatchSigningSecret` you configured in IntexuraOS worker settings. If they don't match, task dispatch requests will fail signature verification.

### 4. Verify Cloudflare Tunnel

The tunnel should already be running as a system service (installed via `sudo cloudflared service install`).

```bash
# Check tunnel is running
ps aux | grep cloudflared

# Test tunnel connectivity (should get 502 if orchestrator not running, or 200 if running)
curl -s -o /dev/null -w "%{http_code}" https://cc-mac.intexuraos.cloud/health
```

---

## Development Workflow

### Start Dev Server (with auto-reload)

```bash
cd /path/to/intexuraos-3/workers/orchestrator

# Load environment
set -a; source ~/.claude-orchestrator/.env; set +a

# Start with watch mode (auto-reloads on file changes)
pnpm dev
```

The dev server:

- Runs on `localhost:8199` (same port as production)
- Uses `node --watch` for automatic reload on changes
- Cloudflare Tunnel routes `cc-mac.intexuraos.cloud` → `localhost:8199`

### Testing Changes

1. Edit code in `src/`
2. Server auto-reloads (watch mode)
3. Test via tunnel: `curl https://cc-mac.intexuraos.cloud/health`

### Running Tests

```bash
pnpm test        # Run once
pnpm test:watch  # Watch mode
```

### Type Checking

```bash
pnpm typecheck
```

---

## Production Deployment

### Build

```bash
cd /path/to/intexuraos-3
pnpm --filter orchestrator build
```

This creates `workers/orchestrator/dist/index.js` - a bundled ESM file with all workspace dependencies inlined.

### Directory Structure

```
~/claude-workers/
├── worktrees/           # Git worktrees for tasks (auto-created)
└── logs/                # Cleanup logs

~/.claude-orchestrator/
├── .env                 # Environment variables
├── github-app.pem       # GitHub App private key
├── state.json           # Task state (auto-created)
├── github-token         # Current GitHub token (auto-created)
└── logs/
    └── {taskId}.log     # Per-task logs
```

### LaunchAgent Setup (Auto-start on Login)

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
        <string>/Users/YOUR_USERNAME/path/to/intexuraos-3/workers/orchestrator/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/path/to/intexuraos-3/workers/orchestrator</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>8080</string>
        <key>WORKER_CAPACITY</key>
        <string>1</string>
        <!-- Add other env vars or use .env file -->
    </dict>
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
# Load (start) the service
launchctl load ~/Library/LaunchAgents/com.intexuraos.orchestrator.plist

# Unload (stop) the service
launchctl unload ~/Library/LaunchAgents/com.intexuraos.orchestrator.plist

# Check status
launchctl list | grep orchestrator

# View logs
tail -f ~/.claude-orchestrator/logs/orchestrator.out.log
tail -f ~/.claude-orchestrator/logs/orchestrator.err.log
```

---

## Configuration Reference

### Environment Variables

| Variable              | Required | Default | Description                                                                               |
| --------------------- | -------- | ------- | ----------------------------------------------------------------------------------------- |
| `PORT`                | No       | 8199    | HTTP server port                                                                          |
| `WORKER_CAPACITY`     | No       | 1       | Max concurrent tasks                                                                      |
| `DISPATCH_SECRET`     | Yes      | -       | HMAC secret for verifying code-agent requests. **Must match IntexuraOS worker settings.** |
| `GH_APP_ID`           | Yes      | -       | GitHub App ID                                                                             |
| `GH_INSTALLATION_ID`  | Yes      | -       | GitHub App installation ID                                                                |
| `GH_PRIVATE_KEY_PATH` | Yes      | -       | Path to GitHub App private key (PEM file)                                                 |

### DISPATCH_SECRET Setup

The `DISPATCH_SECRET` is a shared secret between your orchestrator and code-agent:

1. **Generate once:** `openssl rand -hex 32`
2. **Store in two places:**
   - **Local:** `~/.claude-orchestrator/.env` as `DISPATCH_SECRET`
   - **IntexuraOS:** Worker Settings → your worker → `dispatchSigningSecret`

The code-agent reads the secret from Firestore (encrypted), the orchestrator reads from local env. They must match.

### GCP Secrets (GitHub App Only)

| Secret Name                         | Description                  |
| ----------------------------------- | ---------------------------- |
| `INTEXURAOS_GITHUB_APP_ID`          | GitHub App ID: 2753232       |
| `INTEXURAOS_GITHUB_INSTALLATION_ID` | Installation ID: 106781840   |
| `INTEXURAOS_GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM) |

> **Note:** `INTEXURAOS_ORCHESTRATOR_SECRET` in GCP is deprecated for multi-user setups. Each user should generate their own secret and configure it in their IntexuraOS worker settings.

### Fetching GitHub Secrets

```bash
export PROJECT=intexuraos-dev-pbuchman
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json

gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_APP_ID --project=$PROJECT
gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_INSTALLATION_ID --project=$PROJECT
gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_APP_PRIVATE_KEY --project=$PROJECT
```

---

## Quick Start (Development)

```bash
# 1. Create directories
mkdir -p ~/.claude-orchestrator/logs ~/claude-workers/worktrees

# 2. Generate your dispatch signing secret (save this!)
DISPATCH_SECRET=$(openssl rand -hex 32)
echo "Your DISPATCH_SECRET: $DISPATCH_SECRET"
echo "⚠️  Save this! You'll need to configure the same secret in IntexuraOS worker settings."

# 3. Set up environment (first time only)
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json
cat > ~/.claude-orchestrator/.env << EOF
PORT=8199
WORKER_CAPACITY=1
DISPATCH_SECRET=$DISPATCH_SECRET
GH_APP_ID=$(gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_APP_ID --project=intexuraos-dev-pbuchman)
GH_INSTALLATION_ID=$(gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_INSTALLATION_ID --project=intexuraos-dev-pbuchman)
GH_PRIVATE_KEY_PATH=$HOME/.claude-orchestrator/github-app.pem
EOF
gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_APP_PRIVATE_KEY --project=intexuraos-dev-pbuchman > ~/.claude-orchestrator/github-app.pem

# 4. Configure IntexuraOS worker settings
#    Go to IntexuraOS → Settings → Worker Configuration
#    Add your worker with the DISPATCH_SECRET from step 2

# 5. Start dev server
cd /path/to/intexuraos-3/workers/orchestrator
set -a; source ~/.claude-orchestrator/.env; set +a
pnpm dev

# 6. Test (in another terminal)
curl https://cc-mac.intexuraos.cloud/health
```
