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

| Variable                         | Description                                |
| -------------------------------- | ------------------------------------------ |
| `TASK_ID`                        | Unique task identifier                     |
| `ANTHROPIC_API_KEY`              | Claude API key (`opus`/`auto` worker type) |
| `ANTHROPIC_BASE_URL`             | API endpoint URL (`opus`/`auto`)           |
| `ANTHROPIC_MODEL`                | Model to use (if specified by worker type) |
| `LINEAR_API_KEY`                 | Linear API key                             |
| `SENTRY_AUTH_TOKEN`              | Sentry auth token                          |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP SA key                         |
| `CLAUDE_PROJECT_DIR`             | Always `/repo`                             |
| `CLAUDE_WORKER_MODE`             | Always `1`                                 |
| `CLAUDE_MANAGED_MODE`            | `1` if managed attempts enabled            |
| `CLAUDE_CONTINUE`                | `1` if resuming (continueSession)          |
| `GIT_USER_NAME`                  | Git user name (if configured)              |
| `GIT_USER_EMAIL`                 | Git user email (if configured)             |

**Note:** Environment variables are conditional on worker type and credentials mode:

- **`opus`/`auto` workers:** Set `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` (from `https://api.anthropic.com`)
- **`glm` workers:** Use `ZAI_API_KEY` instead of `ANTHROPIC_API_KEY`, with `ANTHROPIC_BASE_URL` set to `https://api.z.ai/api/anthropic`
- **Shared credentials mode** (`sharedCredsPath` configured for `opus`/`auto`): Omits `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` entirely — Claude CLI reads from mounted `.credentials.json` instead

---

## Timing Defaults

### Timeout Constants

| Constant                          | Value            | File                   | Description                            |
| --------------------------------- | ---------------- | ---------------------- | -------------------------------------- |
| `TASK_TIMEOUT_WARNING_MS`         | 175 min (2h 55m) | `task-dispatcher.ts`   | Warning log before stop timeout        |
| `TASK_TIMEOUT_KILL_MS`            | 180 min (3h)     | `task-dispatcher.ts`   | Graceful stop timeout                  |
| `COMPLETION_CHECK_INTERVAL_MS`    | 30s              | `task-dispatcher.ts`   | Poll interval for completion           |
| `ACTIVITY_HEARTBEAT_THRESHOLD_MS` | 30s              | `task-dispatcher.ts`   | Heartbeat activity threshold           |
| `workerReadyTimeoutMs`            | 600s (10 min)    | `docker-provider.ts`   | Container readiness timeout            |
| `ZOMBIE_THRESHOLD_MINUTES`        | 30 min           | `detectZombieTasks.ts` | Inactivity before zombie detection     |
| `MAX_AGE_MS` (cleanup)            | 24 hours         | `docker-provider.ts`   | Orphan container cleanup age threshold |
| `pnpm install timeout`            | 5 min            | `worktree-manager.ts`  | Dependency installation timeout        |

### Timeout Flow

```
Task Starts
    │
    ▼
┌─────────────────┐
│ 0 min          │
└────────┬────────┘
         │
         ▼ (175 min)
┌─────────────────┐
│ Warning Log    │ ◄── "Task approaching timeout"
└────────┬────────┘
         │
         ▼ (180 min)
┌─────────────────┐
│ Graceful Stop  │ ◄── SIGTERM sent (10s grace), then container removed
│ destroyWorker()│
└────────┬────────┘
         │
         ▼
    Task marked
    'interrupted'
```

---

## Container States

### Docker Provider States (`WorkerStatus`)

| State       | Description                              | Notes                                              |
| ----------- | ---------------------------------------- | -------------------------------------------------- |
| `starting`  | Container created, waiting for readiness | Defined in type but never assigned in current code |
| `running`   | Container actively processing task       | All `WorkerHandle` instances enter as `running`    |
| `completed` | Container exited with code 0             |                                                    |
| `failed`    | Container exited with non-zero code      |                                                    |
| `timeout`   | Container stopped due to timeout         | Only set in legacy `waitForCompletion()` path      |

**Note:** In the managed-mode flow (default), the timeout path in `task-dispatcher.ts` calls `destroyWorker()` and marks the Firestore task as `interrupted` — it does not set the `WorkerHandle` status to `timeout`. The `timeout` status is only used in the legacy `waitForCompletion()` code path in `docker-provider.ts`.

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

All cleanup paths call `destroyWorker(taskId, forceKill?)`. When `forceKill` is `false` (default), the container receives `SIGTERM` with a 10-second grace period (`container.stop({ t: 10 })`). When `forceKill` is `true`, `SIGKILL` is sent immediately (`container.kill({ signal: 'SIGKILL' })`). Currently, **no call site passes `forceKill=true`** — all shutdowns are graceful.

### 1. Task Completion

Container cleanup happens during **finalization**, not during attempt teardown. The `teardownAttempt` method only destroys when `keepSession` is `false`:

```typescript
// task-dispatcher.ts — teardownAttempt()
private async teardownAttempt(taskId: string, keepSession: boolean): Promise<void> {
  if (!keepSession) {
    try {
      await this.isolation.provider.destroyWorker(taskId);
    } catch (error) {
      this.logger.warn({ taskId, error }, 'Failed to destroy worker after attempt completion');
    }
    await this.isolation.provider.cleanupTaskSession?.(taskId);
  }
}
```

