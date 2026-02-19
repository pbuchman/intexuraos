# Code Agent - Technical Debt

## Summary

| Category       | Count | Severity |
| -------------- | ----- | -------- |
| TODO comments  | 3     | Medium   |
| Code smells    | 4     | Low-Med  |
| Future plans   | 2     | Medium   |
| TS strictness  | 1     | Low      |
| SRP violations | 1     | High     |

> Note: codeRoutes.ts has grown from ~1200 to 3500+ lines as new features were added. Routing split is an ongoing priority.

## TODO Comments

### 1. Prompt sanitization not implemented

**File:** `apps/code-agent/src/domain/usecases/processCodeAction.ts:214`

```typescript
sanitizedPrompt: prompt, // TODO: Add sanitization
```

The `sanitizedPrompt` field exists in the domain model but currently stores the raw prompt verbatim. The design doc references sanitization logic (lines 1130-1165) including removal of secrets, PII, and injection patterns. Without sanitization, prompts containing sensitive data pass through to workers unfiltered.

**Impact:** Security risk -- prompts may contain credentials, API keys, or other sensitive data that should be stripped before reaching the worker.

**Remediation:** Implement a `sanitizePrompt()` function that removes code blocks with known secret patterns, strips URLs with tokens, and validates against injection patterns.

### 2. System prompt hash is a static placeholder

**File:** `apps/code-agent/src/domain/usecases/processCodeAction.ts:215`

```typescript
systemPromptHash: 'system-prompt-hash-v1', // TODO: Compute from actual system prompt
```

**File:** `apps/code-agent/src/routes/codeRoutes.ts:1172`

```typescript
systemPromptHash: 'default', // TODO: Use actual system prompt hash
```

The `systemPromptHash` field is designed for audit tracking -- recording which version of the system prompt was active when the task ran. Currently it stores a hardcoded string, making it impossible to audit prompt version changes.

**Impact:** Audit trail gap -- no way to correlate task results with the system prompt version that generated them.

**Remediation:** Compute SHA-256 of the actual system prompt template at startup and inject it via config.

### 3. PR comment dispatch not yet wired

**File:** `apps/code-agent/src/routes/webhooks/github.ts:73`

```typescript
// TODO (Phase 4): Dispatch the task to the worker
```

The `handlePRComment` use case prepares a follow-up task (identifies actionable comments, acquires PR lock, builds prompt with context), but the actual dispatch to a worker is not yet connected. Currently the prepared task is only logged.

**Impact:** PR comment auto-response feature is partially implemented. Comments mentioning `@claude` are detected but no automated action follows.

**Remediation:** Wire the `handlePRComment` result into the task creation and dispatch flow, similar to `processCodeAction`.

## Code Smells

### 1. codeRoutes.ts is 3500+ lines (SRP violation)

**File:** `apps/code-agent/src/routes/codeRoutes.ts`

This single file contains all internal code task routes AND all public code task routes -- over 3500 lines. It handles task submission, task updates, task listing, task cancellation, heartbeats, zombie detection, log cleanup, retry, feedback, and mid-task messaging. Each route includes inline Fastify schema definitions that consume significant line count. New routes are added to `routes/code/` as separate files (e.g., `github-pre-events.ts`, `github-pr-summaries.ts`) but the original routes remain consolidated.

**Impact:** Difficult to navigate, review, and test. Changes to one route risk unintended effects on others.

**Remediation:** Continue the pattern established by `routes/code/` and split the remaining routes by domain concern:

- `routes/code/submit.ts` (public submit)
- `routes/code/tasks.ts` (public list/get/cancel)
- `routes/code/retry.ts` (public retry)
- `routes/code/feedback.ts` (public feedback)
- `routes/code/messages.ts` (public sendTaskMessage)
- `routes/internal/process.ts` (internal code action processing)
- `routes/internal/taskUpdate.ts` (internal task PATCH)
- `routes/internal/maintenance.ts` (heartbeat, zombies, cleanup)

### 2. Duplicated webhook secret and cancel nonce generation

**Files:** `processCodeAction.ts`, `retryTask.ts`, `submitTaskFeedback.ts`

All three use cases contain identical `generateWebhookSecret()` and `generateCancelNonce()` functions copied independently.

