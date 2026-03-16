# Code Agent — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 autonomous run — v3.3.0 force refresh]

---

## Summary

| Category       | Count  | Severity |
| -------------- | ------ | -------- |
| TODO comments  | 2      | Medium   |
| Code smells    | 4      | Low–Med  |
| Future plans   | 3      | Medium   |
| TS strictness  | 2      | Low      |
| SRP violations | 1      | High     |
| **Total**      | **12** | —        |

> Note: codeRoutes.ts remains a large file. Routing split is an ongoing priority. New routes are correctly added to `routes/code/` as separate files.

---

## Future Plans

### 1. Actual system prompt versioning

Replace static hash placeholders with computed hashes from the real system prompt template. This enables prompt A/B testing and audit compliance.

**Files:** `processCodeAction.ts:214`, `codeRoutes.ts:1292`

### 2. Route splitting for codeRoutes.ts

Continue the pattern established by `routes/code/` and split the remaining routes by domain concern. See Code Smells section below for details.

### 3. Distributed drain queue guard

Replace module-level `isDraining` and `isDrainingRetries` booleans with Firestore-based distributed locks if multi-instance deployment is planned. Currently safe for Cloud Run scale 0-1.

---

## TODO Comments

### 1. System prompt hash is a static placeholder

**File:** `apps/code-agent/src/domain/usecases/processCodeAction.ts:214`

```typescript
systemPromptHash: 'system-prompt-hash-v1', // TODO: Compute from actual system prompt
```

**File:** `apps/code-agent/src/routes/codeRoutes.ts:1292`

```typescript
systemPromptHash: 'default', // TODO: Use actual system prompt hash
```

The `systemPromptHash` field is designed for audit tracking — recording which version of the system prompt was active when the task ran. Currently it stores a hardcoded string, making it impossible to audit prompt version changes.

**Impact:** Audit trail gap — no way to correlate task results with the system prompt version that generated them.

**Remediation:** Compute SHA-256 of the actual system prompt template at startup and inject it via config.

---

## Code Smells

### 1. codeRoutes.ts is a large file (SRP violation)

**File:** `apps/code-agent/src/routes/codeRoutes.ts`

This single file contains all internal code task routes AND all public code task routes. It handles task submission, task updates, task listing, task cancellation, heartbeats, zombie detection, log cleanup, retry, feedback, mid-task messaging, execution agent submission, and queue draining. Each route includes inline Fastify schema definitions that contribute significant line count. New routes are added to `routes/code/` as separate files (e.g., `github-pre-events.ts`, `github-pr-summaries.ts`, `github-event-log.ts`) but the original routes remain consolidated.

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

**File:** `apps/code-agent/src/routes/codeRoutes.ts`

Module-level mutable state for deduplicating concurrent health probes. This map grows unbounded if entries are not cleaned up properly.

**Impact:** Potential memory leak in long-running instances if the cleanup logic has edge cases.

**Remediation:** Add a TTL-based cleanup or use a WeakMap pattern.

### 4. Drain queue guards use module-level booleans

**Files:** `domain/usecases/drainTaskQueue.ts`, `domain/usecases/drainRetryQueue.ts`

Module-level mutable state for preventing concurrent drain operations. Works for single-instance deployment (Cloud Run scale 0-1) but would break with multiple instances.

**Impact:** Not a problem in current deployment (single instance), but would become a race condition if scaled horizontally.

**Remediation:** Use Firestore-based distributed lock if multi-instance deployment is planned.

---

## TypeScript Strictness Issues

### 1. Firestore Timestamp handling

Throughout the codebase, Firestore `Timestamp` objects require runtime type narrowing when serializing to JSON. The `timestampToIso()` helper handles this but requires `as` casts. This pattern appears in `codeRoutes.ts` and could benefit from a typed wrapper.

### 2. `any` type usage in Firestore queries

**File:** `infra/repositories/firestoreCodeTaskRepository.ts`

Two instances of `as any` for Firestore document mapping:

```typescript
const tasks = resultDocs.map((doc: any) => ...
const tasks = snapshot.docs.map((doc: any) => ...
```

**Impact:** Low — these are infrastructure-layer Firestore SDK type coercions, not domain logic.

**Remediation:** Use typed Firestore converters to eliminate the `any` casts.

---

## Test Coverage Notes

