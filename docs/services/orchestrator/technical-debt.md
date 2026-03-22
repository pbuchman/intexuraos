# Orchestrator — Technical Debt

**Last Updated:** 2026-03-22
**Analysis Run:** [2026-03-22 — orchestrator v3.4.0](../../documentation-runs.md)

---

## Summary

| Category            | Count  | Severity |
| ------------------- | ------ | -------- |
| TODO/FIXME Comments | 2      | Low      |
| Architectural Gaps  | 4      | Medium   |
| Deprecations        | 1      | Low      |
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

## Deprecations

### 7. Direct Linear GraphQL queries

**Severity:** Low

The `readPlanReferencedInLinearIssue` function and direct `LINEAR_GRAPHQL_URL` usage in `deep-validator-helpers.ts` are deprecated in favor of the code-agent proxy (`fetchLinearIssueContextViaCodeAgent`). The deprecated code path remains as a fallback.

**Recommended fix:** Remove the deprecated function and the `LINEAR_GRAPHQL_URL` constant after confirming all deployments use the code-agent proxy (INT-1040).

---

## Missing Features

### 8. No task retry from the orchestrator

**Severity:** Medium

The `retriedFrom` field exists on tasks, but retry logic lives entirely in code-agent. The orchestrator has no self-service retry capability (e.g., retrying a task that failed due to transient Docker issues).

**Recommended fix:** Add a `POST /tasks/:id/retry` endpoint that creates a new task with the same parameters and `retriedFrom` pointing to the original.

---

### 9. No worktree cleanup on completed tasks

**Severity:** Medium

Worktrees accumulate until manually cleaned or the stale threshold is exceeded. Completed tasks leave worktrees behind until the next periodic cleanup or restart.

**Recommended fix:** Call worktree cleanup in `handleTaskCompletion()` or tighten the periodic cleanup interval for completed task worktrees.

---

### 10. No resource usage monitoring

**Severity:** Low

`DockerProvider.getResourceUsage()` exists but is never called. There is no alerting when containers approach memory limits or CPU saturation. (Note: `TurnMetricsCollector` collects post-exit cgroup data, but does not provide real-time monitoring during task execution.)

**Recommended fix:** Integrate resource usage into the health endpoint or log periodic snapshots during task execution.

---

### 11. No container log persistence

**Severity:** Low

Container logs are streamed to code-agent via `LogForwarder` but are not persisted locally. If the code-agent is unreachable during a task, log data is lost after the chunk retry limit (3 attempts, 4s max backoff).

**Recommended fix:** Write container logs to `~/.claude-orchestrator/logs/{taskId}.log` as a fallback before streaming.

---

## Recent Improvements (v3.4.0)

The following items improved quality and capability since v3.3.0:

- **Review Agent plan awareness** — Review Agent now cross-references implementations against original plan documents, posting structured requirements coverage tables on PRs (INT-1038)
- **Linear proxy via code-agent** — Deep Validator fetches Linear issue context via code-agent instead of querying Linear GraphQL directly, improving resilience and decoupling (INT-1040)
- **Auto-enforcement of review findings** — Quality issues identified in code reviews are automatically acted upon without manual intervention (INT-926)
- **Unified task enqueue** — Queue-first dispatch ensures all tasks are durably recorded before execution (INT-950)
- **Plan-based review dispatch** — Review agent automatically triggered when plan review is needed, with `plan_review` as a new review type (INT-1039)
- **Separate image pull timeout** — 15-minute timeout for image pulls prevents slow networks from causing container creation failures (INT-1022)
- **Base branch fetch** — Worktree creation now fetches base branch first, preventing stale ref failures (INT-984)
- **Queue position fix** — Off-by-one error in queue position calculation and fan-out parent pollution corrected (INT-977)
- **Worker instruction sections** — System prompts include shared `WORKER_INSTRUCTIONS` constant for consistency (INT-972)
- **Selective container preservation** — Only execution and planning containers preserved; review and PR containers cleaned up immediately (INT-973)
- **MiniMax M2.7 migration** — MiniMax worker type updated from M2.5 to M2.7 model (INT-1009)
- **Fetch error cause chain** — Full cause chain logged for fetch errors instead of just top-level message (INT-1016)
- **Timeout increase** — Task execution timeout increased from 2h to 3h; queue TTL increased to 6h

---

## Debt Resolution Tracking

| ID  | Description                       | Created    | Resolved   | Ticket   |
| --- | --------------------------------- | ---------- | ---------- | -------- |
| 1   | Default repository hardcoded      | 2026-02-08 | -          | -        |
| 2   | Admin shutdown not wired          | 2026-02-08 | -          | -        |
| 3   | Duplicate JWT libraries           | 2026-02-08 | -          | -        |
| 4   | No horizontal scaling             | 2026-02-08 | -          | -        |
| 5   | Verifier has no circuit-breaker   | 2026-02-19 | -          | -        |
| 6   | No graceful container cancel      | 2026-02-08 | -          | -        |
| 7   | Deprecated Linear GraphQL usage   | 2026-03-22 | -          | INT-1040 |
| 8   | No orchestrator-side retry        | 2026-02-08 | -          | -        |
| 9   | No worktree cleanup on completion | 2026-02-08 | -          | -        |
| 10  | No resource usage monitoring      | 2026-02-08 | -          | -        |
| 11  | No local log persistence fallback | 2026-02-08 | -          | -        |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
