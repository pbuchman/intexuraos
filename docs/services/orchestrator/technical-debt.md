# Orchestrator — Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** [2026-04-22 — orchestrator v3.6.0](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 2     | Low      |
| Architectural Gaps  | 4     | Medium   |
| Missing Features    | 3     | Medium   |
| **Total**           | **9** | Medium   |

---

## Future Plans

### Multi-Machine Orchestration

Distribute tasks across multiple hosts or dev machines:

1. Central task queue (Pub/Sub) instead of direct HTTP dispatch
2. Orchestrator instances register with code-agent and pull tasks
3. Shared state in Firestore instead of local JSON

### Container Image Versioning

Pin code-worker images to specific versions instead of `:latest`:

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

### 5. Agent compliance validation has no circuit-breaker

**Severity:** Medium

When all compliance validation models in the chain are unavailable (network error, rate limit, API outage), execution tasks can lose the independent transcript audit even though deterministic `verifyCompletion()` still validates the final block. The configurable model chain mitigates this partially - if the first model fails, the validator tries the next - but a complete API outage across all configured providers still removes that extra assurance layer.

**Recommended fix:** Add a circuit-breaker pattern: after N consecutive compliance validation failures across all models within a time window, skip compliance validation with an explicit warning and continue relying on deterministic completion verification. Re-enable compliance validation after the circuit resets.

---

### 6. No graceful container shutdown on task cancel

**Severity:** Medium

`cancelTask()` calls `destroyWorker()` which sends SIGTERM and then force-removes the container. The active worker runtime does not receive a chance to save progress, push partial work, or clean up.

**Recommended fix:** Implement a two-phase cancellation:

1. Send a "please stop" message via container stdin
2. Wait a configurable grace period (e.g., 60 seconds)
3. Fall back to SIGTERM/SIGKILL

---

## Missing Features

### 7. No task retry from the orchestrator

**Severity:** Medium

The `retriedFrom` field exists on tasks (now declared in the request schema), but retry logic lives entirely in code-agent. The orchestrator has no self-service retry capability (e.g., retrying a task that failed due to transient Docker issues).

**Recommended fix:** Add a `POST /tasks/:id/retry` endpoint that creates a new task with the same parameters and `retriedFrom` pointing to the original.

---

### 8. No worktree cleanup on completed tasks

**Severity:** Medium

Worktrees accumulate until manually cleaned or the stale threshold is exceeded. Completed tasks leave worktrees behind until the next periodic cleanup or restart.

**Recommended fix:** Call worktree cleanup in `handleTaskCompletion()` or tighten the periodic cleanup interval for completed task worktrees.

---

### 9. No resource usage monitoring

**Severity:** Low

`DockerProvider.getResourceUsage()` exists but is never called. There is no alerting when containers approach high memory usage or CPU saturation. (Note: `TurnMetricsCollector` collects post-exit cgroup data, but does not provide real-time monitoring during task execution.)

**Recommended fix:** Integrate resource usage into the health endpoint or log periodic snapshots during task execution.

---

## Recent Improvements (current release documentation)

The following release-relevant reliability changes landed since v3.7.0:

- **Terminal finalization before Docker cleanup** - completed tasks persist terminal state, release capacity, commit status, and send webhooks before worker teardown; cleanup is timeout-bound so Docker hangs do not leave tasks stuck in `running`.
- **Best-effort zombie cleanup** - late containers created after a startup timeout are destroyed on a bounded cleanup path.
- **Handled Sentry noise reduction** - expected reliability-path warnings for route 4xx responses, webhook retries, verifier hard errors, task timers, and final worker cleanup are tagged to skip Sentry capture while remaining in logs.

## Recent Improvements (v3.6.0)

The following items improved quality and capability since v3.5.0:

- **Execution memory pipeline simplification** — memory_acknowledgment downgraded to soft warning when the usage triplet is consistent, preventing memory reporting issues from stalling tasks (INT-1403)
- **Robust memory_acknowledgment recovery** — Fixed regression stalling code-review tasks with three targeted PRs addressing the verifier stall, prompt fix, and pattern matching edge cases (INT-1411, INT-1415)
- **Log cap raised to 8MB** — Prevents log truncation on verbose builds
- **Task timeout default extended to 5 hours** — Per-task `timeoutHours` overrides can set 1 to 12 hours, with warnings five minutes before the configured kill time
- **StatusUpdateClient** — Redundant terminal status delivery via direct PATCH to code-agent alongside webhooks (INT-1413)
- **Docker RFC3339 timestamp stripping** — Fixed log formatter to properly strip Docker-prepended RFC3339 timestamps (INT-1411)
- **Validation model chain for resume summaries and compliance** — Configurable validation models replace hardcoded Gemini where LLM validation is still used (INT-1371)
- **Gemini client usage mapping** — Validation model clients use HttpWebhookUsageSink for cost tracking (INT-1369)
- **mimo-pro worker type** — Xiaomi MiMo Pro 2.5 as a new execution backend
- **test_quality review scope** — Review type covering test quality analysis
- **Inactivity restart tracking** — `inactivityRestartCount` persisted for observability
- **retriedFrom field** — Declared in CreateTaskRequestSchema for retry chain tracking
- **LLM usage sinks migrated to HTTP** — Replaced direct pricing with HttpWebhookUsageSink (INT-1342)

---

## Resolved Issues

| Date       | Issue                                     | Resolution                                                                        |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| 2026-04-22 | Memory acknowledgment stalling tasks      | Downgraded to soft warning when usage triplet is consistent (INT-1403)            |
| 2026-04-22 | Memory verifier regression on code-review | Fixed auto-continue prompt and pattern matching (INT-1411, INT-1415)              |
| 2026-04-22 | Log truncation on verbose builds          | Raised log cap from 4MB to 8MB                                                    |
| 2026-04-22 | Docker RFC3339 timestamps in logs         | Fixed stripDockerHeaders() to handle RFC3339 format (INT-1411)                    |
| 2026-04-22 | Hardcoded Gemini for LLM validation       | Configurable validation model chain via INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS |
| 2026-04-07 | Deep Validator was monolithic             | Replaced with modular Agent Compliance Validator using OpenRouter                 |
| 2026-04-07 | No Codex runtime support                  | Full Codex backend with auth, log processing, two worker presets                  |
| 2026-04-07 | No review finding auto-remediation        | Remediation Agent autonomously addresses findings                                 |
| 2026-04-07 | No cross-task learning                    | Execution Memory Graph injects past patterns into prompts                         |
| 2026-04-07 | Direct Linear GraphQL queries             | Removed — code-agent proxy is now the only path                                   |
| 2026-04-07 | No interactive sessions                   | Ask Agent provides code-aware Q&A without PR overhead                             |
| 2026-04-07 | Container log persistence missing         | Session transcripts now read from JSONL files for compliance validation           |
| 2026-03-22 | Review Agent lacked plan awareness        | Review Agent cross-references implementations against plan documents              |
| 2026-03-22 | Linear fetched directly from orchestrator | Linear proxy via code-agent replaces direct GraphQL                               |

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
| 7   | Deprecated Linear GraphQL usage   | 2026-03-22 | 2026-04-07 | INT-1040 |
| 8   | No orchestrator-side retry        | 2026-02-08 | -          | -        |
| 9   | No worktree cleanup on completion | 2026-02-08 | -          | -        |
| 10  | No resource usage monitoring      | 2026-02-08 | -          | -        |
| 11  | No local log persistence fallback | 2026-02-08 | 2026-04-07 | -        |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
