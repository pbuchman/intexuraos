# Code Agent — Technical Debt

**Last Updated:** 2026-03-07
**Analysis Run:** [2026-03-07 autonomous run]

---

## Summary

| Category       | Count  | Severity |
| -------------- | ------ | -------- |
| TODO comments  | 2      | Medium   |
| Code smells    | 4      | Low-Med  |
| Future plans   | 2      | Medium   |
| TS strictness  | 1      | Low      |
| SRP violations | 1      | High     |
| **Total**      | **10** | —        |

> Note: codeRoutes.ts has grown to ~3900 lines. Routing split is an ongoing priority.

---

## Future Plans

### 1. Actual system prompt versioning

Replace static hash placeholders with computed hashes from the real system prompt template. This enables prompt A/B testing and audit compliance.

**Files:** `processCodeAction.ts:221`, `codeRoutes.ts:1270`

### 2. Route splitting for codeRoutes.ts

Continue the pattern established by `routes/code/` and split the remaining routes by domain concern. See Code Smells section below for details.

---

## TODO Comments

### 1. System prompt hash is a static placeholder

**File:** `apps/code-agent/src/domain/usecases/processCodeAction.ts:221`

```typescript
systemPromptHash: 'system-prompt-hash-v1', // TODO: Compute from actual system prompt
```

**File:** `apps/code-agent/src/routes/codeRoutes.ts:1270`

```typescript
systemPromptHash: 'default', // TODO: Use actual system prompt hash
```

The `systemPromptHash` field is designed for audit tracking — recording which version of the system prompt was active when the task ran. Currently it stores a hardcoded string, making it impossible to audit prompt version changes.

**Impact:** Audit trail gap — no way to correlate task results with the system prompt version that generated them.

**Remediation:** Compute SHA-256 of the actual system prompt template at startup and inject it via config.

---

## Code Smells

### 1. codeRoutes.ts is ~3900 lines (SRP violation)

**File:** `apps/code-agent/src/routes/codeRoutes.ts`

This single file contains all internal code task routes AND all public code task routes — over 3900 lines. It handles task submission, task updates, task listing, task cancellation, heartbeats, zombie detection, log cleanup, retry, feedback, mid-task messaging, execution agent submission, queue draining, and worker status. Each route includes inline Fastify schema definitions that consume significant line count. New routes are added to `routes/code/` as separate files (e.g., `github-pre-events.ts`, `github-pr-summaries.ts`) but the original routes remain consolidated.

**Impact:** Difficult to navigate, review, and test. Changes to one route risk unintended effects on others.

**Remediation:** Continue the pattern established by `routes/code/` and split the remaining routes by domain concern:

- `routes/code/submit.ts` (public submit)
- `routes/code/tasks.ts` (public list/get/cancel)
- `routes/code/retry.ts` (public retry)
- `routes/code/feedback.ts` (public feedback)
- `routes/code/messages.ts` (public sendTaskMessage)
- `routes/internal/process.ts` (internal code action processing)
- `routes/internal/taskUpdate.ts` (internal task PATCH)
- `routes/internal/maintenance.ts` (heartbeat, zombies, cleanup, drain)

### 2. ESLint disabled for entire route files

**Files:** `codeRoutes.ts:1`, `webhookRoutes.ts:1`

```typescript
/* eslint-disable */
```

Both files have ESLint completely disabled at the file level, silencing all linting rules including safety-critical ones like `@typescript-eslint/no-unsafe-*`.

**Impact:** Type safety and code quality rules are not enforced in the most complex route files.

**Remediation:** Remove the blanket disable, address individual lint issues, and use targeted `eslint-disable-next-line` comments where genuinely necessary.

### 3. In-flight health probe deduplication uses module-level Map

**File:** `apps/code-agent/src/routes/codeRoutes.ts:32`

```typescript
const inFlightRequests = new Map<string, Promise<void>>();
```

Module-level mutable state for deduplicating concurrent health probes. This map grows unbounded if entries are not cleaned up properly.

**Impact:** Potential memory leak in long-running instances if the cleanup logic has edge cases.

**Remediation:** Add a TTL-based cleanup or use a WeakMap pattern.

### 4. Drain queue guard uses module-level boolean

**File:** `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:22`

```typescript
let isDraining = false;
```

