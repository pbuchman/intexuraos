# Code Worker — Tutorial

Getting started with building, testing, and running the code-worker container image.

> **Time:** 30-45 minutes
> **Prerequisites:** Docker Desktop (or Docker Engine on Linux), access to IntexuraOS repo, `gcloud` CLI authenticated
> **You'll learn:** How to build, run, test, and debug code-worker containers with both Claude and Codex runtimes

---

## Part 1: Build the Image (5 minutes)

### Step 1.1: Build the production image

```bash
./scripts/build-worker-image.sh
```

This builds a multi-arch image (amd64 + arm64) tagged as `europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest` using the `docker/code-worker/Dockerfile`.

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

The test image replaces the real Claude and Codex CLIs with bash stubs for E2E testing without API calls.

```bash
docker build \
  -t code-worker:test \
  -f docker/code-worker/Dockerfile.test \
  docker/code-worker/
```

---

## Part 3: Set Up the Worker Network (2 minutes)

Create the isolated Docker network that worker containers use:

```bash
./scripts/setup-worker-network.sh
```

This creates a non-internal dual-stack Docker bridge named `code-worker-net` on the fixed
Linux interface `code-worker-br`, IPv4 subnet `172.28.0.0/16`, and IPv6 subnet
`fd00:172:28::/64`. IP masquerading is enabled and both gateway modes must be absent
(Docker's `nat` default) or explicitly `nat`. The setup fails closed when a network with
the same name exists but does not satisfy this exact contract.

To verify:

```bash
./scripts/setup-worker-network.sh
```

**Expected output:**

```
Network 'code-worker-net' already exists
Network details:
code-worker-net: 172.28.0.0/16 fd00:172:28::/64
Network setup complete: code-worker-net
```

---

## Part 4: Run a Container Manually (Legacy Mode) (10 minutes)

For one-shot execution, run the selected runtime once and exit:

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

### Step 4.3: Run with Claude runtime (default)

```bash
docker run -it --rm \
  --name code-worker-manual \
  --network code-worker-net \
  --memory 8g \
  --cpus 4 \
  -e TASK_ID=manual-test \
  -e WORKER_RUNTIME=claude \
  -e ANTHROPIC_API_KEY=your-api-key \
  -e ANTHROPIC_BASE_URL=https://api.anthropic.com \
  -e LINEAR_API_KEY=your-linear-key \
  -e ERROR_HUB_HOST=home-dev.tailnet.example:8443 \
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

### Step 4.4: Run with Codex runtime

```bash
docker run -it --rm \
  --name code-worker-codex \
  --network code-worker-net \
  --memory 8g \
  --cpus 4 \
  -e TASK_ID=codex-test \
  -e WORKER_RUNTIME=codex \
  -e CODEX_REASONING_EFFORT=xhigh \
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

**Expected startup output (both runtimes):**

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
[entrypoint] Starting Claude in --print mode...
```

For Codex, the runtime-specific output includes:

```
[entrypoint] Codex runtime evidence: mode=fresh thread_id=absent reasoning_effort=xhigh
[entrypoint] Starting Codex in exec mode...
[entrypoint] Codex reasoning effort: xhigh
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
  -e WORKER_RUNTIME=claude \
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

# Resume continues the previous runtime session (CLAUDE_SESSION_ID required for Claude runtime)
docker exec -e WORKER_CONTINUE=1 -e CLAUDE_SESSION_ID=<session-id-from-previous-attempt> \
  code-worker-managed /entrypoint.sh run-attempt
```

### Step 5.5: Clean up

```bash
docker stop code-worker-managed && docker rm code-worker-managed
```

---

## Part 6: Enable Crash Forensics (5 minutes)

To collect diagnostic data when a runtime crashes:

### Step 6.1: Run with forensics enabled

```bash
mkdir -p /tmp/forensics

docker run -d \
  --name code-worker-forensics \
  --network code-worker-net \
  --memory 8g \
  --cpus 4 \
  -e TASK_ID=forensics-test \
  -e WORKER_RUNTIME=claude \
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

The E2E test suite verifies container lifecycle, mount permissions, input/output, resource limits, timeout handling, and concurrency enforcement for both Claude and Codex runtimes.

### Step 7.1: Build the test image and create the network

```bash
docker build -t code-worker:test -f docker/code-worker/Dockerfile.test docker/code-worker/
./scripts/setup-worker-network.sh
```

### Step 7.2: Run the E2E tests

```bash
WORKER_IMAGE=code-worker:test pnpm --filter orchestrator test:e2e
```

**Expected test suites:**

| Suite               | Tests                                               |
| ------------------- | --------------------------------------------------- |
| Container Lifecycle | Start, destroy, verify logs                         |
| Mount Verification  | /repo writable, /secrets read-only, git             |
| Input/Output        | run-attempt, exit command, error command            |
| Resource Limits     | Usage reporting, memory limit enforcement           |
| Timeout Handling    | Force kill after timeout                            |
| Concurrency         | Max concurrent worker enforcement                   |
| Codex Runtime       | Codex exec, resume, streaming, reasoning effort     |

---

## Part 8: Using the CLI Stubs (Reference)

### Claude Stub (`test-fixtures/claude-stub.sh`)

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

### Codex Stub (`test-fixtures/codex-stub.sh`)

| Input                   | Behavior                                          |
| ----------------------- | ------------------------------------------------- |
| `codex exec - < prompt` | Reads prompt from stdin, echoes completion        |
| `codex exec resume`     | Accepts thread ID, simulates resumed session      |
| `-c` flag               | Accepts and ignores reasoning effort config       |
| `CODEX_STUB_EXIT_CODE`  | Set env var to control exit code (default 0)      |

The stub streams output line-by-line to match real Codex behavior.

---

## Troubleshooting

| Issue                       | Symptom                                                     | Solution                                                                           |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Container exits immediately | `[entrypoint] ERROR: Running as root is forbidden`          | Run with `--user 1001:1001`                                                        |
| GCP auth fails              | `[entrypoint] GCP auth failed (non-fatal)`                  | Verify `/secrets/gcp-sa.json` contains a valid SA key                              |
| Secret sync fails           | `[entrypoint] Secret sync failed (non-fatal...)`            | Check GCP SA has Secret Manager access; existing .envrc used                       |
| No git repo detected        | `[entrypoint] WARNING: /repo is not a git repository`       | Ensure the mounted directory has a `.git` dir or file                              |
| Claude onboarding prompt    | Interactive setup screens on startup                        | Check that config defaults are at `/opt/claude-defaults/`                          |
| Plugins not loaded          | MCP servers fail to start                                   | Check `/opt/claude-plugins/.claude/plugins/` exists in image                       |
| Network not found           | Docker network error on container start                     | Run `./scripts/setup-worker-network.sh` first                                      |
| UID permission denied       | Permission errors writing to /home/claude                   | Verify tmpfs mount has `uid=1001,gid=1001`                                         |
| Token not refreshing        | Stale GitHub token after 1 hour                             | Orchestrator's TokenRefresher must be running                                      |
| run-attempt fails instantly | `[entrypoint] ERROR: Worker not ready`                      | Wait for `/tmp/worker-ready` before calling run-attempt                            |
| run-attempt prompt errors   | `[entrypoint] ERROR: /secrets/system-prompt.txt not found`  | Write prompt files to secrets dir before calling run-attempt                       |
| Claude resume fails         | `CLAUDE_SESSION_ID is required for resumed Claude attempts` | Set `CLAUDE_SESSION_ID` env var when using `WORKER_CONTINUE=1` with Claude runtime |
| Codex resume fails          | `CODEX_THREAD_ID is required for resumed Codex attempts`    | Set `CODEX_THREAD_ID` env var when using `WORKER_CONTINUE=1` with Codex runtime    |
| Unknown runtime             | `Unsupported worker runtime`                                | Set `WORKER_RUNTIME` to `claude` or `codex`                                        |

---

## Next Steps

1. Read the [Technical Reference](technical.md) for full container configuration details
2. Review the [Agent Interface](agent.md) for programmatic orchestrator integration
3. Check [Technical Debt](technical-debt.md) for known issues and planned improvements

---

## Exercises

1. **Easy:** Build the test image and run the `file-test` command to verify mount permissions
2. **Medium:** Start a managed-mode container, run two consecutive attempts (second with `WORKER_CONTINUE=1` and `CLAUDE_SESSION_ID`), and verify session continuity in the logs
3. **Hard:** Start a managed-mode container with `WORKER_RUNTIME=codex`, run an attempt, then resume with `WORKER_CONTINUE=1` and a `CODEX_THREAD_ID`, verifying the Codex runtime evidence log lines

<details>
<summary>Solutions</summary>

### Exercise 1: File Test

```bash
docker build -t code-worker:test -f docker/code-worker/Dockerfile.test docker/code-worker/
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

### Exercise 2: Session Continuity (Claude)

```bash
# Start managed container (use test image)
docker run -d --name continuity-test \
  -e TASK_ID=continuity -e WORKER_MANAGED_MODE=1 \
  -e WORKER_RUNTIME=claude \
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

# Resume attempt (CLAUDE_SESSION_ID required for Claude runtime)
echo "Follow-up task" > /tmp/test-secrets/user-prompt.txt
docker exec -e WORKER_CONTINUE=1 -e CLAUDE_SESSION_ID=<session-id> \
  continuity-test /entrypoint.sh run-attempt

# Check logs for both attempts
docker logs continuity-test | grep "run-attempt\|Resuming"

docker stop continuity-test && docker rm continuity-test
```

### Exercise 3: Codex Runtime with Resume

```bash
# Start managed container with Codex runtime
docker run -d --name codex-resume-test \
  -e TASK_ID=codex-resume -e WORKER_MANAGED_MODE=1 \
  -e WORKER_RUNTIME=codex \
  -e GIT_USER_NAME="Test" -e GIT_USER_EMAIL="test@test.com" \
  -v /tmp/test-repo:/repo:rw -v /tmp/test-secrets:/secrets:ro \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --tmpfs /home/claude:rw,noexec,nosuid,size=100m,uid=1001,gid=1001 \
  --user 1001:1001 code-worker:test

# Wait for ready
until docker exec codex-resume-test test -f /tmp/worker-ready; do sleep 1; done

# First attempt
echo "Implement a hello world function" > /tmp/test-secrets/user-prompt.txt
docker exec codex-resume-test /entrypoint.sh run-attempt

# Verify Codex evidence in logs
docker logs codex-resume-test | grep "Codex runtime evidence"
# Expected: mode=fresh thread_id=absent reasoning_effort=default

# Resume with thread ID
echo "Add tests for the function" > /tmp/test-secrets/user-prompt.txt
docker exec -e WORKER_CONTINUE=1 -e CODEX_THREAD_ID=thread_abc123 \
  codex-resume-test /entrypoint.sh run-attempt

# Verify resume evidence
docker logs codex-resume-test | grep "Codex runtime evidence"
# Expected: mode=resume thread_id=present reasoning_effort=default

docker stop codex-resume-test && docker rm codex-resume-test
```

</details>
