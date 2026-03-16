# Orchestrator — Tutorial

This tutorial walks through setting up the orchestrator from scratch, verifying it works, and submitting your first code task.

## Prerequisites

- Node.js 22+
- pnpm
- Docker Desktop (running)
- gcloud CLI (authenticated)
- cloudflared (for remote access)
- Access to GCP Secret Manager (`intexuraos-dev-pbuchman` project)

## Part 1: Initial Setup

### Step 1: Clone and build

```bash
git clone https://github.com/pbuchman/intexuraos.git
cd intexuraos
pnpm install
pnpm build
```

### Step 2: Sync secrets from GCP

```bash
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json
PROJECT_ID=intexuraos-dev-pbuchman ./scripts/sync-secrets.sh

# Optional: prompt for missing Terraform-defined secret values
PROJECT_ID=intexuraos-dev-pbuchman ./scripts/sync-secrets.sh --add-new
```

This creates `.envrc` with secrets from Secret Manager and reports any missing/unreadable secrets.

### Step 3: Configure local overrides

Create `.envrc.local` with orchestrator-specific variables:

```bash
cat >> .envrc.local << 'EOF'
export INTEXURAOS_REPOSITORY_URL=https://github.com/pbuchman/intexuraos.git
export INTEXURAOS_REPOSITORY_PATH=$HOME/.claude-orchestrator/repo
export INTEXURAOS_PROJECT_ID=intexuraos-dev-pbuchman
export INTEXURAOS_CODE_AGENT_URL=https://intexuraos-code-agent-cj44trunra-lm.a.run.app/
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json
EOF
```

Reload environment:

```bash
direnv allow
```

### Step 4: Create required directories

```bash
mkdir -p ~/.claude-orchestrator/logs ~/claude-workers/worktrees
```

### Step 5: Set up Docker network

The claude-worker containers need a Docker network:

```bash
./scripts/setup-worker-network.sh
```

Verify:

```bash
docker network inspect claude-worker-net
```

### Step 6: Start the orchestrator

```bash
pnpm --filter orchestrator dev
```

Expected output:

```
INFO: Starting orchestrator { port: 8199, capacity: 2 }
INFO: Fetching GitHub private key from Secret Manager...
INFO: Repository path exists, validating...
INFO: Repository validation passed
INFO: Completion verification configuration { completionMaxAttempts: 3, verifier: { enabled: true, provider: 'gemini', model: 'gemini-2.5-flash' } }
INFO: Orchestrator HTTP server started { port: 8199 }
INFO: No interrupted tasks to recover
INFO: Starting heartbeat manager { intervalMs: 600000 }
INFO: Orchestrator ready
```

### Step 7: Verify health

```bash
curl http://localhost:8199/health | jq
```

Expected response:

```json
{
  "status": "ready",
  "capacity": 2,
  "running": 0,
  "available": 2,
  "githubTokenExpiresAt": "2026-03-15T15:30:00.000Z",
  "anthropicOAuth": { "status": "active", "expiresInMinutes": 45, "subscriptionType": "max" },
  "dockerHealthy": true,
  "diskHealthy": true
}
```

## Part 2: Submit a Task

Tasks are submitted by code-agent via HMAC-signed requests. To test manually, generate the required headers.

### Step 1: Generate HMAC signature

Create a helper script `sign-request.sh`:

```bash
#!/bin/bash
SECRET="${INTEXURAOS_ORCHESTRATOR_SECRET}"
TIMESTAMP=$(date +%s%3N)
NONCE=$(openssl rand -hex 16)
BODY="$1"

MESSAGE="${TIMESTAMP}.${NONCE}.${BODY}"
SIGNATURE=$(echo -n "${MESSAGE}" | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $2}')

echo "X-Dispatch-Timestamp: ${TIMESTAMP}"
echo "X-Dispatch-Nonce: ${NONCE}"
echo "X-Dispatch-Signature: ${SIGNATURE}"
```

### Step 2: Submit a task

