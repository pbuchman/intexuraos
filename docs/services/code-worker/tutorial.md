# Code Worker - Tutorial

Getting started with building, testing, and running the code-worker container image.

> **Time:** 30-45 minutes
> **Prerequisites:** Docker Desktop (or Docker Engine on Linux), access to IntexuraOS repo, `gcloud` CLI authenticated
> **You'll learn:** How to build, run, test, and debug code-worker containers

---

## Part 1: Build the Image (5 minutes)

### Step 1.1: Build the production image

```bash
./scripts/build-worker-image.sh
```

This builds a multi-arch image (amd64 + arm64) tagged as `europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest` using the `workers/code-worker/Dockerfile`.

To build with a custom tag:

```bash
./scripts/build-worker-image.sh v1.2.3
```

### Step 1.2: Verify the image

Check the image exists and inspect its size:

```bash
docker images europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest
```

### Step 1.3: Push to Artifact Registry (optional)

```bash
PUSH=true ./scripts/build-worker-image.sh latest
```

This pushes a multi-arch manifest (amd64 + arm64) so the image runs natively on both x86_64 servers and Apple Silicon Macs.

---

## Part 2: Build the Test Image (3 minutes)

The test image replaces the real Claude CLI with a bash stub for E2E testing without API calls.

```bash
docker build \
  -t code-worker:test \
  -f workers/code-worker/Dockerfile.test \
  workers/code-worker/
```

---

## Part 3: Set Up the Worker Network (2 minutes)

Create the isolated Docker network that worker containers use:

```bash
./scripts/setup-worker-network.sh
```

This creates a bridge network named `code-worker-net` on subnet `172.28.0.0/16`.

To verify:

```bash
docker network inspect code-worker-net --format '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

**Expected output:**

```
code-worker-net: 172.28.0.0/16
```

---

## Part 4: Run a Container Manually (Legacy Mode) (10 minutes)

For one-shot execution, run Claude once and exit:

### Step 4.1: Prepare a test repository

```bash
mkdir -p /tmp/test-repo && cd /tmp/test-repo
git init && echo "# Test" > README.md && git add . && git commit -m "init"
```

### Step 4.2: Prepare a secrets directory with prompt files

```bash
mkdir -p /tmp/test-secrets
echo '{"type": "service_account"}' > /tmp/test-secrets/gcp-sa.json
echo "ghp_test_token_here" > /tmp/test-secrets/github-token
echo "You are a helpful coding assistant." > /tmp/test-secrets/system-prompt.txt
echo "List the files in the repository." > /tmp/test-secrets/user-prompt.txt
```

### Step 4.3: Run the container

```bash
docker run -it --rm \
  --name code-worker-manual \
  --network code-worker-net \
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
  europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest
```

**Expected startup output:**

```
[entrypoint] Code worker starting at Thu Feb 19 12:00:00 UTC 2026
[entrypoint] Task ID: manual-test
[entrypoint] Running as user: claude (uid=1001)
[entrypoint] Claude config defaults restored
[entrypoint] Plugin cache restored (2 marketplaces)
[entrypoint] Codex skill discovery restored
[entrypoint] Git repo verified: /repo
[entrypoint] GCP auth successful
[entrypoint] Syncing secrets from GCP Secret Manager...
[entrypoint] Secret sync complete
[entrypoint] Loaded environment from /repo/.envrc (15 vars)
[entrypoint] GitHub token loaded and git credential configured
[entrypoint] Bootstrap evidence: codex_skills=restored github_token=loaded gcp_auth=active secret_sync=synced envrc=loaded
[entrypoint] Installing dependencies...
[entrypoint] Dependencies installed
[entrypoint] Attribution set: Crafted with love by ...
[entrypoint] Writing readiness marker
[entrypoint] Starting Claude...
```

---

## Part 5: Run a Container in Managed Mode (10 minutes)

Managed mode keeps the container alive across multiple attempts (used by the orchestrator for retries and resumes):

### Step 5.1: Start the container in managed mode

```bash
docker run -d \
  --name code-worker-managed \
  --network code-worker-net \
  --memory 8g \
  --cpus 4 \
  -e TASK_ID=managed-test \
  -e ANTHROPIC_API_KEY=your-api-key \
  -e ANTHROPIC_BASE_URL=https://api.anthropic.com \
  -e WORKER_MANAGED_MODE=1 \
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
  europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest
