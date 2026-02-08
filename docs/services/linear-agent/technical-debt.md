# Linear Agent - Technical Debt

**Last Updated:** 2026-02-08
**Analysis Run:** v3.0.0 documentation update (webhook sync, internal API, issue validation)

---

## Summary

| Category           | Count | Severity |
| ------------------ | ----- | -------- |
| TODOs/FIXMEs       | 1     | Medium   |
| Test Coverage Gaps | 0     | -        |
| TypeScript Issues  | 0     | -        |
| Code Smells        | 1     | Low      |
| **Total**          | **2** | Medium   |

---

## TODOs / FIXMEs

### Hardcoded Team ID in Retry Endpoint

| File                             | Line | Issue                                                                |
| -------------------------------- | ---- | -------------------------------------------------------------------- |
| `src/routes/linearRoutes.ts`     | 313  | `teamId: 'TODO'` placeholder when retrying failed issue creation     |

**Impact:** The `POST /linear/failed-issues/:id/retry` endpoint creates issues with a hardcoded team ID instead of reading from the user's connection. This means retried issues may fail or be created in the wrong team.

**Fix:** Fetch the user's `LinearConnection` and use `connection.teamId` when calling `linearApiClient.createIssue`.

---

## Future Plans

Based on code analysis, git history, and domain patterns:

1. **Issue Updates from WhatsApp**: Support updating existing issues from WhatsApp (currently create-only via voice pipeline)
2. **Project Selection**: Allow users to select target project within team (not just team-level)
3. **Label Inference**: Extract labels from natural language context ("this is a bug" adds `bug` label)
4. **Due Date Extraction**: Parse relative dates ("by Friday", "next week") into Linear due dates
5. **Multi-Issue Splitting**: Parse complex descriptions into multiple related issues
6. **Assignee Suggestion**: Suggest assignee based on historical patterns or explicit mentions
7. **Label Support in Internal API**: The `POST /internal/issues` endpoint accepts `labels` but does not pass them to the Linear API yet

---

## Code Smells

### Low Priority

| File                                  | Issue                     | Impact                                    |
| ------------------------------------- | ------------------------- | ----------------------------------------- |
| `src/infra/linear/linearApiClient.ts` | Module-level client cache | Global state, harder to test in isolation |

**Details:** The Linear API client uses module-level `Map` instances for client caching and request deduplication. While this enables performance optimizations (INT-95), it makes the code harder to test without coverage exemption pragmas.

**Mitigation:** The caching behavior is well-isolated with exported functions (`clearClientCache`, `getClientCacheSize`) for test cleanup.

---

## Test Coverage Gaps

### Resolved in INT-166

The INT-166 update significantly improved test coverage:

- Added comprehensive tests for `mapStateToDashboardColumn` function
- Added tests for all DashboardColumn values (todo, backlog, in_progress, in_review, to_test, done)
- Added tests for state name pattern matching (review, test, qa, quality)
- Added tests for edge cases (unknown state types, default behaviors)

### Resolved in INT-486

The INT-486 update added comprehensive test suites for all new use cases:

- `issueMapper.test.ts` (172 lines) - Tests for `mapWebhookToSyncedIssue` and `mapApiIssueToSyncedIssue`
- `fullSyncUseCase.test.ts` (391 lines) - Tests for `fullSync` and `fullSyncAllUsers` including error handling
- `generateIssueTitle.test.ts` (429 lines) - Tests for LLM generation, fallback pipeline, code block handling
- `syncSingleIssueUseCase.test.ts` (165 lines) - Tests for create/update/remove/unknown actions
- `validateIssue.test.ts` (315 lines) - Tests for format validation, team ownership, not found, API errors

**Current Coverage:** Meets 100% branch threshold with valid v8 ignore exemptions

---

## TypeScript Issues

None identified. Service uses strict TypeScript with proper type definitions for:

- Linear API types (`LinearIssue`, `LinearIssueWithTeam`, `LinearTeam`, `IssueStateCategory`)
- Sync types (`SyncedLinearIssue`, `WorkflowState`)
- Webhook types (`LinearWebhookEvent`, `LinearWebhookPayload`, `WebhookAction`)
- Dashboard types (`DashboardColumn`, `GroupedIssues`)
- Extraction types (`ExtractedIssueData`)
- Validation types (`ValidatedIssue`, `ValidateIssueError`)
- Title generation types (`GeneratedTitle`, `GenerateTitleError`)
- Error types (`LinearError`, `LinearWebhookError`)

---

## SRP Violations

None identified. Files are appropriately sized:

