# Linear Agent — Technical Debt

**Last Updated:** 2026-03-22
**Analysis Run:** v3.4.0 documentation refresh (context endpoint, decomposition sprint, v8 ignore resolution, parentId fix)

---

## Summary

| Category           | Count | Severity |
| ------------------ | ----- | -------- |
| TODOs/FIXMEs       | 0     | ---      |
| Test Coverage Gaps | 0     | ---      |
| TypeScript Issues  | 0     | ---      |
| Code Smells        | 2     | Low      |
| SRP Violations     | 1     | Low      |
| **Total**          | **3** | Low      |

---

## TODOs / FIXMEs

None. No TODO, FIXME, HACK, or XXX comments in production source code.

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
8. **completedAt in SyncedLinearIssue**: `SyncedLinearIssue` does not store `completedAt`; `updatedAt` is used as a proxy for archive cutoff. Adding `completedAt` would improve accuracy for issues completed long after their last update.
9. **Comment Full Sync**: Comments are only synced via webhooks; a comment full-sync capability for initial setup would be valuable

---

## Code Smells

### Low Priority

| File                                                   | Issue                         | Impact                                     |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------ |
| `src/infra/linear/linearApiClient.ts`                  | Module-level client cache     | Global state, harder to test in isolation  |
| `src/domain/useCases/triggerCodeTaskFromAssignment.ts` | Fire-and-forget async pattern | Errors logged but not propagated to caller |

**Details (client cache):** The Linear API client uses module-level `Map` instances for client caching and request deduplication. While this enables performance optimizations (INT-95), it makes the code harder to test without coverage exemption pragmas. The caching and dedup logic has been extracted into a dedicated `requestCache.ts` module (INT-904), improving isolation.

**Mitigation:** The caching behavior is well-isolated with exported functions (`clearClientCache`, `getClientCacheSize`) for test cleanup. The INT-904 split further improved testability.

**Details (fire-and-forget):** `triggerCodeTaskFromAssignment` uses `void` to discard the promise, meaning code-agent failures are only logged, not surfaced to the webhook caller. This is by design (webhook responses should not be blocked), but means trigger failures require log monitoring to detect.

---

## Test Coverage Gaps

None identified. Current coverage meets the 100% branch threshold with valid v8 ignore exemptions across 13 files (52 total `v8 ignore` directives in production source, reduced from 56 in v3.3.0 thanks to INT-990 PENDING annotation removal). All exemptions use documented categories: `test-infra`, `ts-type`, `async-timing`, `upstream`, `schema`.

---

## TypeScript Issues

None identified. One `@ts-expect-error` exists in test code (`linearActionExtractionService.test.ts`) for intentional negative testing of schema validation — this is valid usage. No `any` types in production source code. Service uses strict TypeScript with proper type definitions for:

- Linear API types (`LinearIssue`, `LinearIssueWithTeam`, `LinearTeam`, `IssueStateCategory`)
- Sync types (`SyncedLinearIssue`, `LinearComment`, `WorkflowState`)
- Webhook types (`LinearWebhookEvent`, `LinearCommentWebhookEvent`, `LinearWebhookUpdatedFrom`)
- Dashboard types (`DashboardColumn`, `GroupedIssues`)
- Extraction types (`ExtractedIssueData`)
- Validation types (`ValidatedIssue`, `ValidateIssueError`)
- Title generation types (`GeneratedTitle`, `GenerateTitleError`)
- Error types (`LinearError`)
- Label types (`LinearLabel` with id, name, color)
- Display types (`IssueDisplayResponse`, `CommentSummary`, `UpdateIssueMetadataBody`)

---

## SRP Violations

| File                      | Lines | Status                                                                 |
| ------------------------- | ----- | ---------------------------------------------------------------------- |
| `internalIssuesRoutes.ts` | ~970  | Borderline (8 endpoints including new context). Watch closely          |
| `linearRoutes.ts`         | ~893  | Borderline (14 endpoints). Stable since v3.3.0                         |
| `internalRoutes.ts`       | ~590  | OK (5 endpoints)                                                       |
| `linearApiClient.ts`      | ~361  | OK (reduced from ~636 via INT-904 split)                               |
| `linearMappers.ts`        | ~241  | OK (extracted from linearApiClient)                                    |
| `linearWebhookRoutes.ts`  | ~227  | OK                                                                     |
| `processLinearAction.ts`  | ~207  | OK                                                                     |
| `requestCache.ts`         | ~88   | OK (extracted from linearApiClient)                                    |
| `listIssues.ts`           | ~93   | OK (reduced from ~208 via INT-906 decomposition)                       |

**Note:** `internalIssuesRoutes.ts` grew to ~970 lines with the addition of the context endpoint (INT-1040). It now holds 8 endpoints: create, comments, metadata, state, display-batch, get-by-identifier, context, and tree. Consider splitting into focused modules (e.g., `internalIssueDisplayRoutes.ts`, `internalIssueMutationRoutes.ts`) if further endpoints are added.

