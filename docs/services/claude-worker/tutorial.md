# Claude Worker - Tutorial

Getting started with building, testing, and running the claude-worker container image.

## Prerequisites

- Docker Desktop running (or Docker Engine on Linux)
- Access to the IntexuraOS repository
- `gcloud` CLI authenticated (for pushing to GCR)

## Part 1: Build the Image

### Step 1: Build the production image

```bash
./scripts/build-worker-image.sh
```

This builds the image tagged as `gcr.io/intexuraos-dev-pbuchman/claude-worker:latest` using the `workers/claude-worker/Dockerfile`.

To build with a custom tag:

```bash
./scripts/build-worker-image.sh v1.2.3
```

### Step 2: Verify the image

Check the image exists and inspect its size:

```bash
docker images gcr.io/intexuraos-dev-pbuchman/claude-worker:latest
```

### Step 3: Push to GCR (optional)

```bash
PUSH=true ./scripts/build-worker-image.sh latest
```

## Part 2: Build the Test Image

The test image replaces the real Claude CLI with a bash stub for E2E testing without API calls.

```bash
docker build \
  -t claude-worker:test \
  -f workers/claude-worker/Dockerfile.test \
  workers/claude-worker/
```

## Part 3: Set Up the Worker Network

Create the isolated Docker network that worker containers use:

```bash
./scripts/setup-worker-network.sh
```

This creates a bridge network named `claude-worker-net` on subnet `172.28.0.0/16`.

To verify:

```bash
docker network inspect claude-worker-net --format '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

**Expected output:**

```
claude-worker-net: 172.28.0.0/16
```

## Part 4: Run a Container Manually (Legacy Mode)

For one-shot execution, run Claude once and exit:

### Step 1: Prepare a test repository

```bash
mkdir -p /tmp/test-repo && cd /tmp/test-repo
git init && echo "# Test" > README.md && git add . && git commit -m "init"
```

### Step 2: Prepare a secrets directory with prompt files

```bash
mkdir -p /tmp/test-secrets
echo '{"type": "service_account"}' > /tmp/test-secrets/gcp-sa.json
echo "ghp_test_token_here" > /tmp/test-secrets/github-token
echo "You are a helpful coding assistant." > /tmp/test-secrets/system-prompt.txt
echo "List the files in the repository." > /tmp/test-secrets/user-prompt.txt
```

### Step 3: Run the container

```bash
docker run -it --rm \
  --name claude-worker-manual \
  --network claude-worker-net \
  --memory 8g \
  --cpus 4 \
  -e TASK_ID=manual-test \
  -e ANTHROPIC_API_KEY=your-api-key \
  -e ANTHROPIC_BASE_URL=https://api.anthropic.com \
  -e LINEAR_API_KEY=your-linear-key \
  -e SENTRY_AUTH_TOKEN=your-sentry-token \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json \
  -e GIT_USER_NAME="Test User" \
  -e GIT_USER_EMAIL="test@example.com" \
  -v /tmp/test-repo:/repo:rw \
  -v /tmp/test-secrets:/secrets:ro \
  --tmpfs /tmp:rw,noexec,nosuid,size=2g \
  --tmpfs /home/claude:rw,noexec,nosuid,size=500m,uid=1001,gid=1001 \
  --cap-drop ALL \
  --cap-add NET_RAW \
  --security-opt no-new-privileges \
  --user 1001:1001 \
  gcr.io/intexuraos-dev-pbuchman/claude-worker:latest
```

**Expected startup output:**

```
[entrypoint] Claude worker starting at Thu Feb 19 12:00:00 UTC 2026
[entrypoint] Task ID: manual-test
[entrypoint] Running as user: claude (uid=1001)
[entrypoint] Claude config defaults restored
[entrypoint] Git repo verified: /repo
[entrypoint] GCP auth successful
[entrypoint] GitHub token loaded and git credential configured
[entrypoint] Installing dependencies...
[entrypoint] Dependencies installed
[entrypoint] Attribution set: Crafted with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
[entrypoint] Writing readiness marker
[entrypoint] Starting Claude...
```

## Part 5: Run a Container in Managed Mode

Managed mode keeps the container alive across multiple attempts (used by the orchestrator for retries and resumes):

### Step 1: Start the container in managed mode

```bash
docker run -d \
  --name claude-worker-managed \
  --network claude-worker-net \
  --memory 8g \
  --cpus 4 \
  -e TASK_ID=managed-test \
  -e ANTHROPIC_API_KEY=your-api-key \
  -e ANTHROPIC_BASE_URL=https://api.anthropic.com \
  -e CLAUDE_MANAGED_MODE=1 \
  -e GIT_USER_NAME="Test User" \
  -e GIT_USER_EMAIL="test@example.com" \
  -v /tmp/test-repo:/repo:rw \
  -v /tmp/test-secrets:/secrets:ro \
  --tmpfs /tmp:rw,noexec,nosuid,size=2g \
  --tmpfs /home/claude:rw,noexec,nosuid,size=500m,uid=1001,gid=1001 \
  --cap-drop ALL \
  --cap-add NET_RAW \
  --security-opt no-new-privileges \
  --user 1001:1001 \
  gcr.io/intexuraos-dev-pbuchman/claude-worker:latest