```typescript
function generateWebhookSecret(): string {
  const buffer = randomBytes(24);
  return `whsec_${buffer.toString('hex')}`;
}
```

**Impact:** DRY violation. Any change to the secret format must be applied in three places.

**Remediation:** Extract to a shared utility in `domain/utils/secrets.ts` and import in all three use cases.

### 3. ESLint disabled for entire route files

**Files:** `codeRoutes.ts:1`, `webhookRoutes.ts:1`

```typescript
/* eslint-disable */
```

Both files have ESLint completely disabled at the file level, silencing all linting rules including safety-critical ones like `@typescript-eslint/no-unsafe-*`.

**Impact:** Type safety and code quality rules are not enforced in the most complex route files.

**Remediation:** Remove the blanket disable, address individual lint issues, and use targeted `eslint-disable-next-line` comments where genuinely necessary.

### 4. In-flight health probe deduplication uses module-level Map

**File:** `apps/code-agent/src/routes/codeRoutes.ts:24`

```typescript
const inFlightRequests = new Map<string, Promise<void>>();
```

Module-level mutable state for deduplicating concurrent health probes. This map grows unbounded if entries are not cleaned up properly.

**Impact:** Potential memory leak in long-running instances if the cleanup logic has edge cases.

**Remediation:** Add a TTL-based cleanup or use a WeakMap pattern.

## Future Plans

### 1. Full PR comment auto-dispatch (INT-465 Phase 4)

The infrastructure for PR comment handling exists (event parsing, actionability detection, PR locking, context building). The remaining work is connecting the prepared task to the dispatch flow.

**File:** `apps/code-agent/src/routes/webhooks/github.ts:74`

```typescript
// TODO (Phase 4): Dispatch the task to the worker
```

### 2. Actual system prompt versioning

Replace static hash placeholders with computed hashes from the real system prompt template. This enables prompt A/B testing and audit compliance.

## TypeScript Strictness Issues

### Firestore Timestamp handling

Throughout the codebase, Firestore `Timestamp` objects require runtime type narrowing when serializing to JSON. The `timestampToIso()` helper handles this but requires `as` casts:

```typescript
createdAt: timestampToIso(task.createdAt as { toDate: () => Date } | string | undefined) ?? '',
```

This pattern appears in `codeRoutes.ts` and could benefit from a typed wrapper that encapsulates the Firestore Timestamp vs. plain Date distinction.

## Test Coverage Notes

The service has 45 test files covering domain models, use cases, infra adapters, and routes. Coverage exemptions use the `/* v8 ignore <CATEGORY> -- reason @preserve */` pattern with valid categories.

Common exemption categories in this service:

- `ts-type`: TypeScript type narrowing branches (nullish coalescing, optional chaining)
- `test-infra`: Paths requiring complex test infrastructure setup
- `upstream`: Error handling for external service failures

## Resolved Issues

| Issue   | Description                                     | Resolution                                                   |
| ------- | ----------------------------------------------- | ------------------------------------------------------------ |
| INT-372 | Zombie task detection                           | Heartbeat + 30-min threshold implemented                     |
| INT-379 | WhatsApp cancel button                          | Cancel nonce with 15-min TTL                                 |
| INT-465 | PR comment auto-response (Phases 0-3)           | Event parsing + locking + context build                      |
| INT-486 | Unified Linear issue templates                  | Two-phase execution model (designed/implemented statuses)    |
| INT-505 | Rich PR activity timeline                       | Clickable links, comment bodies, deduplication               |
| INT-519 | Block agents from QA/Done transitions           | Validate-linear-state hook                                   |
| INT-520 | Retry mechanism for failed tasks                | retryTask use case with cool-off                             |
| INT-524 | PR review feedback                              | Addressed in code review                                     |
| —       | Duplicate PR body in synchronize events         | deduplicatePRBody() pass in GET /code/github-pr-events       |
| —       | Edited comment creates duplicate timeline entry | deduplicateCommentEvents() keeps first position, latest body |
| —       | Turn-end metrics not collected                  | TurnMetrics subcollection + FirestoreTurnMetricsRepository   |
| —       | No way to send mid-task messages or resume      | sendTaskMessage use case + POST /code/tasks/:id/messages     |
| —       | PR list view requires O(events) query           | github-pr-summaries collection + GET /code/github-pr-summaries |
