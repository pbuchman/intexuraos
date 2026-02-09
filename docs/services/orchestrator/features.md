# Orchestrator

The local worker orchestration engine that dispatches code tasks to isolated Docker containers running Claude Code, manages git worktrees, and reports results via signed webhooks.

## The Problem

Executing autonomous AI code tasks against a real codebase requires solving several hard problems simultaneously:

1. **Isolation** - AI agents need filesystem access but must not interfere with each other or the host system
2. **Secret management** - GitHub tokens, API keys, and GCP credentials must reach containers securely and stay fresh
3. **Concurrency** - Multiple code tasks must run in parallel without resource conflicts or git branch collisions
4. **Observability** - Long-running autonomous tasks (up to 2 hours) need real-time log streaming and heartbeat monitoring
5. **Reliability** - Crash recovery, webhook retry queues, and state persistence across restarts are essential for unattended operation
6. **Two-phase execution** - Not every task should jump straight to code; some need design validation first

## How It Helps

The orchestrator runs on a local machine (macOS or Predev VM) behind a Cloudflare Tunnel and solves all six problems:

1. **Docker isolation** - Each task runs in a dedicated container with dropped capabilities, read-only secrets, memory limits, and `no-new-privileges` security
2. **Token lifecycle** - GitHub App installation tokens are minted via JWT, written to per-task secret directories, and refreshed every 30 minutes while a task runs
3. **Git worktree parallelism** - Each task gets its own worktree branched from the target base, preventing any cross-task git state corruption
4. **Real-time log forwarding** - Container stdout streams to the code-agent via chunked, HMAC-signed HTTP uploads at 3-second intervals
5. **Crash-safe state** - Atomic JSON file persistence, pending webhook queues with 24-hour TTL, and startup recovery that notifies code-agent of interrupted tasks
6. **System prompt phases** - Linear issue labels determine whether a worker enters Phase 1 (design and validation) or Phase 2 (strict autonomous execution)

## Use Cases

### Autonomous Code Execution

The code-agent (Cloud Run) dispatches a task to the orchestrator:

- Orchestrator creates a worktree on the `development` branch
- Spawns a Docker container with Claude Code in interactive mode
- Injects a Phase 2 system prompt (the issue has the `code-task` label)
- Claude reads the Linear issue, writes tests, implements code, runs CI, creates a PR
- Orchestrator detects container exit, checks for a PR via `gh`, and sends a webhook back with the result

### Design Validation (Phase 1)

For new issues without the `code-task` label:

- The orchestrator builds a Phase 1 system prompt
- Claude analyzes the issue, enriches the description, creates sub-issues, and adds the appropriate label (`code-task` or `unclear`)
- No code changes are committed in this phase

### Parent Issue Execution

When a Linear issue has child sub-tasks:

- The system prompt includes a `PARENT EXECUTION MODE` section
- Claude executes all children on a single branch, commits after each, and maintains a progress log in the PR description

### Multi-Worker Concurrency

The orchestrator supports configurable capacity (default: 2 concurrent tasks):

- Atomic capacity checks via mutex prevent over-scheduling
- Each task gets independent worktree, container, secrets directory, and log forwarder
- The health endpoint reports running count, available slots, and GitHub token expiry

## Key Capabilities

| Capability                | Description                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Docker container creation | Spawns Claude Code workers with security hardening (dropped caps, tmpfs, etc.)                |
| Git worktree management   | Creates and removes isolated worktrees per task                                               |
| HMAC request signing      | Nonce + timestamp + HMAC-SHA256 verification on all dispatch requests                         |
| Heartbeat monitoring      | Sends running task IDs to code-agent every 10 minutes for zombie detection                    |
| Log forwarding            | Streams container output in 8KB chunks with batched uploads                                   |
| Webhook delivery          | HMAC-signed callbacks with 3 retries, exponential backoff, and pending queue                  |
| State persistence         | Atomic JSON file with corruption recovery and orphan detection                                |
| Token refresh             | GitHub installation tokens refreshed every 5 minutes (service) and 30 minutes (per-container) |
| Stale worktree cleanup    | Removes worktrees older than a configurable age threshold                                     |
| Sensitive file guard      | Reverts commits that touch `.env`, `.pem`, `credentials.json`, and other secrets              |
| System prompt phases      | Phase 1 (design) vs Phase 2 (execution) based on Linear issue labels                          |
| Startup recovery          | Detects interrupted tasks and notifies code-agent on restart                                  |

## Worker Types

| Type   | Provider  | Model                      | Use Case              |
| ------ | --------- | -------------------------- | --------------------- |
| `opus` | Anthropic | `claude-opus-4-5-20251101` | Complex code tasks    |
| `auto` | Anthropic | (default, API-selected)    | General-purpose tasks |
| `glm`  | ZAI       | (API-selected GLM variant) | Cost-efficient tasks  |

## Benefits

- **Zero-touch operation** - Tasks run unattended; results arrive via webhook
- **Security by default** - Containers drop all capabilities, secrets are read-only mounts, and rootfs writes are constrained to tmpfs
- **Crash resilience** - Interrupted tasks are recovered on startup; pending webhooks survive restarts
- **Cost flexibility** - Choose between Anthropic and ZAI providers per task
- **Observable** - Real-time logs, heartbeats, and structured JSON logging to file

## Limitations

- Runs on a single machine (not horizontally scalable)
- Requires Docker daemon on the host
- GitHub private key must be accessible via GCP Secret Manager or environment variable
- Cloudflare Tunnel required for code-agent to reach the orchestrator
- Maximum task duration is 2 hours (hard timeout with SIGKILL)
- No hot-reload of the claude-worker Docker image; running containers use the image they started with
