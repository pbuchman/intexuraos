# Container Lifecycle — Orchestrator Worker Containers

> Complete documentation of container creation, timeout defaults, cleanup triggers, resume behavior, and edge cases for the orchestrator's Docker-based worker containers.

---

## Table of Contents

1. [Overview](#overview)
2. [Container Creation](#container-creation)
3. [Timing Defaults](#timing-defaults)
4. [Container States](#container-states)
5. [Cleanup Triggers](#cleanup-triggers)
6. [Resume & Orphan Detection](#resume--orphan-detection)
7. [Zombie Detection](#zombie-detection)
8. [Startup Recovery](#startup-recovery)
9. [Edge Cases](#edge-cases)
10. [Configuration](#configuration)

---

## Overview

The orchestrator runs code tasks inside isolated Docker containers. Each task gets:

- A **git worktree** — isolated checkout of the repository
- A **Docker container** — running Claude with mounted worktree and secrets
- **Bind mounts**:
  - `/repo` — the git worktree (read-write)
  - `/secrets` — task-specific secrets (read-only)
  - `/home/claude/.claude` — Claude session state (or shared credentials path)
  - `/home/claude/pnpm-store` — shared pnpm cache (read-write)
- **Tmpfs mounts** (ephemeral, container-local):
  - `/tmp` — temporary files (2GB, noexec)
  - `/home/claude` — Claude home directory (500MB, noexec)
  - `/repo/node_modules` — Linux-native node_modules (4GB, exec) — shadows the macOS host's bind-mounted node_modules so `pnpm install` produces Linux-compatible binaries

The container runs as the **host user** (UID/GID match) to avoid permission issues with bind-mounted files.

---

## Container Creation

### Flow Overview

```
Task Dispatch Request
        │
        ▼
┌───────────────────┐
│ WorktreeManager   │
│ .createWorktree() │ ──► git worktree create
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ DockerProvider    │
│ .createWorker()   │
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 Secrets    Container
 Setup      Create
    │           │
    │     ┌─────┴─────┐
    │     │           │
    │     ▼           ▼
    │  Mount      Network
    │  Volumes    Setup
    │           │
    │           ▼
    │     ┌───────────┐
    │     │ container │
    │     │ .start()  │
    │     └─────┬─────┘
    │           │
    │           ▼
    │     ┌───────────┐
    │     │ waitFor   │
    │     │ WorkerReady│
    │     └─────┬─────┘
    │           │
    └─────┬─────┘
          │
          ▼
   Container Running
```

### Step 1: Worktree Creation

**File:** `workers/orchestrator/src/services/worktree-manager.ts`

```typescript
// Creates: git worktree add -b "{taskId}" "{worktreePath}" "origin/{baseBranch}"
```

- Creates a new git worktree from the base branch
- Creates a local branch named after the task ID
- Copies MCP config template (`.mcp.json`) if configured
- Copies Claude settings template (`.claude/settings.local.json`) if configured
- Runs `pnpm install --frozen-lockfile` if `pnpm-lock.yaml` exists (5 min timeout)

### Step 2: Container Creation

**File:** `workers/orchestrator/src/services/isolation/docker-provider.ts`

```typescript
// Key steps in createWorker():
// 1. Create secrets directory (/tmp/claude-secrets/{taskId})
// 2. Write prompt files (system-prompt.txt, user-prompt.txt)
// 3. Copy GCP SA key if configured
// 4. Create Docker container with:
//    - Image: claude-worker:latest
//    - User: host UID:GID (for permission compatibility)
//    - Network: claude-worker-net
//    - Tmpfs mounts: /tmp (2GB), /home/claude (500MB), /repo/node_modules (4GB)
// 5. Start container
// 6. Wait for worker ready (managed mode)
```

### Environment Variables

The container receives these environment variables:

| Variable                         | Description                          |
| -------------------------------- | ------------------------------------ |
| `TASK_ID`                        | Unique task identifier               |
| `ANTHROPIC_API_KEY`              | Claude API key (or use shared creds) |
| `ANTHROPIC_BASE_URL`             | API endpoint URL                     |
| `ANTHROPIC_MODEL`                | Model to use (if specified)          |
| `LINEAR_API_KEY`                 | Linear API key                       |
| `SENTRY_AUTH_TOKEN`              | Sentry auth token                    |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP SA key                   |
| `CLAUDE_PROJECT_DIR`             | Always `/repo`                       |
| `CLAUDE_WORKER_MODE`             | Always `1`                           |
| `CLAUDE_MANAGED_MODE`            | `1` if managed attempts enabled      |
| `CLAUDE_CONTINUE`                | `1` if resuming (continueSession)    |
| `GIT_USER_NAME`                  | Git user name (if configured)        |
| `GIT_USER_EMAIL`                 | Git user email (if configured)       |

---

## Timing Defaults

### Timeout Constants

| Constant                          | Value            | File                       | Description                            |
| --------------------------------- | ---------------- | -------------------------- | -------------------------------------- |
| `TASK_TIMEOUT_WARNING_MS`         | 115 min (1h 55m) | `task-dispatcher.ts`       | Warning log before hard kill           |
| `TASK_TIMEOUT_KILL_MS`            | 120 min (2h)     | `task-dispatcher.ts`       | Hard kill timeout                      |
| `COMPLETION_CHECK_INTERVAL_MS`    | 30s              | `task-dispatcher.ts`       | Poll interval for completion           |
| `ACTIVITY_HEARTBEAT_THRESHOLD_MS` | 30s              | `task-dispatcher.ts`       | Heartbeat activity threshold           |
| `workerReadyTimeoutMs`            | 600s (10 min)    | `docker-provider.ts`       | Container readiness timeout            |
| `ZOMBIE_THRESHOLD_MINUTES`        | 30 min           | `detectZombieTasks.ts`     | Inactivity before zombie detection     |
| `MAX_AGE_MS` (cleanup)            | 24 hours         | `docker-provider.ts`       | Orphan container cleanup age threshold |
| `pnpm install timeout`            | 5 min            | `worktree-manager.ts`      | Dependency installation timeout        |

### Timeout Flow

```
Task Starts
    │
    ▼
┌─────────────────┐
│ 0 min          │
└────────┬────────┘
         │
         ▼ (115 min)
┌─────────────────┐
│ Warning Log    │ ◄── "Task approaching timeout"
└────────┬────────┘
         │
         ▼ (120 min)
┌─────────────────┐
│ Force Kill     │ ◄── SIGKILL sent to container
│ teardownAttempt│
└────────┬────────┘
         │
         ▼
    Container
    Destroyed
```

---

## Container States

### Docker Provider States

| State       | Description                         |
| ----------- | ----------------------------------- |
| `running`   | Container actively processing task  |
| `completed` | Container exited with code 0        |
| `failed`    | Container exited with non-zero code |
| `timeout`   | Container killed due to timeout     |

### Orchestrator Internal States

| State       | Description                                         |
| ----------- | --------------------------------------------------- |
| `active`    | Task in progress, container running                 |
| `preserved` | Container kept for debugging (not in `workers` Map) |
| `destroyed` | Container removed                                   |

### Preserved Workers

The orchestrator can preserve containers for debugging:

```typescript
// docker-provider.ts — preserveWorker()
async preserveWorker(taskId: string): Promise<void> {
  // Moves worker from `workers` Map to `preservedWorkers` Map
  // Clears sensitive files (individually, not rm -rf — preserves bind mount inodes)
  // Keeps container alive for debugging
}
```

Preserved workers are tracked in memory and listed via `listPreservedWorkers()`.

---

## Cleanup Triggers

### 1. Task Completion

Container cleanup happens during **finalization**, not during attempt teardown. The `teardownAttempt` method only destroys when `keepSession` is `false`:

```typescript
// task-dispatcher.ts — teardownAttempt()
private async teardownAttempt(taskId: string, keepSession: boolean): Promise<void> {
  if (!keepSession) {
    await this.isolation.provider.destroyWorker(taskId);
    await this.isolation.provider.cleanupTaskSession?.(taskId);
  }
}
```

Most internal call sites pass `keepSession=true` (between managed attempts). The actual container destruction happens in `finalizeTask()`, which calls `teardownAttempt(taskId, false)` — unless `preserveFailedContainers` is enabled, in which case it calls `preserveWorker()` instead.

If `preserveFailedContainers` is `true`, containers are preserved on `failed`, `interrupted`, **and** `completed` statuses.

### 2. Cancellation

```typescript
// User cancels task → dispatchCancel() → destroyWorker(taskId, forceKill=true)
```

Force kill (`SIGKILL`) is used for cancellation to ensure immediate termination.

### 3. Timeout

As described in [Timeout Flow](#timeout-flow):
- Warning at 115 minutes
- Force kill at 120 minutes

### 4. Startup Cleanup

On orchestrator startup, old containers are cleaned up:

```typescript
// docker-provider.ts — cleanupOrphanedContainers()
async cleanupOrphanedContainers(): Promise<void> {
  // Removes containers older than 24 hours
  // Prevents name collisions on restart
}
```

---

## Resume & Orphan Detection

When a task is resumed (either after completion or orchestrator restart), the orchestrator checks for existing containers:

### Resume Flow

```
Resume Request (continueSession=true)
            │
            ▼
┌───────────────────────┐
│ Check preservedWorkers│
│ Map for taskId        │
└─────────┬─────────────┘
          │
    ┌─────┴─────┐
    │ Found?    │
    └─────┬─────┘
      Yes │ No
     ┌────┴────┐      ┌────────────────────┐
     ▼         │      │ Check Docker for   │
  Restore      │      │ orphan container: │
  preserved    │      │ claude-worker-{id} │
  container    │      └─────────┬──────────┘
     │        │            ┌────┴─────┐
     │        │            │ Running? │
     │        │            └─────┬─────┘
     │        │           Yes    │ No
     │        │           ┌──────┴──────┐
     │        │           ▼             ▼
     │        │       Reuse       Remove &
     │        │       container    create fresh
     │        │           │             │
     └────────┴───────────┴─────────────┘
                    │
                    ▼
             Continue Task
```

### Orphan Detection Code

```typescript
// docker-provider.ts — createWorker() orphan detection
if (config.continueSession === true) {
  const orphanContainer = this.docker.getContainer(`claude-worker-${taskId}`);
  const orphanInfo = await orphanContainer.inspect();

  if (orphanInfo.State.Running) {
    // Reuse the orphaned container
    this.logger.info({ taskId, containerId }, 'Reusing orphaned container for resume after restart');
  } else {
    // Remove stopped container, create fresh
    await orphanContainer.remove({ force: true });
  }
}
```

---

## Zombie Detection

**Important:** Zombie detection is implemented in the **code-agent**, not the orchestrator.

### How It Works

**File:** `apps/code-agent/src/domain/usecases/detectZombieTasks.ts`

```typescript
const ZOMBIE_THRESHOLD_MINUTES = 30;
```

1. Query Firestore for tasks with `status: 'running'` or `status: 'dispatched'`
2. Filter tasks where `updatedAt` is older than 30 minutes
3. Mark these as `status: 'interrupted'`

### Detection Trigger

The zombie detection runs periodically (via Cloud Scheduler or internal timer). It detects:

- Tasks where the container crashed without notification
- Tasks where the orchestrator died while task was running
- Network partitions that prevented completion reporting

---

## Startup Recovery

When the orchestrator restarts:

### What Survives Restart

| Component         | Survives? | Notes                        |
| ----------------- | --------- | ---------------------------- |
| Docker containers | ✅ Yes     | Containers run independently |
| Git worktrees     | ✅ Yes     | Filesystem persists          |
| Firestore tasks   | ✅ Yes     | Database persists            |

### What Is Lost

| Component                                  | Survives? | Notes                |
| ------------------------------------------ | --------- | -------------------- |
| In-memory Maps (workers, preservedWorkers) | ❌ No      | Recreated on startup |
| Task state in orchestrator                 | ❌ No      | Read from Firestore  |

### Recovery Flow

On startup, the orchestrator runs `cleanupOrphanedContainers()` to remove containers older than 24 hours. However, there is **no bulk recovery scan** of running tasks from Firestore.

Orphan detection is **reactive and per-task**: it happens inside `createWorker()` when a resume request arrives with `continueSession=true`. The orchestrator does not proactively scan for orphaned containers on startup.

```
Orchestrator Starts
        │
        ▼
┌───────────────────┐
│ cleanupOrphaned  │
│ Containers()      │ ◄── Removes containers > 24h old
└───────────────────┘

(Later, when a resume request arrives for a specific task:)

Resume Request (continueSession=true)
        │
        ▼
┌───────────────────┐
│ createWorker()   │
│ Orphan Detection │ ◄── Check if container still running
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │ Container  │
    │ Running?   │
    └─────┬─────┘
    Yes   │ No
   ┌──────┴──────┐
   ▼             ▼
Reuse      Remove stopped
container  container &
           create fresh
```

Tasks where the container died and no resume is requested are eventually caught by **zombie detection** (30 min inactivity threshold in the code-agent).

---

## Edge Cases

### Q1: Container Removed but Task Exists

**Scenario:** External force (manual `docker rm`, system cleanup) removes the container while task is running.

**Detection:** On next heartbeat or resume, the orchestrator queries the container status.

**Recovery:**
1. `isWorkerRunning(taskId)` returns `false`
2. Orchestrator logs the failure
3. Task status in Firestore set to `failed`
4. No automatic restart (user must retry)

### Q2: Orchestrator Restart During Task

**Scenario:** Orchestrator crashes/restarts while task is running.

**Recovery:**
1. On startup, read running tasks from Firestore
2. For each running task, check if container still exists
3. If running → resume (reuse container)
4. If stopped → mark as failed

### Q3: Network Partition

**Scenario:** Container loses network connectivity, can't complete.

**Detection:**
- Timeout (2h hard limit)
- Zombie detection (30 min inactivity)

**Recovery:**
- Timeout triggers container kill
- Zombie detection marks task as `interrupted`
- User notified via WhatsApp (if configured)

### Q4: Concurrent Resume Attempts

**Scenario:** Two resume requests for same task (race condition).

**Handling:**
- Each resume creates a new container check
- If container already reused by first request, second finds stopped container
- Second request creates fresh container
- **Note:** This could result in duplicate work; idempotency depends on task design

---

## Configuration

### Hardcoded Constants

| Value                     | Location                                  | Default |
| ------------------------- | ----------------------------------------- | ------- |
| Task timeout (kill)       | `TASK_TIMEOUT_KILL_MS`                    | 120 min |
| Task timeout (warning)    | `TASK_TIMEOUT_WARNING_MS`                 | 115 min |
| Completion check interval | `COMPLETION_CHECK_INTERVAL_MS`            | 30s     |
| Activity heartbeat        | `ACTIVITY_HEARTBEAT_THRESHOLD_MS`         | 30s     |
| Zombie threshold          | `ZOMBIE_THRESHOLD_MINUTES`                | 30 min  |
| Cleanup max age           | `MAX_AGE_MS` in cleanupOrphanedContainers | 24h     |
| Worker ready timeout      | `workerReadyTimeoutMs` default            | 600s    |

### Config Defaults (overridable via `DockerProviderConfig`)

These are defaults in `DEFAULT_CONFIG` — overridable through the constructor's `Partial<DockerProviderConfig>` parameter, but not currently exposed as environment variables:

| Value                      | Default                                 |
| -------------------------- | --------------------------------------- |
| Docker image (`imageName`) | `claude-worker:latest` (GAR)            |
| Max concurrent             | 4                                       |
| Image pull policy          | `always`                                |
| Network name               | `claude-worker-net`                     |
| Keep containers alive      | `false`                                 |
| Secrets base path          | `/tmp/claude-secrets`                   |
| Managed attempts mode      | `true`                                  |
| Preserve failed containers | `false` (via `CompletionControlConfig`) |

### Future Considerations

The following could be made configurable in future iterations:

- Timeout values (warning/kill thresholds)
- Zombie detection threshold
- Container image and pull policy
- Max concurrent workers
- Preserve failed containers flag

---

## Reference

### Key Files

| File                                                             | Purpose                                |
| ---------------------------------------------------------------- | -------------------------------------- |
| `workers/orchestrator/src/services/task-dispatcher.ts`           | Task orchestration, timeout management |
| `workers/orchestrator/src/services/isolation/docker-provider.ts` | Docker container lifecycle             |
| `workers/orchestrator/src/services/worktree-manager.ts`          | Git worktree management                |
| `apps/code-agent/src/domain/usecases/detectZombieTasks.ts`       | Zombie task detection                  |

### Related Issues

- INT-617: Code tasks improvements (parent)
- INT-620: This documentation
- INT-371: Zombie task detection design