The service has 50+ test files covering domain models, use cases, infra adapters, and routes. Coverage exemptions use the `/* v8 ignore <CATEGORY> — reason @preserve */` pattern with valid categories.

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
| INT-743 | GitHub Agent for PR evaluation                    | Gemini tool-calling agent with unified evaluator pipeline                      |
| INT-744 | Unified webhook evaluator                         | Two-tier evaluation: hard rules then LLM triage with audit trail               |
| INT-773 | Already-completed execution outcome               | `already_completed` execution outcome label added                              |
| INT-780 | v8 coverage gaps in codeRoutes.ts                 | Refactored and added tests for uncovered branches                              |
| INT-807 | Tasks created as dispatched before confirmed      | Tasks created as `queued`, transitioned to `dispatched` on confirmed dispatch  |
| INT-810 | Silent dispatch failures                          | Fixed nested transaction and propagated dispatch errors                        |
| INT-823 | Failed webhook dispatch retry                     | Dispatch retry queue with bounded attempts and TTL                             |
| INT-824 | PR branch lost on retry                           | Task retries inherit open PR branches via continuationPr utility               |
| INT-825 | Duplicate review tasks                            | Review task dedup with active-task semantics                                   |
| INT-826 | Dispatch acks not restart-safe                    | Tasks start as `queued`, only move to `dispatched` after worker ACK            |
| INT-829 | @review issue comment triage                      | LLM-selected worker routing for @review commands                               |
| INT-830 | No visibility into dispatch rejections            | Explicit PR comments for review skips, dispatch rejections, and outcomes       |
| INT-834 | Unreliable review agent dispatch                  | Fresh-start retry logic, notification deduplication                            |
| INT-839 | Triage produces unreliable output                 | Structured output validation with Zod schemas and repair prompts               |
| INT-846 | Noisy "Review Completed" PR notifications         | Removed redundant automated review completed notification                      |
| INT-847 | Merge conflicts on bot PRs undetected             | Merge conflict detection for bot-authored PRs with owner remapping             |
| INT-852 | PR automation scattered across comments           | Unified PR automation log as single append-only GitHub comment                 |
| INT-854 | Gemini triage failures                            | Enforced tool-call mode, retry with corrective context on LLM failure          |
| INT-860 | Flaky automationLogFlows test                     | Mock both LLM retry attempts to stabilize test                                 |
| INT-916 | Fixed-delay test waits cause flakiness            | Replaced fixed delays with poll-based test helpers                             |
| INT-918 | PR event log too noisy                            | Filtered redundant events, added context fields to remaining entries           |
| INT-921 | Review tasks not queued when busy                 | Queue support for review tasks when workers at capacity                        |
| INT-924 | Redundant triage PR comments                      | Removed redundant "Automated Code Review Triage Decision" comments             |
| ---     | Duplicate PR body in synchronize events           | deduplicatePRBody() pass in GET /code/github-pr-events                         |
| ---     | Edited comment creates duplicate timeline entry   | deduplicateCommentEvents() keeps first position, latest body                   |
| ---     | Turn-end metrics not collected                    | TurnMetrics subcollection + FirestoreTurnMetricsRepository                     |
| ---     | No way to send mid-task messages or resume        | sendTaskMessage use case + POST /code/tasks/:id/messages                       |
| ---     | PR list view requires O(events) query             | github-pr-summaries collection + GET /code/github-pr-summaries                 |
| ---     | Webhook dedup used shared actionId                | Unique per-submission actionId + propagated dedup errors                       |
| ---     | Sender whitelist for webhook dispatch             | Replaced scattered filters with ALLOWED_BOTS Set + owner check                 |
| ---     | Linear not transitioned on completion             | markInReview called on task-complete webhook when PR exists                    |
| ---     | CPU cores hardcoded in metrics                    | Dynamic cgroup-based core count from orchestrator                              |
| ---     | Cloudflare errors not retryable                   | 520-530 status codes treated as retryable infrastructure errors                |
| ---     | Linear data stale in task list                    | Live hydration of Linear issue data via linearAgentClient                      |
| ---     | No PR comment task creation without existing task | createTaskForPR use case with lock guard and user lookup                       |
| ---     | Linear labels not persisted on tasks              | linearIssueLabels field added to CodeTask model                                |
| ---     | Gemini tool calling loop in PR triage             | Fixed loop exit condition and Firestore automation log path                    |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
