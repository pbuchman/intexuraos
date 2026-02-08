# @intexuraos/llm-audit - Technical Debt

## Code Quality

The package is small and focused. The `AuditContext` pattern ensures timing accuracy by capturing the start time at creation. The completed-once guard prevents double-logging. All code paths are tested.

### Current Issues

#### 1. `saveAuditLog` uses `console.error` for failure logging

The internal `saveAuditLog` function falls back to `console.error` when the Firestore write fails. This bypasses structured logging (pino/Sentry), making audit save failures invisible in production monitoring.

**Impact:** Medium. If Firestore is unavailable, audit failures are only visible in raw stdout, not in Sentry or Cloud Logging structured queries.
**Suggested fix:** Accept a `Logger` dependency in `AuditContext` (similar to how `UsageLogger` in `llm-pricing` requires one) and log failures through it.

#### 2. No batch writes for high-throughput scenarios

Each audit log is written as a single Firestore `doc.set()`. Under high concurrency, this creates many individual Firestore operations. The `llm-pricing` package uses batch writes for its usage stats, but audit does not.

**Impact:** Low. Audit writes are naturally throttled by LLM response times (seconds per call). Batch writes would only help if multiple LLM calls complete simultaneously.

#### 3. Full prompt and response stored without size limits

The audit log stores the complete prompt and response text. For large prompts (research context with multiple sources) or verbose responses (deep research), this can create very large Firestore documents.

**Impact:** Low. Firestore documents have a 1MB limit, and most LLM interactions are well under this. However, deep research responses approaching the limit could cause write failures.
**Suggested fix:** Add configurable truncation for prompt and response fields, similar to `llm-utils` truncation utilities.

#### 4. Conditional property assignment is verbose

The `success()` method uses 14 individual `if (result.X !== undefined)` checks to conditionally add properties. This is correct but verbose.

**Impact:** None functionally. It follows the project pattern of never setting `undefined` values on Firestore documents.
**Suggested fix:** Could use a helper function like `assignDefined(log, result, ['inputTokens', 'outputTokens', ...])` to reduce repetition.

## Future Plans

- Add `Logger` dependency to `AuditContext` for structured error logging
- Consider adding configurable prompt/response truncation
- Evaluate TTL-based automatic cleanup of old audit logs via Firestore TTL policies
- Consider adding audit log querying utilities for debugging workflows