```

### Step 5.2: Wait for the readiness marker

```bash
# Poll for the readiness marker
until docker exec code-worker-managed test -f /tmp/worker-ready 2>/dev/null; do
  echo "Waiting for worker to be ready..."
  sleep 2
done
echo "Worker is ready!"
```

### Step 5.3: Write prompt files and invoke an attempt

```bash
# Update prompt files (secrets dir is read-only inside container, write from host)
echo "You are a helpful coding assistant." > /tmp/test-secrets/system-prompt.txt
echo "List the files in the /repo directory." > /tmp/test-secrets/user-prompt.txt

# Run the attempt
docker exec code-worker-managed /entrypoint.sh run-attempt
```

### Step 5.4: Run a resume attempt

```bash
# Update prompt for follow-up
echo "Now show me the README content." > /tmp/test-secrets/user-prompt.txt

# Resume continues the previous runtime session
docker exec -e WORKER_CONTINUE=1 code-worker-managed /entrypoint.sh run-attempt
```

### Step 5.5: Clean up

```bash
docker stop code-worker-managed && docker rm code-worker-managed
```

---

## Part 6: Enable Crash Forensics (5 minutes)

To collect diagnostic data when Claude crashes:

### Step 6.1: Run with forensics enabled

```bash
mkdir -p /tmp/forensics

docker run -d \
  --name code-worker-forensics \
  --network code-worker-net \
  --memory 8g \
  --cpus 4 \
  -e TASK_ID=forensics-test \
  -e ANTHROPIC_API_KEY=your-api-key \
  -e WORKER_MANAGED_MODE=1 \
  -e WORKER_FORENSICS=1 \
  -e WORKER_FORENSICS_DIR=/var/crash \
  -e GIT_USER_NAME="Test User" \
  -e GIT_USER_EMAIL="test@example.com" \
  -v /tmp/test-repo:/repo:rw \
  -v /tmp/test-secrets:/secrets:ro \
  -v /tmp/forensics:/var/crash:rw \
  --tmpfs /tmp:rw,noexec,nosuid,size=2g \
  --tmpfs /home/claude:rw,noexec,nosuid,size=500m,uid=1001,gid=1001 \
  --cap-drop ALL \
  --cap-add NET_RAW \
  --security-opt no-new-privileges \
  --user 1001:1001 \
  europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest
```

### Step 6.2: Inspect forensics after a crash

```bash
# List forensics directories (one per attempt)
ls /tmp/forensics/

# Read the crash summary
cat /tmp/forensics/attempt-*/crash-summary.txt

# Check the exit code
cat /tmp/forensics/attempt-*/claude-exit-code.txt
```

### Step 6.3: Clean up

```bash
docker stop code-worker-forensics && docker rm code-worker-forensics
```

---

## Part 7: Run E2E Tests (5 minutes)

The E2E test suite verifies container lifecycle, mount permissions, input/output, resource limits, timeout handling, and concurrency enforcement.

### Step 7.1: Build the test image and create the network

```bash
docker build -t code-worker:test -f workers/code-worker/Dockerfile.test workers/code-worker/
docker network create --driver bridge --subnet 172.28.0.0/16 code-worker-net 2>/dev/null || true
```

### Step 7.2: Run the E2E tests

```bash
WORKER_IMAGE=code-worker:test WORKER_NETWORK=code-worker-net pnpm --filter orchestrator test:e2e
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

---

## Part 8: Using the Claude Stub (Reference)

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

---

## Troubleshooting

| Issue                       | Symptom                                                    | Solution                                                     |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| Container exits immediately | `[entrypoint] ERROR: Running as root is forbidden`         | Run with `--user 1001:1001`                                  |
| GCP auth fails              | `[entrypoint] GCP auth failed (non-fatal)`                 | Verify `/secrets/gcp-sa.json` contains a valid SA key        |
| Secret sync fails           | `[entrypoint] Secret sync failed (non-fatal...)`           | Check GCP SA has Secret Manager access; existing .envrc used |
| No git repo detected        | `[entrypoint] WARNING: /repo is not a git repository`      | Ensure the mounted directory has a `.git` dir or file        |
| Claude onboarding prompt    | Interactive setup screens on startup                       | Check that config defaults are at `/opt/claude-defaults/`    |
| Plugins not loaded          | MCP servers fail to start                                  | Check `/opt/claude-plugins/.claude/plugins/` exists in image |
| Network not found           | Docker network error on container start                    | Run `./scripts/setup-worker-network.sh` first                |
| UID permission denied       | Permission errors writing to /home/claude                  | Verify tmpfs mount has `uid=1001,gid=1001`                   |
| Token not refreshing        | Stale GitHub token after 1 hour                            | Orchestrator's TokenRefresher must be running                |
| run-attempt fails instantly | `[entrypoint] ERROR: Worker not ready`                     | Wait for `/tmp/worker-ready` before calling run-attempt      |
| run-attempt prompt errors   | `[entrypoint] ERROR: /secrets/system-prompt.txt not found` | Write prompt files to secrets dir before calling run-attempt |

