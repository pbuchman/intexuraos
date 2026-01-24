# Linear Agent - Technical Debt

**Last Updated:** 2026-01-24
**Analysis Run:** v2.0.0 documentation update

---

## Summary

| Category           | Count | Severity |
| ------------------ | ----- | -------- |
| TODOs/FIXMEs       | 0     | -        |
| Test Coverage Gaps | 0     | -        |
| TypeScript Issues  | 0     | -        |
| Code Smells        | 1     | Low      |
| **Total**          | **1** | Low      |

---

## Future Plans

Based on code analysis, git history, and domain patterns:

1. **Webhook Integration**: Add Linear webhooks for bidirectional sync (issue state changes in Linear push to IntexuraOS)
2. **Issue Updates**: Support updating existing issues from WhatsApp (currently create-only)
3. **Project Selection**: Allow users to select target project within team (not just team-level)
4. **Label Inference**: Extract labels from natural language context ("this is a bug" adds `bug` label)
5. **Due Date Extraction**: Parse relative dates ("by Friday", "next week") into Linear due dates
6. **Multi-Issue Splitting**: Parse complex descriptions into multiple related issues
7. **Assignee Suggestion**: Suggest assignee based on historical patterns or explicit mentions

---

## Code Smells

### Low Priority

| File                                  | Issue                     | Impact                                    |
| ------------------------------------- | ------------------------- | ----------------------------------------- |
| `src/infra/linear/linearApiClient.ts` | Module-level client cache | Global state, harder to test in isolation |

**Details:** The Linear API client uses module-level `Map` instances for client caching and request deduplication. While this enables performance optimizations (INT-95), it makes the code harder to test without `/* istanbul ignore next */` pragmas.

**Mitigation:** The caching behavior is well-isolated with exported functions (`clearClientCache`, `getClientCacheSize`) for test cleanup.

---

## Test Coverage Gaps

### Resolved in INT-166

The INT-166 update significantly improved test coverage:

- Added comprehensive tests for `mapStateToDashboardColumn` function
- Added tests for all DashboardColumn values (todo, backlog, in_progress, in_review, to_test, done)
- Added tests for state name pattern matching (review, test, qa, quality)
- Added tests for edge cases (unknown state types, default behaviors)

**Current Coverage:** Meets 95% threshold

---

## TypeScript Issues

None identified. Service uses strict TypeScript with proper type definitions for:

- Linear API types (`LinearIssue`, `LinearTeam`, `IssueStateCategory`)
- Dashboard types (`DashboardColumn`, `GroupedIssues`)
- Extraction types (`ExtractedIssueData`)
- Error types (`LinearError`)

---

## TODOs / FIXMEs

No TODO or FIXME comments found in codebase. The service has been cleaned up during recent development cycles.

---

## SRP Violations

None identified. Files are appropriately sized:

| File                            | Lines | Status                      |
| ------------------------------- | ----- | --------------------------- |
| `linearApiClient.ts`            | 360   | OK (includes optimizations) |
| `processLinearAction.ts`        | 233   | OK                          |
| `linearRoutes.ts`               | 231   | OK                          |
| `linearConnectionRepository.ts` | 189   | OK                          |
| `listIssues.ts`                 | 145   | OK                          |

---

## Code Duplicates

### Handled via Shared Code

| Pattern         | Locations                              | Status                           |
| --------------- | -------------------------------------- | -------------------------------- |
| Error handling  | `linearRoutes.ts`, `internalRoutes.ts` | DRY (shared `handleLinearError`) |
| Request logging | All routes                             | Uses `logIncomingRequest`        |
| Auth validation | Public routes                          | Uses `requireAuth`               |
| Internal auth   | Internal routes                        | Uses `validateInternalAuth`      |

---

## Deprecations

None. The service uses current versions of:

- `@linear/sdk` - Official Linear SDK
- `@intexuraos/llm-prompts` - Internal prompt library
- `@intexuraos/common-core` - Result types

---

## Resolved Issues

| Date       | Issue                                    | Resolution                             |
| ---------- | ---------------------------------------- | -------------------------------------- |
| 2026-01-24 | Test coverage gaps for dashboard columns | INT-166: Added comprehensive tests     |
| 2026-01-24 | Missing todo/to_test columns             | INT-208: Added new column types        |
| 2026-01-16 | Duplicate issue creation on retry        | INT-97: Added idempotency check        |
| 2026-01-16 | Rate limiting from Linear API            | INT-95: Client caching + deduplication |
| 2026-01-17 | Silent success masking failures          | INT-125: ServiceFeedback contract      |

---

## Code Quality Notes

### Positive Patterns

1. **Idempotency**: ProcessedAction repository prevents duplicate issue creation (INT-97)
2. **Graceful Degradation**: Failed extractions saved for manual review
3. **Type Safety**: Strict TypeScript types for Linear priority enum and state categories
4. **Error Mapping**: Consistent error code translation to HTTP status
5. **Performance**: Client caching and request deduplication (INT-95)
6. **Clean Separation**: Domain logic isolated from infrastructure
7. **Comprehensive Dashboard Grouping**: Smart state-to-column mapping (INT-208)

### Areas for Improvement

1. **Batch Processing**: Currently processes one action at a time (could batch multiple actions)
2. **Connection Caching**: Linear connection fetched per request (could cache briefly)
3. **Module-Level State**: Client cache uses global state (isolated but harder to test)

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Tutorial](tutorial.md) - Getting started guide
- [Documentation Run Log](../../documentation-runs.md)

---

**Last analyzed:** 2026-01-24
**Analyzed by:** service-scribe (autonomous)
