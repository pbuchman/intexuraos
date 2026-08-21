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
export INTEXURAOS_REPOSITORY_PATH=$HOME/.code-orchestrator/repo
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
mkdir -p ~/.code-orchestrator/logs ~/code-workers/worktrees
```

### Step 5: Set up Docker network

The code-worker containers need a Docker network:

```bash
./scripts/setup-worker-network.sh
```

Verify:

```bash
docker network inspect code-worker-net
```

### Step 6: Set up worker auth

**Claude auth (required for Anthropic worker types):**

```bash
claude login
```

For headless machines, use SSH reverse tunnel:

```bash
# From workstation:
ssh -R 8080:localhost:8080 user@orchestrator-vm
# On VM:
claude login
```

**Codex auth (required for Codex worker types):**

```bash
workers/orchestrator/scripts/codex-login.sh
```

### Step 7: Start the orchestrator

```bash
pnpm --filter orchestrator dev
```

Expected output:

```
INFO: Starting orchestrator { port: 8199, capacity: 2 }
INFO: Fetching GitHub private key from Secret Manager...
INFO: Repository path exists, validating...
INFO: Repository validation passed
INFO: Code worker auth active { expiresInMinutes: 210, subscriptionType: 'max' }
INFO: Codex worker auth active { authMode: 'chatgpt', expiresInMinutes: 190 }
INFO: Completion verification configuration (deterministic parser + resume-summary LLM) { completionMaxAttempts: 3, validationModels: [ 'or:google/gemma-4-31b-it', 'or:deepseek/deepseek-v4-flash' ] }
INFO: Agent compliance validator configuration { validationModels: [ 'or:google/gemma-4-31b-it', 'or:deepseek/deepseek-v4-flash' ], hasOpenRouterApiKey: true }
INFO: Orchestrator HTTP server started { port: 8199 }
INFO: No interrupted tasks to recover
INFO: Starting heartbeat manager { intervalMs: 600000 }
INFO: Orchestrator ready
```

### Step 8: Verify health

```bash
curl http://localhost:8199/health | jq
```

Expected response:

```json
{
  "healthContractVersion": 1,
  "status": "ready",
  "capacity": 2,
  "running": 0,
  "available": 2,
  "githubTokenExpiresAt": "2026-04-22T15:30:00.000Z",
  "workerAuths": {
    "claude": { "status": "active", "authMode": "oauth", "refreshSupported": true, "expiresInMinutes": 210, "subscriptionType": "max" },
    "codex": { "status": "active", "authMode": "chatgpt", "refreshSupported": true, "expiresInMinutes": 190 }
  },
  "dockerHealthy": true,
  "diskHealthy": true,
  "providerApiKeys": {
    "OPENROUTER_API_KEY": { "configured": true }
  }
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

The `workerType` field controls which runtime handles the task. Valid values are `auto`, `opus`, `sonnet`, `codex`, `codex-xhigh`, and `openrouter-free`. OpenRouter is the only provider-key route; Claude and Codex use subscription authentication.

```bash
BODY='{
  "taskId": "task_00000000-0000-4000-8000-000000000001",
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
  "taskId": "task_00000000-0000-4000-8000-000000000001",
  "status": "accepted"
}
```

### Step 3: Submit a Codex task

To run a task through the Codex runtime instead of Claude:

```bash
BODY='{
  "taskId": "task_00000000-0000-4000-8000-000000000002",
  "workerType": "codex",
  "prompt": "Implement the feature described in INT-500",
  "agentType": "execution",
  "linearIssueId": "INT-500",
  "linearIssueLabels": ["code-task"],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'
```

For high-effort Codex tasks, use `codex-xhigh`.

### Step 4: Submit a planning task

To route a task through the planning agent flow:

```bash
BODY='{
  "taskId": "task_00000000-0000-4000-8000-000000000003",
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

### Step 5: Submit an execution task with continuation PR

When retrying a task, pass the existing PR details and optionally reference the original task:

```bash
BODY='{
  "taskId": "task_00000000-0000-4000-8000-000000000004",
  "workerType": "opus",
  "prompt": "Continue implementation for INT-500",
  "agentType": "execution",
  "retriedFrom": "task_00000000-0000-4000-8000-000000000099",
  "continuationPrNumber": 42,
  "continuationPrBranch": "task_abc123",
  "linearIssueId": "INT-500",
  "linearIssueLabels": ["code-task"],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'
```

### Step 6: Submit a review task with test quality and documentation review

```bash
BODY='{
  "taskId": "task_00000000-0000-4000-8000-000000000005",
  "workerType": "auto",
  "prompt": "Review PR #42 — validate implementation, test quality, and documentation",
  "agentType": "review",
  "reviewTypes": ["code_quality", "test_quality", "documentation"],
  "linearIssueId": "INT-500",
  "linearIssueLabels": [],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'
```

Available review types: `code_quality`, `security`, `architecture`, `plan_review`, `test_quality`, `documentation`. The `documentation` scope, added for PR #2130, checks docs against the implementation, repository paths, commands, APIs, configuration, terminology, and links.

### Step 7: Start an Ask Agent session

For interactive Q&A (no PR creation, no Linear management):

```bash
BODY='{
  "taskId": "task_00000000-0000-4000-8000-000000000006",
  "workerType": "auto",
  "prompt": "Explain the caching strategy in user-service",
  "agentType": "ask_agent",
  "linearIssueLabels": [],
  "hasChildren": false,
  "webhookUrl": "http://localhost:3001/webhook",
  "webhookSecret": "test-secret-123"
}'
```

Follow up with messages:

```bash
BODY='{"message": "How does cache invalidation work when a user updates their profile?"}'
# (generate HMAC headers as before)
curl -X POST http://localhost:8199/tasks/task_00000000-0000-4000-8000-000000000006/message ...
```

### Step 8: Monitor the task

Check task status:

```bash
curl http://localhost:8199/tasks/task_00000000-0000-4000-8000-000000000001 | jq
```

Watch Docker container logs:

```bash
docker logs -f code-worker-task_00000000-0000-4000-8000-000000000001
```

View orchestrator health:

```bash
curl http://localhost:8199/health | jq
```

Check worker image info:

```bash
curl http://localhost:8199/meta/worker-image | jq
```

### Step 10: Send a message to a running task

Messages can be sent to running, completed, or failed tasks. For running tasks, the message is queued and delivered when the current attempt finishes. For completed or failed tasks, the task is resumed with a new worker session.

```bash
BODY='{"message": "Please also add unit tests for the edge cases"}'