---

## Next Steps

1. Read the [Technical Reference](technical.md) for full container configuration details
2. Review the [Agent Interface](agent.md) for programmatic orchestrator integration
3. Check [Technical Debt](technical-debt.md) for known issues and planned improvements

---

## Exercises

1. **Easy:** Build the test image and run the `file-test` command to verify mount permissions
2. **Medium:** Start a managed-mode container, run two consecutive attempts (second with `--continue`), and verify session continuity in the logs
3. **Hard:** Enable forensics mode, trigger a simulated crash via the test stub's `error` command, and inspect the forensics output directory

<details>
<summary>Solutions</summary>

### Exercise 1: File Test

```bash
docker build -t code-worker:test -f workers/code-worker/Dockerfile.test workers/code-worker/
mkdir -p /tmp/test-repo /tmp/test-secrets
cd /tmp/test-repo && git init && echo "test" > README.md && git add . && git commit -m "init"
echo "You are a test assistant." > /tmp/test-secrets/system-prompt.txt
echo "file-test" > /tmp/test-secrets/user-prompt.txt

docker run --rm \
  --name file-test \
  -e TASK_ID=file-test \
  -e GIT_USER_NAME="Test" -e GIT_USER_EMAIL="test@test.com" \
  -v /tmp/test-repo:/repo:rw \
  -v /tmp/test-secrets:/secrets:ro \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --tmpfs /home/claude:rw,noexec,nosuid,size=100m,uid=1001,gid=1001 \
  --user 1001:1001 \
  code-worker:test
```

Expected: `/repo: WRITABLE`, `/secrets: READ-ONLY (good)`, `/tmp: WRITABLE`

### Exercise 2: Session Continuity

```bash
# Start managed container (use test image)
docker run -d --name continuity-test \
  -e TASK_ID=continuity -e WORKER_MANAGED_MODE=1 \
  -e GIT_USER_NAME="Test" -e GIT_USER_EMAIL="test@test.com" \
  -v /tmp/test-repo:/repo:rw -v /tmp/test-secrets:/secrets:ro \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --tmpfs /home/claude:rw,noexec,nosuid,size=100m,uid=1001,gid=1001 \
  --user 1001:1001 code-worker:test

# Wait for ready
until docker exec continuity-test test -f /tmp/worker-ready; do sleep 1; done

# First attempt
echo "First task" > /tmp/test-secrets/user-prompt.txt
docker exec continuity-test /entrypoint.sh run-attempt

# Resume attempt
echo "Follow-up task" > /tmp/test-secrets/user-prompt.txt
docker exec -e WORKER_CONTINUE=1 continuity-test /entrypoint.sh run-attempt

# Check logs for both attempts
docker logs continuity-test | grep "run-attempt\|Resuming"

docker stop continuity-test && docker rm continuity-test
```

### Exercise 3: Forensics

```bash
mkdir -p /tmp/forensics
docker run -d --name forensics-test \
  -e TASK_ID=forensics -e WORKER_MANAGED_MODE=1 \
  -e WORKER_FORENSICS=1 -e WORKER_FORENSICS_DIR=/var/crash \
  -e GIT_USER_NAME="Test" -e GIT_USER_EMAIL="test@test.com" \
  -v /tmp/test-repo:/repo:rw -v /tmp/test-secrets:/secrets:ro \
  -v /tmp/forensics:/var/crash:rw \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --tmpfs /home/claude:rw,noexec,nosuid,size=100m,uid=1001,gid=1001 \
  --user 1001:1001 code-worker:test

until docker exec forensics-test test -f /tmp/worker-ready; do sleep 1; done

echo "error" > /tmp/test-secrets/user-prompt.txt
docker exec forensics-test /entrypoint.sh run-attempt || true

# Inspect forensics
ls /tmp/forensics/attempt-*/
cat /tmp/forensics/attempt-*/claude-exit-code.txt  # Should show "1"

docker stop forensics-test && docker rm forensics-test
```

</details>