The `workerType` field controls which AI model handles the task. Valid types are `opus`, `auto`, `sonnet` (Anthropic), `minimax` (MiniMax), and `glm`, `qwen`, `kimi` (Alibaba Cloud DashScope).

```bash
BODY='{
  "taskId": "test-task-001",
  "workerType": "auto",
  "prompt": "Create a hello world test file",
  "linearIssueLabels": ["code-task"],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'

# Generate headers
eval $(bash sign-request.sh "$BODY")

curl -X POST http://localhost:8199/tasks \
  -H "Content-Type: application/json" \
  -H "X-Dispatch-Timestamp: ${TIMESTAMP}" \
  -H "X-Dispatch-Nonce: ${NONCE}" \
  -H "X-Dispatch-Signature: ${SIGNATURE}" \
  -d "$BODY"
```

Expected response:

```json
{
  "taskId": "test-task-001",
  "status": "accepted"
}
```

### Step 3: Submit a planning task with agent type

To route a task through the planning agent flow, include `agentType` and the relevant labels:

```bash
BODY='{
  "taskId": "plan-task-001",
  "workerType": "opus",
  "prompt": "Analyze INT-500 and design the implementation approach",
  "agentType": "planning",
  "linearIssueId": "INT-500",
  "linearIssueTitle": "Add OAuth support",
  "linearIssueLabels": ["code-task"],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'
```

For execution tasks that follow a planning phase, include the planning PR branch so the orchestrator merges it into the execution worktree:

```bash
BODY='{
  "taskId": "exec-task-001",
  "workerType": "opus",
  "prompt": "Implement the approved plan for INT-500",
  "agentType": "execution",
  "planningPrBranch": "planning/INT-500-add-oauth-support",
  "planningPrUrl": "https://github.com/pbuchman/intexuraos/pull/42",
  "linearIssueId": "INT-500",
  "linearIssueTitle": "Add OAuth support",
  "linearIssueLabels": ["code-task"],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'
```

### Step 4: Submit a task that continues an existing PR

When retrying a task, pass the existing PR details so the worker builds on previous work:

```bash
BODY='{
  "taskId": "retry-task-001",
  "workerType": "opus",
  "prompt": "Continue implementation for INT-500",
  "agentType": "execution",
  "continuationPrNumber": 42,
  "continuationPrBranch": "task_abc123",
  "linearIssueId": "INT-500",
  "linearIssueLabels": ["code-task"],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'
```

### Step 5: Submit a review task

To dispatch an automated code review:

```bash
BODY='{
  "taskId": "review-task-001",
  "workerType": "auto",
  "prompt": "Review PR #42 for code quality, security, and architecture",
  "agentType": "review",
  "linearIssueId": "INT-500",
  "linearIssueLabels": [],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'
```

### Step 6: Monitor the task

Check task status:

```bash
curl http://localhost:8199/tasks/test-task-001 | jq
```

Watch Docker container logs:

```bash
docker logs -f claude-worker-test-task-001
```

View orchestrator health:

```bash
curl http://localhost:8199/health | jq
```

### Step 7: Send a message to a running task

Messages can be sent to running, completed, or failed tasks. For running tasks, the message is queued and delivered when the current attempt finishes. For completed or failed tasks, the task is resumed with a new worker session.

```bash
BODY='{"message": "Please also add unit tests for the edge cases"}'

eval $(bash sign-request.sh "$BODY")

curl -X POST http://localhost:8199/tasks/test-task-001/message \
  -H "Content-Type: application/json" \
  -H "X-Dispatch-Timestamp: ${TIMESTAMP}" \
  -H "X-Dispatch-Nonce: ${NONCE}" \
  -H "X-Dispatch-Signature: ${SIGNATURE}" \
  -d "$BODY"
```

The message field supports up to 20,000 characters.

### Step 8: Cancel a task

```bash
curl -X DELETE http://localhost:8199/tasks/test-task-001
```

## Part 3: Running Tests

### Unit tests

```bash
pnpm --filter orchestrator test
```

### Type checking

```bash
pnpm --filter orchestrator typecheck
```

### E2E tests (require Docker)

