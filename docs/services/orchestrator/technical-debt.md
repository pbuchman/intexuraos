# Orchestrator — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 — orchestrator v3.3.0 force refresh](../../documentation-runs.md)

---

## Summary

| Category            | Count  | Severity |
| ------------------- | ------ | -------- |
| TODO/FIXME Comments | 2      | Low      |
| Architectural Gaps  | 4      | Medium   |
| Code Duplicates     | 1      | Low      |
| Missing Features    | 4      | Medium   |
| **Total**           | **11** | Medium   |

---

## Future Plans

### Multi-Machine Orchestration

Distribute tasks across multiple macOS hosts or dev machines:

1. Central task queue (Pub/Sub) instead of direct HTTP dispatch
2. Orchestrator instances register with code-agent and pull tasks
3. Shared state in Firestore instead of local JSON

### Container Image Versioning

Pin claude-worker images to specific versions instead of `:latest`:

1. Tag images with build timestamps or git SHAs
2. Store preferred image tag per worker type in configuration
3. Support rolling updates without restarting the orchestrator

### Task Priority Queue

Support priority levels for task scheduling:

1. High-priority tasks preempt lower-priority ones at capacity
2. Queue depth visibility in the health endpoint
3. Configurable priority per worker type or Linear issue label

### Metrics and Alerting

Expose operational metrics (extends `TurnMetricsCollector` post-task data):

1. Task completion rate, average duration, failure rate
2. Real-time container resource usage trends during execution
3. Token refresh failure rates
4. Webhook delivery success rates

---

## TODO/FIXME Comments

### 1. Default repository hardcoded

**File:** `workers/orchestrator/src/services/task-dispatcher.ts`

```typescript
private getDefaultRepository(_request: CreateTaskRequest): string {
  // TODO: Implement GitHub API call to get default repository
  return 'pbuchman/intexuraos';
}
```

**Impact:** Low. The caller always passes a repository from code-agent. This fallback is rarely exercised.

**Recommended fix:** Either implement the GitHub API call to resolve the default repository from the installation, or remove the fallback and require `repository` in the request schema.

---

### 2. Graceful shutdown not implemented

**File:** `workers/orchestrator/src/routes.ts`

```typescript
app.post('/admin/shutdown', { preHandler: [verifyDispatchSignature] }, async (request, reply) => {
  // TODO: Implement graceful shutdown logic
  reply.send({ status: 'shutting_down' });
});
```

**Impact:** Low. The SIGTERM/SIGINT handlers in `main.ts` perform graceful shutdown correctly. The HTTP endpoint exists but only sends a response without triggering the actual shutdown sequence.

**Recommended fix:** Wire the endpoint to call the same shutdown logic used by signal handlers, or remove the endpoint if SIGTERM is sufficient.

---

## Architectural Gaps

### 3. Duplicate JWT signing implementations

**Severity:** Low

Two separate libraries produce GitHub App JWTs:

| Component          | Library        | File                                        |
| ------------------ | -------------- | ------------------------------------------- |
| GitHubTokenService | `jsonwebtoken` | `src/github/token-service.ts`               |
| TokenRefresher     | `jose`         | `src/services/isolation/token-refresher.ts` |

Both sign RS256 JWTs with the same private key for the same purpose (GitHub installation token minting).

**Recommended fix:** Consolidate on `jose` (modern, dependency-free Web Crypto API) and share a single `mintGitHubJWT()` function.

---

### 4. No horizontal scaling path

**Severity:** Medium

The orchestrator runs on a single machine. State is stored in a local JSON file, worktrees exist on the local filesystem, and Docker containers run on the local daemon. There is no mechanism to distribute tasks across multiple machines.

**Recommended fix:** For scaling beyond one machine, consider:

- Replace `StatePersistence` with Firestore
- Replace local worktrees with ephemeral volume mounts
- Use a queue (Pub/Sub) instead of direct HTTP dispatch
- This is not urgent while task volume remains within a single machine's capacity

---

### 5. Completion verifier has no circuit-breaker

**Severity:** Medium

When Gemini is unavailable (network error, rate limit, API outage), all in-flight tasks fail with `TASK_COMPLETION_VERIFIER_FAILED`. There is no fallback to deterministic-only verification, no retry with backoff, and no way to temporarily disable the verifier for a task.

**Recommended fix:** Add a circuit-breaker pattern: after N consecutive Gemini failures within a time window, fall back to deterministic-only verification and log a warning. Re-enable LLM verification after the circuit resets.

---

### 6. No graceful container shutdown on task cancel

**Severity:** Medium

`cancelTask()` calls `destroyWorker()` which sends SIGTERM and then force-removes the container. Claude Code does not receive a chance to save progress, push partial work, or clean up.