**Improvement:** The INT-904 split reduced `linearApiClient.ts` from ~636 to ~361 lines. The INT-906 decomposition reduced `listIssues.ts` from ~208 to ~93 lines. These refactorings significantly improved code organization.

---

## Code Duplicates

### Handled via Shared Code

| Pattern         | Locations                                                         | Status                             |
| --------------- | ----------------------------------------------------------------- | ---------------------------------- |
| Error handling  | `linearRoutes.ts`, `internalRoutes.ts`, `internalIssuesRoutes.ts` | Shared `handleLinearError`         |
| Request logging | All routes                                                        | Uses `logIncomingRequest`          |
| Auth validation | Public routes                                                     | Uses `requireAuth`                 |
| Internal auth   | Internal routes                                                   | Uses `validateInternalAuth`        |
| Issue mapping   | `syncSingleIssue`, `fullSync`                                     | Shared `issueMapper` module        |
| Display build   | `internalIssuesRoutes.ts` (3 endpoints)                           | Shared `buildIssueDisplayResponse` |

---

## Deprecations

None. The service uses current versions of:

- `@linear/sdk` — Official Linear SDK
- `@intexuraos/llm-prompts` — Internal prompt library (includes `linearIssueTitlePrompt`, `linearActionExtractionPrompt`)
- `@intexuraos/llm-utils` — Zod error formatting
- `@intexuraos/common-core` — Result types, label detection helpers
- `@intexuraos/internal-clients` — UserServiceClient

---

## Resolved Issues