Build the test image first:

```bash
cd workers/claude-worker
docker build -t claude-worker:test -f Dockerfile.test .
cd ../..
```

Run E2E tests:

```bash
pnpm --filter orchestrator test:e2e
```

## Part 4: Production Deployment

### Build the artifact

```bash
pnpm --filter orchestrator build
```

This produces `workers/orchestrator/dist/index.js` — a bundled ESM file.

### Run in production

```bash
node workers/orchestrator/dist/index.js
```

### Set up macOS LaunchAgent

Create `~/Library/LaunchAgents/com.intexuraos.orchestrator.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
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

Manage the service:

```bash
launchctl load ~/Library/LaunchAgents/com.intexuraos.orchestrator.plist    # Start
launchctl unload ~/Library/LaunchAgents/com.intexuraos.orchestrator.plist  # Stop
launchctl list | grep orchestrator                                          # Status
```

## Part 5: Cloudflare Tunnel

### Install

```bash
brew install cloudflared
sudo cloudflared service install
```

### Verify tunnel

```bash
ps aux | grep cloudflared
```

### Test through tunnel

```bash
curl -H "CF-Access-Client-Id: <client-id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://cc-mac.intexuraos.cloud/health
```

## Troubleshooting

| Symptom                                           | Cause                                | Fix                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTEXURAOS_REPOSITORY_URL not set`               | Missing env var                      | Add to `.envrc.local`, run `direnv allow`                                                                                                         |
| `Secret Manager fetch failed`                     | Wrong credentials path               | Verify `GOOGLE_APPLICATION_CREDENTIALS` file exists                                                                                               |
| `502 from tunnel`                                 | Orchestrator not running             | Start with `pnpm --filter orchestrator dev`                                                                                                       |
| `401 Invalid signature`                           | HMAC secret mismatch                 | Match `INTEXURAOS_ORCHESTRATOR_SECRET` with UI setting                                                                                            |
| Docker `name already in use`                      | Orphaned container from previous run | Periodic stale cleanup handles this; manual: `docker rm -f $(docker ps -aq --filter name=claude-worker-)`                                         |
| `Network not found`                               | Missing Docker network               | `./scripts/setup-worker-network.sh`                                                                                                               |
| `Image not found`                                 | Claude worker image not pulled/built | `docker pull europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest`; or set `INTEXURAOS_CLAUDE_WORKER_IMAGE` |
| Tests skipped (E2E)                               | Docker network or test image missing | See Part 3 prerequisites                                                                                                                          |
| `Cannot find module '@intexuraos'`                | Packages not built                   | Run `pnpm build` at repository root                                                                                                               |
| Turn metrics always zero                          | macOS host (no cgroup v2 exposure)   | Expected on macOS; metrics are non-fatal and show zeros when cgroup path is unavailable                                                           |
| `INTEXURAOS_GEMINI_APP_API_KEY not set`           | Missing required env var             | Add to `.envrc.local` and run `direnv allow`; completion verification is always required                                                          |
| Tasks fail with `TASK_COMPLETION_VERIFIER_FAILED` | Gemini API unreachable               | Check network connectivity and Gemini API key validity; tasks fail rather than complete unverified                                                |
| `INTEXURAOS_MINIMAX_APP_API_KEY not set`          | Missing MiniMax API key              | Required if dispatching `minimax` worker type tasks; add to `.envrc.local`                                                                        |
| `INTEXURAOS_DASHSCOPE_APP_API_KEY not set`        | Missing DashScope API key            | Required if dispatching `glm`, `qwen`, or `kimi` worker type tasks; add to `.envrc.local`                                                         |
| Task adopted on restart but fails immediately     | Container state drift                | Container was running but in a bad state; check Docker logs for the container before it was adopted                                               |
| `503 docker_unavailable`                          | Docker daemon not responding         | Check Docker Desktop is running; the health gate rejects tasks when Docker is unreachable                                                         |
| Container creation timeout                        | Docker pull or create taking > 2min  | Check network connectivity for image pull; check Docker disk space                                                                                |