| File                              | Lines | Status                             |
| --------------------------------- | ----- | ---------------------------------- |
| `linearRoutes.ts`                 | 673   | Borderline (12 endpoints)          |
| `linearApiClient.ts`              | ~360  | OK (includes optimizations)        |
| `internalIssuesRoutes.ts`         | 398   | OK                                 |
| `linearWebhookRoutes.ts`          | 298   | OK                                 |
| `processLinearAction.ts`          | 233   | OK                                 |
| `generateIssueTitle.ts`           | 129   | OK                                 |
| `fullSyncUseCase.ts`              | 158   | OK                                 |
| `validateIssue.ts`                | 108   | OK                                 |
| `syncSingleIssueUseCase.ts`       | 78    | OK                                 |
| `linearConnectionRepository.ts`   | ~200  | OK (includes webhook secret ops)   |

**Note:** `linearRoutes.ts` at 673 lines is the largest file due to 12 endpoints (connection CRUD, issues, failed issues CRUD + retry, sync, webhook config CRUD). Consider splitting into focused route modules if further endpoints are added.

---

## Code Duplicates

### Handled via Shared Code

| Pattern              | Locations                                                         | Status                           |
| -------------------- | ----------------------------------------------------------------- | -------------------------------- |
| Error handling       | `linearRoutes.ts`, `internalRoutes.ts`, `internalIssuesRoutes.ts` | Shared `handleLinearError`       |
| Request logging      | All routes                                                        | Uses `logIncomingRequest`        |
| Auth validation      | Public routes                                                     | Uses `requireAuth`               |
| Internal auth        | Internal routes                                                   | Uses `validateInternalAuth`      |
| Issue mapping        | `syncSingleIssue`, `fullSync`                                     | Shared `issueMapper` module      |

---

## Deprecations

None. The service uses current versions of:

- `@linear/sdk` - Official Linear SDK
- `@intexuraos/llm-prompts` - Internal prompt library (includes `linearIssueTitlePrompt`)
- `@intexuraos/llm-utils` - Zod error formatting
- `@intexuraos/common-core` - Result types
- `@intexuraos/internal-clients` - UserServiceClient

---

## Resolved Issues

| Date       | Issue                                    | Resolution                                    |
| ---------- | ---------------------------------------- | --------------------------------------------- |
| 2026-02-06 | No programmatic issue management         | INT-486: Internal API for issue CRUD + state  |
| 2026-02-06 | No issue validation capability           | INT-486: validateIssue use case               |
| 2026-02-06 | No AI title generation                   | INT-486: generateIssueTitle use case          |
| 2026-02-03 | Single-tenant webhook support only       | Multi-tenant webhook routing by team ID       |
| 2026-02-02 | No bidirectional sync with Linear        | INT-444: Webhook sync + full sync use cases   |
| 2026-02-02 | No local issue storage                   | INT-444: SyncedLinearIssue + issue repository |
| 2026-02-01 | Multi-user Linear support broken         | INT-443: Fixed multi-user connection handling |
| 2026-01-24 | Test coverage gaps for dashboard columns | INT-166: Added comprehensive tests            |
| 2026-01-24 | Missing todo/to_test columns             | INT-208: Added new column types               |
| 2026-01-16 | Duplicate issue creation on retry        | INT-97: Added idempotency check               |
| 2026-01-16 | Rate limiting from Linear API            | INT-95: Client caching + deduplication        |
| 2026-01-17 | Silent success masking failures          | INT-125: ServiceFeedback contract             |

---

## Code Quality Notes

### Positive Patterns

1. **Idempotency**: ProcessedAction repository prevents duplicate issue creation (INT-97)
2. **Graceful Degradation**: Failed extractions saved for manual review with retry capability
3. **Type Safety**: Strict TypeScript types for Linear priority enum, state categories, webhook events, and sync models
4. **Error Mapping**: Consistent error code translation to HTTP status across all route files
5. **Performance**: Client caching and request deduplication (INT-95)
6. **Clean Separation**: Domain logic isolated from infrastructure with well-defined ports
7. **Comprehensive Dashboard Grouping**: Smart state-to-column mapping (INT-208)
8. **Multi-Tenant Webhooks**: Per-connection webhook secrets with team-based routing
9. **Safe Parsing**: Issue mapper handles unknown state types and out-of-range priorities with defaults
10. **Fallback Pipeline**: Title generation degrades gracefully through LLM -> regex -> "Code task" fallback
11. **Signature Security**: HMAC-SHA256 with timing-safe comparison prevents timing attacks

### Areas for Improvement

1. **Retry Team ID**: Fix hardcoded `teamId: 'TODO'` in retry endpoint (see TODOs section)
2. **Label Passthrough**: Internal API accepts labels but does not forward them to Linear
3. **Batch Processing**: Currently processes one action at a time (could batch multiple actions)
4. **Connection Caching**: Linear connection fetched per request (could cache briefly)
5. **Module-Level State**: Client cache uses global state (isolated but harder to test)
6. **Route File Size**: `linearRoutes.ts` at 673 lines could benefit from splitting if more endpoints are added

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Tutorial](tutorial.md) - Getting started guide
- [Documentation Run Log](../../documentation-runs.md)

---

**Last analyzed:** 2026-02-08
**Analyzed by:** service-scribe (autonomous)
