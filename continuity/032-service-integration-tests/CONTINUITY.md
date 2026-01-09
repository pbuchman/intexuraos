# Task 032: Service-to-Service Integration Tests

## Status: IN PROGRESS

## Tier Breakdown

| Tier | Task                  | Status | Description                                    |
| ---- | --------------------- | ------ | ---------------------------------------------- |
| 0    | 0-0-pr-review-fixes   | ✅     | Address PR #275 review findings (4/5 complete) |
| 1    | 1-0-integration-tests | ⬜     | Create integration tests for HTTP clients      |

## Progress Log

### 2026-01-09

- Created continuity task structure
- Identified issues from PR #275 code review
- Started addressing review findings
- ✅ Fixed silent error handling in smart-dispatch.mjs (Issue 1)
- ✅ Made retry threshold configurable (Issue 2)
- ✅ Added tests for shouldAutoExecute (Issue 3)
- ✅ Created nullability utilities in common-core (Issue 4)
- ⏳ Integration tests remain for tier 1 (Issue 5)

## Key Files

### PR #275 Review Findings

1. **Silent error handling:** `.github/scripts/smart-dispatch.mjs:91-92,125-127,180`
2. **Hard-coded retry threshold:** `apps/actions-agent/src/domain/usecases/retryPendingActions.ts:7`
3. **Missing test coverage:** `apps/actions-agent/src/domain/usecases/shouldAutoExecute.ts`
4. **No integration tests:** `apps/actions-agent/src/infra/http/*ServiceHttpClient.ts`
5. **Inconsistent null patterns:** Multiple files

### Good Example (whatsapp-service)

Reference for integration tests: `apps/whatsapp-service/src/__tests__/webhookAsyncProcessing.test.ts`

## Dependencies

None - this task can be worked on independently.

## Notes

This task was created based on the code review of PR #275 (development → main). The review identified 5 areas for improvement, with integration testing being the most architecturally significant.