```

### Step 2: Wait for the readiness marker

```bash
# Poll for the readiness marker
until docker exec claude-worker-managed test -f /tmp/worker-ready 2>/dev/null; do
  echo "Waiting for worker to be ready..."
  sleep 2
done
echo "Worker is ready!"
```

### Step 3: Write prompt files and invoke an attempt

```bash
# Update prompt files (secrets dir is read-only inside container, write from host)
echo "You are a helpful coding assistant." > /tmp/test-secrets/system-prompt.txt
echo "List the files in the /repo directory." > /tmp/test-secrets/user-prompt.txt

# Run the attempt
docker exec claude-worker-managed /entrypoint.sh run-attempt
```

### Step 4: Run a resume attempt

```bash
# Update prompt for follow-up
echo "Now show me the README content." > /tmp/test-secrets/user-prompt.txt

# Resume continues the previous Claude session
docker exec -e CLAUDE_CONTINUE=1 claude-worker-managed /entrypoint.sh run-attempt
```

### Step 5: Clean up

```bash
docker stop claude-worker-managed && docker rm claude-worker-managed
```

## Part 6: Run E2E Tests

The E2E test suite verifies container lifecycle, mount permissions, input/output, resource limits, timeout handling, and concurrency enforcement.

### Step 1: Build the test image and create the network

```bash
docker build -t claude-worker:test -f workers/claude-worker/Dockerfile.test workers/claude-worker/
docker network create --driver bridge --subnet 172.28.0.0/16 claude-worker-net 2>/dev/null || true
```

### Step 2: Run the E2E tests

```bash
WORKER_IMAGE=claude-worker:test WORKER_NETWORK=claude-worker-net pnpm --filter orchestrator test:e2e
```

**Expected test suites:**

| Suite               | Tests                                     |
| ------------------- | ----------------------------------------- |
| Container Lifecycle | Start, destroy, verify logs               |
| Mount Verification  | /repo writable, /secrets read-only, git   |
| Input/Output        | run-attempt, exit command, error command  |
| Resource Limits     | Usage reporting, memory limit enforcement |
| Timeout Handling    | Force kill after timeout                  |
| Concurrency         | Max concurrent worker enforcement         |

## Part 7: Using the Claude Stub

The test stub at `test-fixtures/claude-stub.sh` supports these commands for E2E verification:

| Command         | Behavior                                                  |
| --------------- | --------------------------------------------------------- |
| `exit`          | Clean shutdown (exit code 0)                              |
| `error`         | Simulated failure (exit code 1)                           |
| `timeout`       | Sleep 3600s (triggers timeout handling)                   |
| `network-test`  | Checks public internet, metadata server, localhost access |
| `resource-test` | Reports cgroup memory and CPU limits                      |
| `file-test`     | Tests write access to /repo, /secrets, /tmp               |
| Any other text  | Echoes "Acknowledged" + "Task completed successfully"     |

The stub supports both interactive stdin mode and `--print` mode (reads from stdin redirect). It detects `--print` in its arguments to match the entrypoint's actual Claude invocation.

## Troubleshooting

| Issue                        | Symptom                                                   | Solution                                                   |
| ---------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Container exits immediately  | `[entrypoint] ERROR: Running as root is forbidden`        | Run with `--user 1001:1001`                                |
| GCP auth fails               | `[entrypoint] GCP auth failed (non-fatal)`                | Verify `/secrets/gcp-sa.json` contains a valid SA key      |
| No git repo detected         | `[entrypoint] WARNING: /repo is not a git repository`     | Ensure the mounted directory has a `.git` dir or file      |
| Claude onboarding prompt     | Interactive setup screens on startup                      | Check that config defaults are at `/opt/claude-defaults/`  |
| Network not found            | Docker network error on container start                   | Run `./scripts/setup-worker-network.sh` first              |
| UID permission denied        | Permission errors writing to /home/claude                 | Verify tmpfs mount has `uid=1001,gid=1001`                 |
| Token not refreshing         | Stale GitHub token after 1 hour                           | Orchestrator's TokenRefresher must be running              |
| run-attempt fails instantly  | `[entrypoint] ERROR: Worker not ready`                    | Wait for `/tmp/worker-ready` before calling run-attempt    |
| run-attempt prompt errors    | `[entrypoint] ERROR: /secrets/system-prompt.txt not found` | Write prompt files to secrets dir before calling run-attempt |
| pnpm install slow            | Long startup time on every container                      | Expected — pnpm store is on tmpfs and cold-starts each time |
