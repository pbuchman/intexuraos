# Linear Agent - Technical Debt

**Last Updated:** 2026-02-22
**Analysis Run:** v3.1.0 documentation update (auto-trigger on assignment, assignee sync, webhook dedup)

---

## Summary

| Category           | Count | Severity |
| ------------------ | ----- | -------- |
| TODOs/FIXMEs       | 0     | -        |
| Test Coverage Gaps | 0     | -        |
| TypeScript Issues  | 0     | -        |
| Code Smells        | 2     | Low      |
| **Total**          | **2** | Low      |

---

## TODOs / FIXMEs

None. The previously tracked `teamId: 'TODO'` hardcoded placeholder in the retry endpoint has been resolved — see Resolved Issues.

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
8. **completedAt in SyncedLinearIssue**: `SyncedLinearIssue` does not store `completedAt`; `updatedAt` is used as a proxy for the archive cutoff. Adding `completedAt` would improve accuracy for issues completed long after their last update.
9. **Comment Full Sync**: Comments are only synced via webhooks; a comment full-sync capability for initial setup would be valuable

---

## Code Smells

### Low Priority

| File                                                       | Issue                          | Impact                                     |
| ---------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| `src/infra/linear/linearApiClient.ts`                      | Module-level client cache      | Global state, harder to test in isolation  |
| `src/domain/useCases/triggerCodeTaskFromAssignment.ts`     | Fire-and-forget async pattern  | Errors logged but not propagated to caller |

**Details (client cache):** The Linear API client uses module-level `Map` instances for client caching and request deduplication. While this enables performance optimizations (INT-95), it makes the code harder to test without coverage exemption pragmas.

**Mitigation:** The caching behavior is well-isolated with exported functions (`clearClientCache`, `getClientCacheSize`) for test cleanup.

**Details (fire-and-forget):** `triggerCodeTaskFromAssignment` uses `void` to discard the promise, meaning code-agent failures are only logged, not surfaced to the webhook caller. This is by design (webhook responses should not be blocked), but means trigger failures require log monitoring to detect.

---

## Test Coverage Gaps

None identified. Current coverage meets the 100% branch threshold with valid v8 ignore exemptions.

---

## TypeScript Issues

None identified. Service uses strict TypeScript with proper type definitions for:

- Linear API types (`LinearIssue`, `LinearIssueWithTeam`, `LinearTeam`, `IssueStateCategory`)
- Sync types (`SyncedLinearIssue`, `LinearComment`, `WorkflowState`)
- Webhook types (`LinearWebhookEvent`, `LinearWebhookPayload`, `WebhookAction`)
- Dashboard types (`DashboardColumn`, `GroupedIssues`)
- Extraction types (`ExtractedIssueData`)
- Validation types (`ValidatedIssue`, `ValidateIssueError`)
- Title generation types (`GeneratedTitle`, `GenerateTitleError`)
- Error types (`LinearError`, `LinearWebhookError`)
- Label types (`LinearLabel` with id, name, color)

---

## SRP Violations

None identified. Files are appropriately sized:

| File                            | Lines | Status                                   |
| ------------------------------- | ----- | ---------------------------------------- |
| `linearRoutes.ts`               | ~1005 | Borderline (14 endpoints). Watch closely |
| `internalRoutes.ts`             | ~595  | OK (5 endpoints)                         |
| `internalIssuesRoutes.ts`       | ~563  | OK (3 endpoints + helpers)               |
| `linearWebhookRoutes.ts`        | ~401  | OK                                       |
| `linearApiClient.ts`            | ~360  | OK (includes optimizations)              |
| `processLinearAction.ts`        | ~233  | OK                                       |
| `generateIssueTitle.ts`         | ~134  | OK                                       |
| `fullSyncUseCase.ts`            | ~158  | OK                                       |
| `validateIssue.ts`              | ~108  | OK                                       |
| `syncSingleIssueUseCase.ts`     | ~78   | OK                                       |
| `linearConnectionRepository.ts` | ~200  | OK (includes webhook secret ops)         |

**Note:** `linearRoutes.ts` at ~1005 lines now handles 14 endpoints (connection CRUD, issues, issue detail, comments, failed issues CRUD + retry, sync, webhook config CRUD). Consider splitting into focused route modules (e.g., `linearIssueRoutes.ts`, `linearConnectionRoutes.ts`) if further endpoints are added.

---

## Code Duplicates

### Handled via Shared Code

| Pattern         | Locations                                                         | Status                      |
| --------------- | ----------------------------------------------------------------- | --------------------------- |
| Error handling  | `linearRoutes.ts`, `internalRoutes.ts`, `internalIssuesRoutes.ts` | Shared `handleLinearError`  |
| Request logging | All routes                                                        | Uses `logIncomingRequest`   |
| Auth validation | Public routes                                                     | Uses `requireAuth`          |
| Internal auth   | Internal routes                                                   | Uses `validateInternalAuth` |
| Issue mapping   | `syncSingleIssue`, `fullSync`                                     | Shared `issueMapper` module |

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