**Recommended fix:** Implement a two-phase cancellation:

1. Send a "please stop" message via container stdin
2. Wait a configurable grace period (e.g., 60 seconds)
3. Fall back to SIGTERM/SIGKILL

---

## Missing Features

### 7. No task retry from the orchestrator

**Severity:** Medium

The `retriedFrom` field exists on tasks, but retry logic lives entirely in code-agent. The orchestrator has no self-service retry capability (e.g., retrying a task that failed due to transient Docker issues).

**Recommended fix:** Add a `POST /tasks/:id/retry` endpoint that creates a new task with the same parameters and `retriedFrom` pointing to the original.

---

### 8. No worktree cleanup on completed tasks

**Severity:** Medium

Worktrees accumulate until manually cleaned or the stale threshold is exceeded. Completed tasks leave worktrees behind until the next periodic cleanup or restart.

**Recommended fix:** Call worktree cleanup in `handleTaskCompletion()` or tighten the periodic cleanup interval for completed task worktrees.

---

### 9. No resource usage monitoring

**Severity:** Low

`DockerProvider.getResourceUsage()` exists but is never called. There is no alerting when containers approach memory limits or CPU saturation. (Note: `TurnMetricsCollector` collects post-exit cgroup data, but does not provide real-time monitoring during task execution.)

**Recommended fix:** Integrate resource usage into the health endpoint or log periodic snapshots during task execution.

---

### 10. No container log persistence

**Severity:** Low

Container logs are streamed to code-agent via `LogForwarder` but are not persisted locally. If the code-agent is unreachable during a task, log data is lost after the chunk retry limit (3 attempts, 4s max backoff).

**Recommended fix:** Write container logs to `~/.claude-orchestrator/logs/{taskId}.log` as a fallback before streaming.

---

## Recent Improvements (v3.3.0)

The following items improved reliability and observability since v3.2.0:

- **Docker health gate** — Task submission now checks Docker daemon availability before accepting work, preventing tasks from failing during container creation when Docker is unresponsive
- **Container creation timeout** — 2-minute timeout prevents hung dispatches from occupying capacity indefinitely
- **Unified PR automation log** — Structured task-event logging enables a full timeline of all automation activity on a PR
- **Already-completed outcome label** — Execution agent can now report `already_completed` when requested work is already merged, preventing redundant re-implementation
- **Mandatory model name in PR descriptions** — Worker type and model name are now required in every PR description, enabling tracking of which model produced each PR
- **Fatal exit code handling** — Exit codes 137 (OOM kill) and 139 (segfault) skip Gemini verification and trigger immediate retries
- **Deep Validation severity indicators** — Reports use a four-level visual scale (Critical/Warning/Minor/Pass) with emoji for faster human triage
- **Review Agent** — Fourth agent type (`review`) performs automated read-only PR reviews without pushing code changes
- **Kimi worker type** — Added Kimi K2.5 via DashScope alongside existing GLM and Qwen models
- **Worktree mutex** — All git worktree operations serialized via `async-mutex` to prevent concurrent index corruption
- **Resilient repo startup** — Repository manager sanitizes credentials from remote URLs and gracefully degrades when fetch fails
- **Periodic stale cleanup** — Orphaned containers are automatically removed instead of requiring manual cleanup
- **Docker exec stream leak fixed** — Resolved a stream leak that caused container exits to go undetected until the 2-hour timeout
- **Resume result preservation** — `lastSuccessResult` field ensures resumed tasks do not lose their previous successful result
- **Pending resume recovery** — Startup recovery can now detect and restart accepted resumes that were interrupted by a crash

---

## Debt Resolution Tracking

| ID  | Description                       | Created    | Resolved | Ticket |
| --- | --------------------------------- | ---------- | -------- | ------ |
| 1   | Default repository hardcoded      | 2026-02-08 | -        | -      |
| 2   | Admin shutdown not wired          | 2026-02-08 | -        | -      |
| 3   | Duplicate JWT libraries           | 2026-02-08 | -        | -      |
| 4   | No horizontal scaling             | 2026-02-08 | -        | -      |
| 5   | Verifier has no circuit-breaker   | 2026-02-19 | -        | -      |
| 6   | No graceful container cancel      | 2026-02-08 | -        | -      |
| 7   | No orchestrator-side retry        | 2026-02-08 | -        | -      |
| 8   | No worktree cleanup on completion | 2026-02-08 | -        | -      |
| 9   | No resource usage monitoring      | 2026-02-08 | -        | -      |
| 10  | No local log persistence fallback | 2026-02-08 | -        | -      |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