eval $(bash sign-request.sh "$BODY")

curl -X POST http://localhost:8199/tasks/task_00000000-0000-4000-8000-000000000001/message \
  -H "Content-Type: application/json" \
  -H "X-Dispatch-Timestamp: ${TIMESTAMP}" \
  -H "X-Dispatch-Nonce: ${NONCE}" \
  -H "X-Dispatch-Signature: ${SIGNATURE}" \
  -d "$BODY"
```

The message field supports up to 20,000 characters. Review and remediation tasks reject messages with `409`.

### Step 11: Cancel a task

```bash
curl -X DELETE http://localhost:8199/tasks/task_00000000-0000-4000-8000-000000000001
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
cd docker/code-worker
docker build -t code-worker:test -f Dockerfile.test .
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

### systemd Setup (Linux)

The orchestrator runs as a systemd template service (`intexuraos-orchestrator@.service`):

```bash
sudo systemctl enable intexuraos-orchestrator@pbuchman
sudo systemctl start intexuraos-orchestrator@pbuchman

# Logs
journalctl -u intexuraos-orchestrator@pbuchman -f

# Restart after rebuild
sudo systemctl restart intexuraos-orchestrator@pbuchman
```

### macOS LaunchAgent

Create `~/Library/LaunchAgents/com.intexuraos.orchestrator.plist` (see README for template), then:

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

| Symptom                                           | Cause                                 | Fix                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTEXURAOS_REPOSITORY_URL not set`               | Missing env var                       | Add to `.envrc.local`, run `direnv allow`                                                                                                         |
| `Secret Manager fetch failed`                     | Wrong credentials path                | Verify `GOOGLE_APPLICATION_CREDENTIALS` file exists                                                                                               |
| `502 from tunnel`                                 | Orchestrator not running              | Start with `pnpm --filter orchestrator dev`                                                                                                       |
| `401 Invalid signature`                           | HMAC secret mismatch                  | Match `INTEXURAOS_ORCHESTRATOR_SECRET` with UI setting                                                                                            |
| Docker `name already in use`                      | Orphaned container from previous run  | Periodic stale cleanup handles this; manual: `docker rm -f $(docker ps -aq --filter name=code-worker-)`                                           |
| `Network not found`                               | Missing Docker network                | `./scripts/setup-worker-network.sh`                                                                                                               |
| `Image not found`                                 | Code worker image not pulled/built    | `docker pull europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest`                                            |
| Tests skipped (E2E)                               | Docker network or test image missing  | See Part 3 prerequisites                                                                                                                          |
| `Cannot find module '@intexuraos'`                | Packages not built                    | Run `pnpm build` at repository root                                                                                                               |
| Turn metrics always zero                          | macOS host (no cgroup v2 exposure)    | Expected on macOS; metrics are non-fatal and show zeros                                                                                           |
| `INTEXURAOS_OPENROUTER_APP_API_KEY not set`       | Missing required env var              | Populate the Secret Manager version and rerun secret sync                                                                                         |
| `TASK_RUNTIME_HARD_ERROR`                         | Worker/runtime failure or verifier hard error | Inspect the terminal logs and retry only after the runtime error is understood                                                              |
| `503 docker_unavailable`                          | Docker daemon not responding          | Check Docker Desktop is running                                                                                                                   |
| `503 auth_unavailable`                            | Worker auth not ready                 | Check `workerAuths` in health endpoint; run `claude login` or `codex-login.sh`                                                                    |
| Container creation timeout                        | Docker pull or create taking too long | Check network for image pull; image pull has 15-minute timeout, container create has 2-minute timeout                                             |
| Task adopted on restart but fails immediately     | Container state drift                 | Check Docker logs for the container before adoption                                                                                               |
| No compliance report on PR                        | Missing OpenRouter API key            | Set `INTEXURAOS_OPENROUTER_APP_API_KEY` in `.envrc`                                                                                               |
| `Port 8199 is already in use`                     | Another process on same port          | Find the process: `lsof -i :8199`; or use a different port: `export PORT=8200`                                                                    |
| Task killed after 10 minutes of silence           | Inactivity detector triggered         | Expected behavior; session auto-restarts up to 3 times before failing                                                                             |