| Date       | Issue                                                | Resolution                                                       |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-02-21 | Webhook dedup action IDs could collide               | Unique actionId format: `webhook-assign-{id}-{timestamp}`        |
| 2026-02-21 | Auto-trigger prompt misaligned with planning agent   | Aligned prompt to analyze/enrich/mark-ready behavior             |
| 2026-02-20 | Assignee lost during full sync                       | Fetch assignee data from Linear API in listIssues (INT-573)      |
| 2026-02-20 | Assignee missing from dashboard response             | Include assignee in syncedToLinearIssue mapper                   |
| 2026-02-20 | Raw errors not passed to pino logger                 | Pass raw error objects to logger for structured logging          |
| 2026-02-19 | validateIssue labels serialized as "[object Object]" | Map LinearLabel[] to string[] at HTTP boundary in internalRoutes |
| 2026-02-15 | Silent title degradation on LLM failure              | Removed regex fallback, return err() after 2 retries             |
| 2026-02-10 | Hardcoded `teamId: 'TODO'` in retry                  | Fixed to use `connectionRepository.getFullConnection`            |
| 2026-02-10 | Dashboard called Linear API on every load            | Switched to Firestore-first with local cache                     |
| 2026-02-10 | No parent-child issue hierarchy                      | Built in-memory tree in `listIssues` use case                    |
| 2026-02-10 | Labels stored as strings only                        | Labels now stored as `{ id, name, color }` objects               |
| 2026-02-06 | No programmatic issue management                     | INT-486: Internal API for issue CRUD + state                     |
| 2026-02-06 | No issue validation capability                       | INT-486: validateIssue use case                                  |
| 2026-02-06 | No AI title generation                               | INT-486: generateIssueTitle use case                             |
| 2026-02-03 | Single-tenant webhook support only                   | Multi-tenant webhook routing by team ID                          |
| 2026-02-02 | No bidirectional sync with Linear                    | INT-444: Webhook sync + full sync use cases                      |
| 2026-02-02 | No local issue storage                               | INT-444: SyncedLinearIssue + issue repository                    |
| 2026-02-01 | Multi-user Linear support broken                     | INT-443: Fixed multi-user connection handling                    |
| 2026-01-24 | Test coverage gaps for dashboard columns             | INT-166: Added comprehensive tests                               |
| 2026-01-24 | Missing todo/to_test columns                         | INT-208: Added new column types                                  |
| 2026-01-16 | Duplicate issue creation on retry                    | INT-97: Added idempotency check                                  |
| 2026-01-16 | Rate limiting from Linear API                        | INT-95: Client caching + deduplication                           |
| 2026-01-17 | Silent success masking failures                      | INT-125: ServiceFeedback contract                                |

---

## Code Quality Notes

### Positive Patterns

1. **Idempotency**: ProcessedAction repository prevents duplicate issue creation (INT-97)
2. **Graceful Degradation**: Failed extractions saved for manual review with retry capability
3. **Type Safety**: Strict TypeScript types including `LinearLabel` with color for full label fidelity
4. **Error Mapping**: Consistent error code translation to HTTP status across all route files
5. **Performance**: Client caching and request deduplication (INT-95)
6. **Clean Separation**: Domain logic isolated from infrastructure with well-defined ports
7. **Firestore-First Dashboard**: No Linear API call on dashboard load — fast and rate-limit-proof
8. **Parent-Child Hierarchy**: In-memory tree built from Firestore data; subissues display correctly
9. **Multi-Tenant Webhooks**: Per-connection webhook secrets with team-based routing
10. **Safe Parsing**: Issue mapper handles unknown state types and out-of-range priorities with defaults
11. **Retry Logic**: Title generation retries once before returning a clean error
12. **OIDC + Internal Auth**: sync-all accepts both Cloud Scheduler OIDC and internal auth tokens
13. **Signature Security**: HMAC-SHA256 with timing-safe comparison prevents timing attacks
14. **Comment Sync**: Comments stored in Firestore and exposed via paginated API
15. **HTTP Boundary Type Mapping**: `validateIssue` maps `LinearLabel[]` to `string[]` at the route layer -- domain types stay clean
16. **OpenTelemetry**: Distributed tracing and metrics via Dash0 loaded transparently at process start (no-op when unconfigured)
17. **Auto-Trigger on Assignment**: Webhook-driven code task creation with strict guard conditions
18. **Assignee Preservation**: Full sync preserves assignee data from the Linear API for dashboard display

### Areas for Improvement

1. **Label Passthrough**: Internal API accepts labels but does not forward them to Linear
2. **completedAt Gap**: SyncedLinearIssue uses `updatedAt` as proxy for archive cutoff
3. **Module-Level State**: Client cache uses global state (isolated but harder to test)
4. **Route File Size**: `linearRoutes.ts` at ~1005 lines could benefit from splitting
5. **Comment Full Sync**: No bulk comment reconciliation for initial setup
6. **Fire-and-Forget Auto-Trigger**: `triggerCodeTaskFromAssignment` errors only logged, not surfaced

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Tutorial](tutorial.md) - Getting started guide
- [Documentation Run Log](../../documentation-runs.md)

---

**Last analyzed:** 2026-02-22 (v3.1.0)
**Analyzed by:** service-scribe (autonomous)
