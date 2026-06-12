# Code Agent — Technical Debt

**Last Updated:** 2026-06-12
**Analysis Run:** [2026-06-12 release 3.7.0 Service Scribe pass]

## Summary

| Category       | Count  | Severity |
| -------------- | ------ | -------- |
| TODO comments  | 2      | Medium   |
| Code smells    | 2      | Low-Med  |
| Future plans   | 3      | Medium   |
| TS strictness  | 2      | Low      |
| SRP violations | 0      | None     |
| **Total**      | **9**  | n/a      |

> Note: the INT-1430 route split is complete: `codeRoutes.ts` is now a composition plugin and route logic lives in resource-specific modules. Remaining release 3.7.0 debt centers on prompt hash auditability, distributed drain guards, and execution memory maturation.

## Future Plans

### 1. Actual system prompt versioning

Replace static hash placeholders with computed hashes from the real system prompt template. This enables prompt A/B testing and audit compliance.

**Files:** `processCodeAction.ts:26`, `routes/code/task-routes.ts:1683`

### 2. Distributed drain queue guard

Replace module-level `isDraining` and `isDrainingRetries` booleans with Firestore-based distributed locks if multi-instance deployment is planned. Currently safe for the single-process service deployment.

### 3. Execution memory pipeline maturation

The execution memory graph is in alpha. Planned improvements include tuning rerank thresholds and scoring weights, refining distillation prompts for higher-quality memories, expanding component hints guidance, and improving the evaluation pipeline for post-run memory feedback. The `labelHints` signal was recently removed from the scoring pipeline after proving unreliable.

## TODO Comments

### 1. System prompt hash is a static placeholder

**File:** `apps/code-agent/src/domain/usecases/processCodeAction.ts:26`

```typescript
// TODO: Compute from actual system prompt content instead of using a static placeholder.
```

**File:** `apps/code-agent/src/routes/code/task-routes.ts:1683`

```typescript
systemPromptHash: 'default', // TODO: Use actual system prompt hash
```

The `systemPromptHash` field is designed for audit tracking — recording which version of the system prompt was active when the task ran. Currently it stores a hardcoded string, making it impossible to audit prompt version changes.

**Impact:** Audit trail gap — no way to correlate task results with the system prompt version that generated them.

**Remediation:** Compute SHA-256 of the actual system prompt template at startup and inject it via config.

## Code Smells

### 1. In-flight health probe deduplication uses module-level Map

**File:** `apps/code-agent/src/routes/code/task-routes.ts`

Module-level mutable state for deduplicating concurrent health probes. This map grows unbounded if entries are not cleaned up properly.

**Impact:** Potential memory leak in long-running instances if the cleanup logic has edge cases.

**Remediation:** Add a TTL-based cleanup or use a WeakMap pattern.

### 2. Drain queue guards use module-level booleans

**Files:** `domain/usecases/drainTaskQueue.ts`, `domain/usecases/drainRetryQueue.ts`

Module-level mutable state for preventing concurrent drain operations. Works for the current single-process service deployment but would break with multiple instances.

**Impact:** Not a problem in current deployment (single instance), but would become a race condition if scaled horizontally.

**Remediation:** Use Firestore-based distributed lock if multi-instance deployment is planned.

## TypeScript Strictness Issues

### 1. Firestore Timestamp handling

Throughout the codebase, Firestore `Timestamp` objects require runtime type narrowing when serializing to JSON. The `timestampToIso()` helper handles this but requires `as` casts. This pattern appears in `routes/code/*`, `mergeQueueRoutes.ts`, and `issueGroupRoutes.ts` and could benefit from a typed wrapper.

### 2. `any` type usage in Firestore queries

**File:** `infra/repositories/firestoreCodeTaskRepository.ts`

Two instances of `as any` for Firestore document mapping:

```typescript
const tasks = resultDocs.map((doc: any) => ...
const tasks = snapshot.docs.map((doc: any) => ...
```

**Impact:** Low — these are infrastructure-layer Firestore SDK type coercions, not domain logic.

**Remediation:** Use typed Firestore converters to eliminate the `any` casts.

## Test Coverage Notes

The service has 50+ test files covering domain models, use cases, infra adapters, and routes. Coverage exemptions use the `/* v8 ignore <CATEGORY> -- reason @preserve */` pattern with valid categories.

Common exemption categories in this service:

- `ts-type`: TypeScript type narrowing branches (nullish coalescing, optional chaining)
- `test-infra`: Paths requiring complex test infrastructure setup (e.g., FakeFirestore limitations)
- `upstream`: Error handling for external service failures

Several v8 ignore blocks were replaced with real tests in previous releases (INT-1071, INT-1072, INT-1073, INT-1237).

## Resolved Issues