| Date       | Issue                                                 | Resolution                                                                        |
| ---------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| 2026-03-22 | Orchestrator needed direct Linear API access          | New context endpoint proxies issue data from local store (INT-1040)               |
| 2026-03-19 | linearApiClient.ts at ~636 lines                      | Split into client + mappers + requestCache (INT-904)                              |
| 2026-03-19 | listIssues.ts at ~208 lines with mixed concerns       | Decomposed into issueTreeBuilder, issueGrouper, syncedIssueMapper (INT-906)       |
| 2026-03-19 | processLinearAction.ts mixed orchestration concerns   | Extracted checkIdempotency and descriptionBuilder (INT-907)                       |
| 2026-03-19 | Extraction parsing coupled with LLM infra             | Extracted extractionParser.ts to domain (INT-905)                                 |
| 2026-03-19 | Webhook handler logic in route file                   | Extracted processWebhook use-case (INT-903)                                       |
| 2026-03-19 | linearRoutes repository calls not in use-cases        | Extracted retryFailedIssue, getIssueComments, getIssueDetail (INT-902)            |
| 2026-03-19 | PENDING v8 ignore annotations                         | Replaced with full test coverage (INT-990)                                        |
| 2026-03-17 | Missing parentId in mapSingleIssueWithTeam            | Fixed to populate parentId, preventing false subtask rejection (INT-953)          |
| 2026-03-16 | internalIssuesRoutes mixed domain/route logic         | Domain logic extracted into dedicated functions (INT-901)                         |
| 2026-03-14 | No `done` state in internal state update API          | Added `done` to `UpdateStateBody` for already_completed outcome (INT-773)         |
| 2026-03-13 | Display-batch performed 2N sequential Firestore reads | Replaced with batched `getCommentSummaries` call                                  |
| 2026-03-13 | 92 v8 ignore directives across 12 files               | Replaced with real tests, reduced to 56 across 8 files (INT-792)                  |
| 2026-03-12 | GLM-4.7/GLM-4.7 Flash in required models list         | Removed as part of ZAI-to-DashScope migration (INT-835)                           |
| 2026-03-09 | Auto-trigger fired for any assigned issue             | Gated on planning-task or code-task label                                         |
| 2026-03-05 | Comment webhook errors not logged                     | Added error logging in `findUserIdsByIssueId` comment handler (INT-623)           |
| 2026-03-03 | Cross-user data overwrite during sync                 | Composite Firestore keys `userId_issueId` prevent overwrites (INT-623)            |
| 2026-03-03 | Webhooks only processed for single user               | Multi-user fan-out via `findUserIdsByTeamId` + Promise.allSettled                 |
| 2026-03-03 | Comment routing missed connected users                | Per-issue user lookup for comment webhook fan-out                                 |
| 2026-03-03 | Internal routes scoped incorrectly                    | Fixed route prefix scoping for internal endpoints (INT-623)                       |
| 2026-02-28 | Index migration and orphan cleanup                    | New migration + orphan cleanup for composite key transition (INT-623)             |
| 2026-02-27 | Auto-trigger prompt mismatched for code-task label    | Prompt selection based on `code-task` label presence                              |
| 2026-02-27 | Auto-trigger only fired for unstarted state           | `shouldTriggerCodeTask` now accepts both `backlog` and `unstarted`                |
| 2026-02-25 | Case-sensitivity in code-task label detection         | Fixed case-sensitive label comparison                                             |
| 2026-02-21 | Webhook dedup action IDs could collide                | Unique actionId format: `webhook-assign-{id}-{timestamp}`                         |
| 2026-02-21 | Auto-trigger prompt misaligned with planning agent    | Aligned prompt to analyze/enrich/mark-ready behavior                              |
| 2026-02-20 | Assignee lost during full sync                        | Fetch assignee data from Linear API in listIssues (INT-573)                       |
| 2026-02-20 | Assignee missing from dashboard response              | Include assignee in syncedToLinearIssue mapper                                    |
| 2026-02-20 | Raw errors not passed to pino logger                  | Pass raw error objects to logger for structured logging                           |
| 2026-02-19 | validateIssue labels serialized as "[object Object]"  | Map LinearLabel[] to string[] at HTTP boundary in internalRoutes                  |
| 2026-02-15 | Silent title degradation on LLM failure               | Removed regex fallback, return err() after 2 retries                              |
| 2026-02-10 | Hardcoded `teamId: 'TODO'` in retry                   | Fixed to use `connectionRepository.getFullConnection`                             |
| 2026-02-10 | Dashboard called Linear API on every load             | Switched to Firestore-first with local cache                                      |
| 2026-02-10 | No parent-child issue hierarchy                       | Built in-memory tree in `listIssues` use case                                     |
| 2026-02-10 | Labels stored as strings only                         | Labels now stored as `{ id, name, color }` objects                                |
| 2026-02-06 | No programmatic issue management                      | INT-486: Internal API for issue CRUD + state                                      |
| 2026-02-06 | No issue validation capability                        | INT-486: validateIssue use case                                                   |
| 2026-02-06 | No AI title generation                                | INT-486: generateIssueTitle use case                                              |
| 2026-02-03 | Single-tenant webhook support only                    | Multi-tenant webhook routing by team ID                                           |
| 2026-02-02 | No bidirectional sync with Linear                     | INT-444: Webhook sync + full sync use cases                                       |
| 2026-02-02 | No local issue storage                                | INT-444: SyncedLinearIssue + issue repository                                     |
| 2026-02-01 | Multi-user Linear support broken                      | INT-443: Fixed multi-user connection handling                                     |
| 2026-01-24 | Test coverage gaps for dashboard columns              | INT-166: Added comprehensive tests                                                |
| 2026-01-24 | Missing todo/to_test columns                          | INT-208: Added new column types                                                   |
| 2026-01-16 | Duplicate issue creation on retry                     | INT-97: Added idempotency check                                                   |
| 2026-01-16 | Rate limiting from Linear API                         | INT-95: Client caching + deduplication                                            |
| 2026-01-17 | Silent success masking failures                       | INT-125: ServiceFeedback contract                                                 |

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
15. **HTTP Boundary Type Mapping**: `validateIssue` maps `LinearLabel[]` to `string[]` at the route layer — domain types stay clean
16. **Auto-Trigger on Assignment**: Webhook-driven code task creation with strict guard conditions
17. **Assignee Preservation**: Full sync preserves assignee data from the Linear API for dashboard display
18. **Multi-User Webhook Fan-Out**: Webhooks fan out to all connected users per team via `Promise.allSettled` (INT-623)
19. **Composite Document Keys**: `userId_issueId` keys prevent cross-user data overwrite in shared Firestore collections
20. **Dual-Prompt Code Task**: Prompt selection based on `code-task` label — enrichment vs execution
21. **Display Batch Endpoint**: `POST /internal/linear/issues/display-batch` returns multiple issues in a single call with batched Firestore reads
22. **Issue Tree Traversal**: `GET /internal/issues/:issueId/tree` returns recursive descendants from local sync data without Linear API calls
23. **Already-Completed Flow**: `done` state support enables enforcement pipeline to close issues when work is already merged (INT-773)
24. **Comments in Agent Prompts**: Both ASSIGNMENT_PROMPT and EXECUTION_PROMPT instruct the code agent to read all issue comments newest-first (INT-715)
25. **Module Decomposition**: INT-901 through INT-907 decomposed six large modules into focused, testable units
26. **Context Proxy**: New context endpoint enables cross-service issue data access without user credentials (INT-1040)

### Areas for Improvement

1. **Label Passthrough**: Internal API accepts labels but does not forward them to Linear on creation
2. **completedAt Gap**: SyncedLinearIssue uses `updatedAt` as proxy for archive cutoff
3. **Module-Level State**: Client cache uses global state (isolated but harder to test)
4. **Route File Size**: `internalIssuesRoutes.ts` at ~970 lines and `linearRoutes.ts` at ~893 lines could benefit from splitting
5. **Comment Full Sync**: No bulk comment reconciliation for initial setup
6. **Fire-and-Forget Auto-Trigger**: `triggerCodeTaskFromAssignment` errors only logged, not surfaced
7. **v8 Ignore Density**: 52 coverage exemption directives across 13 production files

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Tutorial](tutorial.md) — Getting started guide
- [Documentation Run Log](../../documentation-runs.md)

---

**Last analyzed:** 2026-03-22 (v3.4.0)
**Analyzed by:** service-scribe (autonomous)