Module-level mutable state for preventing concurrent drain operations. Works for single-instance deployment (Cloud Run scale 0-1) but would break with multiple instances.

**Impact:** Not a problem in current deployment (single instance), but would become a race condition if scaled horizontally.

**Remediation:** Use Firestore-based distributed lock if multi-instance deployment is planned.

---

## TypeScript Strictness Issues

### Firestore Timestamp handling

Throughout the codebase, Firestore `Timestamp` objects require runtime type narrowing when serializing to JSON. The `timestampToIso()` helper handles this but requires `as` casts:

```typescript
createdAt: timestampToIso(task.createdAt as { toDate: () => Date } | string | undefined) ?? '',
```

This pattern appears in `codeRoutes.ts` and could benefit from a typed wrapper that encapsulates the Firestore Timestamp vs. plain Date distinction.

---

## Test Coverage Notes

The service has 45+ test files covering domain models, use cases, infra adapters, and routes. Coverage exemptions use the `/* v8 ignore <CATEGORY> — reason @preserve */` pattern with valid categories.

Common exemption categories in this service:

- `ts-type`: TypeScript type narrowing branches (nullish coalescing, optional chaining)
- `test-infra`: Paths requiring complex test infrastructure setup
- `upstream`: Error handling for external service failures

---

## Resolved Issues

| Issue   | Description                                       | Resolution                                                                     |
| ------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| INT-372 | Zombie task detection                             | Heartbeat + 30-min threshold implemented                                       |
| INT-379 | WhatsApp cancel button                            | Cancel nonce with 15-min TTL                                                   |
| INT-413 | Prompt injection sanitization                     | sanitizePromptForInjection() with system keyword/base64/control char rejection |
| INT-465 | PR comment auto-response                          | Simplified via sendTaskMessage dispatch from webhook handler                   |
| INT-486 | Unified Linear issue templates                    | Agent-based execution model (planned/implemented statuses)                     |
| INT-505 | Rich PR activity timeline                         | Clickable links, comment bodies, deduplication                                 |
| INT-519 | Block agents from QA/Done transitions             | Validate-linear-state hook                                                     |
| INT-520 | Retry mechanism for failed tasks                  | retryTask use case with cool-off                                               |
| INT-612 | Prompt sanitization not implemented               | sanitizePrompt() utility applied at all prompt entry points                    |
| INT-619 | Task queueing when workers busy                   | Queue with TTL, drain via Cloud Scheduler, lock cleanup                        |
| INT-711 | Retried tasks clutter task list                   | Original task archived to `archived` status on retry                           |
| INT-725 | Planning tasks not linked to execution            | backLinkPlanningTask sets implementationTaskId on planning task                |
| INT-738 | WhatsApp notifications lack direct links          | CTA URL buttons with deep links to PR and task dashboard                       |
| —       | Duplicate PR body in synchronize events           | deduplicatePRBody() pass in GET /code/github-pr-events                         |
| —       | Edited comment creates duplicate timeline entry   | deduplicateCommentEvents() keeps first position, latest body                   |
| —       | Turn-end metrics not collected                    | TurnMetrics subcollection + FirestoreTurnMetricsRepository                     |
| —       | No way to send mid-task messages or resume        | sendTaskMessage use case + POST /code/tasks/:id/messages                       |
| —       | PR list view requires O(events) query             | github-pr-summaries collection + GET /code/github-pr-summaries                 |
| —       | Webhook dedup used shared actionId                | Unique per-submission actionId + propagated dedup errors                       |
| —       | Sender whitelist for webhook dispatch             | Replaced scattered filters with ALLOWED_BOTS Set + owner check                 |
| —       | Bot review edit triage                            | Dispatch message includes in-progress detection instructions                   |
| —       | Linear not transitioned on completion             | markInReview called on task-complete webhook when PR exists                    |
| —       | CPU cores hardcoded in metrics                    | Dynamic cgroup-based core count from orchestrator                              |
| —       | Cloudflare errors not retryable                   | 520-530 status codes treated as retryable infrastructure errors                |
| —       | Linear data stale in task list                    | Live hydration of Linear issue data via linearAgentClient                      |
| —       | No PR comment task creation without existing task | createTaskForPR use case with lock guard and user lookup                       |
| —       | Linear labels not persisted on tasks              | linearIssueLabels field added to CodeTask model                                |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