| Issue    | Description                                        | Resolution                                                                             |
| -------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| INT-1430 | `codeRoutes.ts` route monolith                     | Split into a 41-line composition plugin plus resource-specific route modules           |
| INT-1468 | Code tasks could only dispatch immediately         | `scheduledDispatch` stores future eligibility; queue drain skips until `notBeforeAt`   |
| INT-1585 | Longer automation needed per-task time budgets     | `timeoutHours` persisted on `CodeTask` and forwarded to orchestrator dispatch payload  |
| INT-1630 | GitHub Agent needed Gemini 3 Flash support         | OpenRouter Gemini 3 Flash Preview wired through `resolveToolCallingClient`             |
| INT-1650 | Dispatch failures lacked task-visible status       | Task-level `dispatchStatus` and recoverable/terminal blocker handling added            |
| INT-1652 | Dispatch blockers lacked diagnostics/notifications | Worker health diagnostics, dispatch log/PR/WhatsApp reporter, and notification ledger  |
| INT-1657 | Callback ownership could follow worker location    | Callback owner now derives from task webhook URL and public bases normalize to `/api/code` |
| INT-1658 | `/api/code/internal/*` callback routing hit deny rule | Nginx routing fixed so code-agent callback paths route before generic internal deny  |
| PR #2126 | Callback auth diagnostics were incomplete          | Per-task webhook HMAC accepted for callback family; `callbackState` persisted/exposed  |
| PR #2126 | Issue group counts included hidden phantom groups  | `GET /issue-groups` subtracts summaries with no displayable tasks from badge counts    |
| PR #2111 | Public API resource paths were doubled in callers  | Public code-agent resources normalized under `/api/code` without `/code` duplication   |
| INT-1414 | Task finalization stalls on webhook timeout        | Dedicated `PATCH /internal/code-tasks/:id/status` endpoint for idempotent status write |
| INT-1406 | PR triage blocks webhook response                  | Moved to Pub/Sub push subscription — webhook returns immediately                       |
| INT-1383 | No way to mark issue groups as high-priority       | `POST /issue-groups/:groupKey/important` endpoint with `isImportant` flag         |
| INT-1389 | GitHub Agent uses hardcoded model                  | Replaced later by OpenRouter Gemini 3 Flash Preview with user/platform key resolution  |
| INT-1360 | Cannot skip design phase for known-good tasks      | `taskMode` parameter on `POST /submit` — choose planning or execution explicitly  |
| INT-1345 | Code tasks triggered on draft PRs waste compute    | `DraftPRRule` blocks all code tasks when `isDraft === true`                            |
| INT-1380 | Merge step attempted on closed/merged PRs          | Pipeline suppresses merge step for closed/merged PRs                                   |
| INT-1375 | Failed tasks not auto-retried on different worker  | Self-healing triage with `autoRetryTask` — up to 3 retries excluding failed worker     |
| INT-1361 | Inactivity restart dispatches to wrong PR          | PR URL validation + `prUrlValidationFailed` field for audit                            |
| INT-1378 | Usage webhook gateway schema mismatch              | Migrated to v2 schema for consistency with llm-usage-service                           |
| INT-1098 | Execution memory retrieval pipeline                | Pre-run vector retrieval with query normalization, reranking, and application tracking |
| INT-1257 | Execution memory distillation pipeline             | Post-run LLM distillation with evaluation, fingerprinting, and deduplication           |
| INT-1087 | Remediation agent for review findings              | Autonomous remediation tasks with cross-LLM verification                               |
| INT-1132 | Review-outcome merge labels                        | Ready-to-merge label set on review skip; merge pipeline wired                          |
| INT-1279 | PR evidence enforcement                            | PR presence enforced for planning and remediation outcomes                             |
| INT-1292 | PR evidence for all task types                     | Enforcement extended to all task types, not just execution                             |
| INT-1287 | Internal code submit endpoint                      | POST /internal/code/submit for internal task creation                                  |
| INT-1291 | Ask Agent sessions                                 | Interactive Claude Code sessions from web UI                                           |
| INT-1173 | Issue group aggregation                            | Server-side grouping with TaskGroupSummary and UserGroupCounts                         |
| INT-1276 | Auto-archive merged tasks                          | Daily cron archives tasks with PRs merged 7+ days ago                                  |
| INT-1166 | Batch archive                                      | Archive multiple groups in a single operation                                          |
| INT-1086 | Sender authorization                               | Unauthorized senders receive GitHub comment explaining rejection                       |
| INT-1131 | Drain queue deadlock                               | Per-PR guard prevents deadlock; stale task fallback                                    |
| INT-1190 | Queue PR-lock self-healing                         | Self-healing for stale PR-task locks in drain queue                                    |
| INT-853  | CI failure auto-handling                           | Failed CI checks on agent PRs detected and retried/escalated                           |
| INT-1124 | Per-agent-type worker settings                     | Different agent types independently tuned for worker type                              |
| INT-1071 | V8 ignore blocks replaced                          | Real tests added for previously exempted branches                                      |
| INT-1020 | Merge queue for ordered PR merging                 | Merge queue watch + Cloud Scheduler tick + GitHub as source of truth                   |
| INT-1023 | Merge conflict detection blocking webhooks         | Dedicated cron job for reconciliation, decoupled from webhook pipeline                 |
| INT-1040 | Orchestrator direct Linear dependency              | Code-agent proxy endpoint for issue context                                            |
| INT-1027 | Cannot inspect raw webhook payloads                | Expandable rows + GET /github-event-log/:id/payload endpoint                      |
| INT-1025 | GitHub Event Log shows unsupported event types     | Server-side filtering to VISIBLE_EVENT_TYPES                                           |
| INT-1029 | Task queue capacity too small                      | Queue capacity increased from 10 to 50                                                 |
| INT-1048 | Merge queue reliability issues                     | GitHub as source of truth, Firestore as synchronized cache                             |
| INT-1043 | Reconciliation processes closed PRs                | Skip closed PRs during reconciliation                                                  |
| INT-1049 | Merge queue tick not scheduled                     | Cloud Scheduler trigger for merge queue tick                                           |
| INT-1046 | Merge queue sort incorrect                         | Fixed sort by PR number and watchId mapping                                            |
| INT-1062 | Main branch usable as merge queue base             | Blocked with BLOCKED_BASE_BRANCHES guard and blocked flag in UI                        |
| INT-372  | Zombie task detection                              | Heartbeat + 30-min threshold implemented                                               |
| INT-379  | WhatsApp cancel button                             | Cancel nonce with 15-min TTL                                                           |
| INT-413  | Prompt injection sanitization                      | sanitizePromptForInjection() with system keyword/base64/control char rejection         |
| INT-465  | PR comment auto-response                           | Simplified via sendTaskMessage dispatch from webhook handler                           |
| INT-486  | Unified Linear issue templates                     | Agent-based execution model (planned/implemented statuses)                             |
| INT-505  | Rich PR activity timeline                          | Clickable links, comment bodies, deduplication                                         |
| INT-519  | Block agents from QA/Done transitions              | Validate-linear-state hook                                                             |
| INT-520  | Retry mechanism for failed tasks                   | retryTask use case with cool-off                                                       |
| INT-612  | Prompt sanitization not implemented                | sanitizePrompt() utility applied at all prompt entry points                            |
| INT-619  | Task queueing when workers busy                    | Queue with TTL, drain via Cloud Scheduler, lock cleanup                                |
| INT-711  | Retried tasks clutter task list                    | Original task archived to `archived` status on retry                                   |
| INT-725  | Planning tasks not linked to execution             | backLinkPlanningTask sets implementationTaskId on planning task                        |
| INT-738  | WhatsApp notifications lack direct links           | CTA URL buttons with deep links to PR and task dashboard                               |
| INT-743  | GitHub Agent for PR evaluation                     | LLM tool-calling agent with unified evaluator pipeline                                 |
| INT-744  | Unified webhook evaluator                          | Two-tier evaluation: hard rules then LLM triage with audit trail                       |
| INT-773  | Already-completed execution outcome                | `already_completed` execution outcome label added                                      |
| INT-780  | v8 coverage gaps in codeRoutes.ts                  | Refactored and added tests for uncovered branches                                      |
| INT-807  | Tasks created as dispatched before confirmed       | Tasks created as `queued`, transitioned to `dispatched` on confirmed dispatch          |
| INT-810  | Silent dispatch failures                           | Fixed nested transaction and propagated dispatch errors                                |
| INT-823  | Failed webhook dispatch retry                      | Dispatch retry queue with bounded attempts and TTL                                     |
| INT-824  | PR branch lost on retry                            | Task retries inherit open PR branches via continuationPr utility                       |
| INT-825  | Duplicate review tasks                             | Review task dedup with active-task semantics                                           |
| INT-826  | Dispatch acks not restart-safe                     | Tasks start as `queued`, only move to `dispatched` after worker ACK                    |
| INT-829  | @review issue comment triage                       | LLM-selected worker routing for @review commands                                       |
| INT-830  | No visibility into dispatch rejections             | Explicit PR comments for review skips, dispatch rejections, and outcomes               |
| INT-834  | Unreliable review agent dispatch                   | Fresh-start retry logic, notification deduplication                                    |
| INT-839  | Triage produces unreliable output                  | Structured output validation with Zod schemas and repair prompts                       |
| INT-846  | Noisy "Review Completed" PR notifications          | Removed redundant automated review completed notification                              |
| INT-847  | Merge conflicts on bot PRs undetected              | Merge conflict detection for bot-authored PRs with owner remapping                     |
| INT-852  | PR automation scattered across comments            | Unified PR automation log as single append-only GitHub comment                         |
| INT-854  | Gemini triage failures                             | Enforced tool-call mode, retry with corrective context on LLM failure                  |
| INT-860  | Flaky automationLogFlows test                      | Mock both LLM retry attempts to stabilize test                                         |
| INT-916  | Fixed-delay test waits cause flakiness             | Replaced fixed delays with poll-based test helpers                                     |
| INT-918  | PR event log too noisy                             | Filtered redundant events, added context fields to remaining entries                   |
| INT-921  | Review tasks not queued when busy                  | Queue support for review tasks when workers at capacity                                |
| INT-924  | Redundant triage PR comments                       | Removed redundant "Automated Code Review Triage Decision" comments                     |

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Documentation Run Log](../../documentation-runs.md)