Most internal call sites pass `keepSession=true` (between managed attempts). The actual container destruction happens in `finalizeTask()`, which calls `teardownAttempt(taskId, false)` — unless `preserveWorkerContainers` is enabled, in which case it calls `preserveWorker()` instead.

If `preserveWorkerContainers` is `true`, containers are preserved on `failed`, `interrupted`, **and** `completed` statuses.

### 2. Cancellation

```typescript
// User cancels task → cancelTask() → destroyWorker(taskId)
```

Graceful stop (`SIGTERM` with 10s timeout) is used for cancellation. The `forceKill` parameter defaults to `false`, so `container.stop({ t: 10 })` is called, not `container.kill({ signal: 'SIGKILL' })`.

### 3. Timeout

As described in [Timeout Flow](#timeout-flow):

- Warning at 175 minutes
- Graceful stop at 180 minutes (task marked `interrupted`)

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
│ 1. Check `workers`    │
│    Map for taskId     │ ◄── In-memory: still tracked from current run
└─────────┬─────────────┘
          │
    ┌─────┴─────┐
    │ Found?    │
    └─────┬─────┘
      Yes │ No
     ┌────┘└──────────────────────┐
     ▼                            ▼
  Reuse existing         ┌───────────────────────┐
  worker (update         │ 2. Check preserved-   │
  prompts, start         │    Workers Map        │
  new attempt)           └─────────┬─────────────┘
     │                        ┌────┴─────┐
     │                        │ Found?   │
     │                        └─────┬────┘
     │                     Yes │     │ No
     │                    ┌────┘     └─────────────┐
     │                    ▼                        ▼
     │               Restore             ┌────────────────────┐
     │               preserved           │ 3. Check Docker    │
     │               container           │ for orphan:        │
     │                    │              │ claude-worker-{id} │
     │                    │              └─────────┬──────────┘
     │                    │                   ┌────┴─────┐
     │                    │                   │ Running? │
     │                    │                   └─────┬────┘
     │                    │              Yes │      │ No
     │                    │              ┌───┘      └───┐
     │                    │              ▼              ▼
     │                    │          Reuse        Remove &
     │                    │          container    create fresh
     │                    │              │              │
     └────────────────────┴──────────────┴──────────────┘
                              │
                              ▼
                       Continue Task
```

### Orphan Detection Code

```typescript
// docker-provider.ts — createWorker() orphan detection
if (config.continueSession === true) {
  try {
    const orphanContainer = this.docker.getContainer(`claude-worker-${taskId}`);
    const orphanInfo = await orphanContainer.inspect();

    if (orphanInfo.State.Running) {
      // Reuse the orphaned container
      this.logger.info(
        { taskId, containerId },
        'Reusing orphaned container for resume after restart'
      );
    } else {
      // Remove stopped container, create fresh
      await orphanContainer.remove({ force: true });
    }
  } catch {
    // Container doesn't exist — proceed with normal creation
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

**Detection:** On next completion check interval (30s), the orchestrator queries the container status.

**Recovery:**

1. `isWorkerRunning(taskId)` returns `false`
2. `handleTaskCompletion()` runs the completion verifier
3. Completion verifier determines final status (`completed` if PR/deliverable found, `failed` otherwise)
4. No automatic restart (user must retry)

### Q2: Orchestrator Restart During Task

**Scenario:** Orchestrator crashes/restarts while task is running.

**Recovery:**

1. On startup, `cleanupOrphanedContainers()` removes containers older than 24 hours
2. Running tasks in Firestore are **NOT** automatically recovered — there is no bulk Firestore scan
3. If a resume request arrives later, orphan detection in `createWorker()` checks if the container still exists and reuses it if running
4. Tasks with no resume request are eventually caught by **zombie detection** (30 min inactivity) and marked `interrupted`

### Q3: Network Partition

**Scenario:** Container loses network connectivity, can't complete.

**Detection:**

- Timeout (2h limit)
- Zombie detection (30 min inactivity)

**Recovery:**

- Timeout triggers graceful container stop (SIGTERM), task marked `interrupted`
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
| Task timeout (kill)       | `TASK_TIMEOUT_KILL_MS`                    | 180 min |
| Task timeout (warning)    | `TASK_TIMEOUT_WARNING_MS`                 | 175 min |
| Completion check interval | `COMPLETION_CHECK_INTERVAL_MS`            | 30s     |
| Activity heartbeat        | `ACTIVITY_HEARTBEAT_THRESHOLD_MS`         | 30s     |
| Zombie threshold          | `ZOMBIE_THRESHOLD_MINUTES`                | 30 min  |
| Cleanup max age           | `MAX_AGE_MS` in cleanupOrphanedContainers | 24h     |
| Worker ready timeout      | `workerReadyTimeoutMs` default            | 600s    |

### Config Defaults (overridable via `DockerProviderConfig`)

These are defaults in `DEFAULT_CONFIG` — overridable through the constructor's `Partial<DockerProviderConfig>` parameter, but not currently exposed as environment variables:

| Value                      | Default                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Docker image (`imageName`) | `europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest` |
| Max concurrent             | 4                                                                                            |
| Image pull policy          | `always`                                                                                     |
| Network name               | `claude-worker-net`                                                                          |
| Keep containers alive      | `false`                                                                                      |
| Secrets base path          | `/tmp/claude-secrets`                                                                        |
| Managed attempts mode      | `true`                                                                                       |
| Preserve failed containers | `false` (via `CompletionControlConfig`)                                                      |

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
