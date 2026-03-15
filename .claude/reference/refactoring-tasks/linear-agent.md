# Refactoring Tasks — linear-agent

I now have comprehensive knowledge of all source files and tests. Let me produce the detailed task instructions.

---

## TASK: LA-COV-1 — Add tests for linearApiClient.ts real implementation

### Context
The existing test file (`linearApiClient.test.ts`) only tests the `FakeLinearApiClient`. The real implementation in `linearApiClient.ts` exports several pure/testable functions (`mapIssueStateType`, `mapLinearError`, `createDedupKey`, `filterIssuesByCompletionDate`, `mapTeam`) that have no direct unit tests.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/infra/linear/linearApiClient.ts` — confirm exported functions at lines 70, 240, 249, 270, 278
- [ ] Read `apps/linear-agent/src/__tests__/infra/linearApiClient.test.ts` — confirm no tests for exported functions

### Steps
1. Open `apps/linear-agent/src/__tests__/infra/linearApiClient.test.ts`
2. Add a new import at the top:
   ```ts
   import {
     mapIssueStateType,
     mapTeam,
     mapLinearError,
     createDedupKey,
     filterIssuesByCompletionDate,
     clearClientCache,
     getClientCacheSize,
     getDedupCacheSize,
   } from '../../infra/linear/linearApiClient.js';
   ```
3. Add the following new `describe` blocks AFTER the existing `describe('LinearApiClient', ...)` block (at the same level, NOT nested inside):

**describe('mapIssueStateType'):**
- Test: `maps 'backlog' to 'backlog'` — `expect(mapIssueStateType('backlog')).toBe('backlog')`
- Test: `maps 'unstarted' to 'unstarted'` — `expect(mapIssueStateType('unstarted')).toBe('unstarted')`
- Test: `maps 'started' to 'started'` — `expect(mapIssueStateType('started')).toBe('started')`
- Test: `maps 'completed' to 'completed'` — `expect(mapIssueStateType('completed')).toBe('completed')`
- Test: `maps 'canceled' to 'cancelled'` — `expect(mapIssueStateType('canceled')).toBe('cancelled')` (note: input is `canceled` but output is `cancelled`)
- Test: `maps unknown type to 'backlog' as default` — `expect(mapIssueStateType('something_else')).toBe('backlog')`
- Test: `maps empty string to 'backlog' as default` — `expect(mapIssueStateType('')).toBe('backlog')`

**describe('mapTeam'):**
- Test: `maps Linear SDK Team to LinearTeam` — create an object `{ id: 'team-1', name: 'Engineering', key: 'ENG' }` cast `as any` (since real Team has more fields), verify result equals `{ id: 'team-1', name: 'Engineering', key: 'ENG' }`

**describe('mapLinearError'):**
- Test: `maps rate limit error (429)` — `expect(mapLinearError(new Error('429 Too Many Requests'))).toEqual({ code: 'RATE_LIMIT', message: 'Linear API rate limit exceeded' })`
- Test: `maps rate limit error (text match)` — `expect(mapLinearError(new Error('rate limit exceeded'))).toEqual({ code: 'RATE_LIMIT', message: 'Linear API rate limit exceeded' })`
- Test: `maps 401 unauthorized error` — `expect(mapLinearError(new Error('401 Unauthorized'))).toEqual({ code: 'INVALID_API_KEY', message: 'Invalid Linear API key' })`
- Test: `maps 'Unauthorized' text error` — `expect(mapLinearError(new Error('Unauthorized access'))).toEqual({ code: 'INVALID_API_KEY', message: 'Invalid Linear API key' })`
- Test: `maps 'Invalid API key' text error` — `expect(mapLinearError(new Error('Invalid API key provided'))).toEqual({ code: 'INVALID_API_KEY', message: 'Invalid Linear API key' })`
- Test: `maps 404 error` — `expect(mapLinearError(new Error('404 not found'))).toEqual({ code: 'TEAM_NOT_FOUND', message: '404 not found' })`
- Test: `maps 'not found' text error` — `expect(mapLinearError(new Error('Resource not found'))).toEqual({ code: 'TEAM_NOT_FOUND', message: 'Resource not found' })`
- Test: `maps generic error to API_ERROR` — `expect(mapLinearError(new Error('Something went wrong'))).toEqual({ code: 'API_ERROR', message: 'Something went wrong' })`
- Test: `maps non-Error unknown to API_ERROR with fallback message` — `expect(mapLinearError('string error')).toEqual({ code: 'API_ERROR', message: 'string error' })` (verify `getErrorMessage` handles non-Error)
- Test: `maps null error to fallback message` — `expect(mapLinearError(null)).toEqual({ code: 'API_ERROR', message: 'Unknown Linear API error' })`

**describe('createDedupKey'):**
- Test: `creates key with operation and single arg` — `expect(createDedupKey('listIssues', 'key123')).toBe('listIssues:key123')`
- Test: `creates key with operation and multiple args` — `expect(createDedupKey('listIssues', 'key123', 'team-1', '7')).toBe('listIssues:key123:team-1:7')`
- Test: `creates key with operation only` — `expect(createDedupKey('validate')).toBe('validate:')`

**describe('filterIssuesByCompletionDate'):**
- Create a helper `makeIssue(overrides)` that returns a `LinearIssue` with defaults and override capability. The `LinearIssue` type is imported from `../../domain/models.js`.
- Test: `keeps non-completed issues regardless of date` — create issue with `state.type: 'started'`, old date. Verify it's kept.
- Test: `keeps recently completed issues` — create issue with `state.type: 'completed'`, `completedAt: new Date().toISOString()`. Call `filterIssuesByCompletionDate([issue], 7)`. Verify kept.
- Test: `filters out old completed issues beyond cutoff` — create issue with `state.type: 'completed'`, `completedAt` set 30 days ago. Call with `completedSinceDays=7`. Verify filtered out.
- Test: `filters out old cancelled issues beyond cutoff` — same as above but with `state.type: 'cancelled'`.
- Test: `keeps completed issues with null completedAt` — create issue with `state.type: 'completed'`, `completedAt: null`. Verify kept (no completedAt to compare).
- Test: `keeps completed issues at exact cutoff boundary` — create issue with `completedAt` exactly 7 days ago. Call with `completedSinceDays=7`. Verify kept (uses `<` not `<=`).
- Test: `returns empty array when all filtered out` — pass array of old completed issues, verify empty array returned.
- Test: `returns all when none filtered` — pass array of active issues, verify all returned.

**describe('cache utilities'):**
- Test: `clearClientCache resets both caches` — call `clearClientCache()`, then `expect(getClientCacheSize()).toBe(0)` and `expect(getDedupCacheSize()).toBe(0)`.

### Files to Create
None.

### Files to Modify
- `apps/linear-agent/src/__tests__/infra/linearApiClient.test.ts` — add imports for exported functions; add describe blocks for `mapIssueStateType`, `mapTeam`, `mapLinearError`, `createDedupKey`, `filterIssuesByCompletionDate`, cache utilities

### Test Requirements
- [ ] Test: mapIssueStateType for all 5 valid inputs + 2 edge cases (unknown, empty) — verifies switch case completeness
- [ ] Test: mapTeam — verifies team field mapping
- [ ] Test: mapLinearError for rate-limit, unauthorized, not-found, generic, null — verifies error classification
- [ ] Test: createDedupKey — verifies key format
- [ ] Test: filterIssuesByCompletionDate — verifies date filtering logic for completed/cancelled/active issues
- [ ] Test: cache utilities — verifies clear/size functions

### Acceptance Criteria
- [ ] All new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-COV-2 — Add tests for processLinearAction.ts idempotency + save failure + failed issue save

### Context
The existing test file covers the happy path, idempotency, and several failure modes. However, it does not test: (1) `buildDescription` with summary but without functionalRequirements or technicalDetails, (2) the failed issue repository `.create()` call failing silently (lines 128-136, 156-164, 189-197 all call `failedIssueRepository.create()` without checking the result — these succeed in tests but could fail and the use case should still return the correct response).

### Pre-conditions
- [ ] Read `apps/linear-agent/src/domain/useCases/processLinearAction.ts` lines 44-68, 86-104, 128-136, 156-164, 189-197, 221-226
- [ ] Read `apps/linear-agent/src/__tests__/domain/useCases/processLinearAction.test.ts`
- [ ] Read `apps/linear-agent/src/__tests__/fakes.ts` — confirm `FakeFailedIssueRepository` has no `setSaveFailure` method (it does NOT have one; its `create` always succeeds)

### Steps
1. Open `apps/linear-agent/src/__tests__/fakes.ts`, find `FakeFailedIssueRepository.create()` method (line 484). Note that `create` always succeeds — there is no `shouldFailCreate` flag. Add a new flag and setter:
   - Add private field: `private shouldFailCreate = false;`
   - Modify `create()` to check: `if (this.shouldFailCreate) return err(this.failError);` at the top
   - Add setter: `setCreateFailure(fail: boolean, error?: LinearError): void { this.shouldFailCreate = fail; if (error) this.failError = error; }`
   - Add `this.shouldFailCreate = false;` to the `reset()` method

2. Open `apps/linear-agent/src/__tests__/domain/useCases/processLinearAction.test.ts`

3. Add tests inside a NEW describe block `'failed issue save failures'` (after the `'description builder'` block):

   **Test: `still returns failed status when failedIssueRepository.create fails during extraction failure`:**
   - Setup: `setupConnectedUser()`, set extraction to fail with `EXTRACTION_FAILED`
   - Create a subclass of `FakeFailedIssueRepository` that overrides `create` to return `err({ code: 'INTERNAL_ERROR', message: 'DB write failed' })`
   - Call `processLinearAction` with the failing repo
   - Assert: `result.ok === true`, `result.value.status === 'failed'`, `result.value.message === 'LLM service unavailable'`
   - Rationale: Lines 128-136 call `await failedIssueRepository.create(...)` but DON'T check its result — the function should still return ok with failed status

   **Test: `still returns failed status when failedIssueRepository.create fails during invalid extraction`:**
   - Setup: `setupConnectedUser()`, set extraction response with `valid: false`, `error: 'Too vague'`
   - Use same failing repo override for `create`
   - Call `processLinearAction`
   - Assert: `result.ok === true`, `result.value.status === 'failed'`, `result.value.message === 'Too vague'`
   - Rationale: Lines 156-164 don't check create result

   **Test: `still returns failed status when failedIssueRepository.create fails during Linear API failure`:**
   - Setup: `setupConnectedUser()`, valid extraction, `fakeLinearClient.setFailure(true, { code: 'API_ERROR', message: 'API down' })`
   - Use same failing repo override for `create`
   - Call `processLinearAction`
   - Assert: `result.ok === true`, `result.value.status === 'failed'`, `result.value.message === 'API down'`
   - Rationale: Lines 189-197 don't check create result

4. Add a test inside the existing `'description builder'` describe block:

   **Test: `includes Key Points section even without functional/technical sections`:**
   - Setup: `setupConnectedUser()`, extraction with `functionalRequirements: null`, `technicalDetails: null`, `valid: true`
   - Request with `summary: '- Key point A'`
   - Verify description contains `## Key Points` and `- Key point A` but NOT `## Functional Requirements` and NOT `## Technical Details`

### Files to Create
None.

### Files to Modify
- `apps/linear-agent/src/__tests__/fakes.ts` — add `shouldFailCreate` flag and `setCreateFailure` setter to `FakeFailedIssueRepository`
- `apps/linear-agent/src/__tests__/domain/useCases/processLinearAction.test.ts` — add 4 new tests

### Test Requirements
- [ ] Test: `still returns failed when failedIssueRepo.create fails during extraction failure` — verifies lines 128-136 don't block on create failure
- [ ] Test: `still returns failed when failedIssueRepo.create fails during invalid extraction` — verifies lines 156-164
- [ ] Test: `still returns failed when failedIssueRepo.create fails during Linear API failure` — verifies lines 189-197
- [ ] Test: `Key Points without functional/technical` — verifies buildDescription with summary-only

### Acceptance Criteria
- [ ] All new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-COV-3 — Add tests for internalIssuesRoutes.ts labels + tree edge cases

### Context
The test file already has extensive coverage. Remaining gaps: (1) `toCommentSummary` helper (line 96-103) is tested indirectly but there's a v8 ignore on line 100; (2) `buildIssueDisplayResponse` (lines 66-94) has a v8 ignore on the assignee mapping (line 87); (3) label mutation logic (lines 359-372) with `addLabels`/`removeLabels` arrays has v8 ignores on lines 360-363; (4) tree endpoint with labels on root/descendants.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/routes/internalIssuesRoutes.ts` lines 38-44, 66-103, 121-129, 359-372, 860-927
- [ ] Read `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`
- [ ] Read `apps/linear-agent/src/__tests__/fakes.ts` — verify `FakeLinearApiClient.listIssueLabels()` returns `ok([])` by default

### Steps
1. Open `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`

2. Inside the existing `describe('PATCH /internal/linear/issues/:issueId/metadata - updateIssue paths')` block, add new tests:

   **Test: `applies addLabels and removeLabels correctly`:**
   - Seed issue with labels: `[{ id: 'label-bug', name: 'bug', color: '#ff0000' }, { id: 'label-feature', name: 'feature', color: '#00ff00' }]`
   - Seed the same issue in `fakeLinearClient` (so `updateIssue` succeeds)
   - Override `fakeLinearClient.listIssueLabels` to return labels: `[{ id: 'label-bug', name: 'bug', color: '#ff0000' }, { id: 'label-feature', name: 'feature', color: '#00ff00' }, { id: 'label-docs', name: 'docs', color: '#0000ff' }]` — This requires modifying `FakeLinearApiClient` to support `setLabels` (see step 3 below)
   - PATCH with body `{ addLabels: ['docs'], removeLabels: ['bug'] }`
   - Verify 200. The label resolution should: start with current `['bug', 'feature']`, add `'docs'` -> `['bug', 'feature', 'docs']`, remove `'bug'` -> `['feature', 'docs']`. Then filter the team's label list by those names to get IDs: `['label-feature', 'label-docs']`.

3. Open `apps/linear-agent/src/__tests__/fakes.ts`. In `FakeLinearApiClient`:
   - Add a field: `private labels: { id: string; name: string; color: string }[] = [];`
   - Modify `listIssueLabels` to return `ok(this.labels)` instead of `ok([])`
   - Add method: `setLabels(labels: { id: string; name: string; color: string }[]): void { this.labels = labels; }`
   - In `reset()`, add `this.labels = [];`

4. In the same test file, inside `describe('GET /internal/issues/:issueId/tree')`, add:

   **Test: `tree response includes labels and assigneeId on root and descendants`:**
   - Seed root with `labels: [{ id: 'l1', name: 'backend', color: '#000' }]`, `assigneeId: 'user-A'`
   - Seed child with `labels: [{ id: 'l2', name: 'frontend', color: '#fff' }]`, `assigneeId: 'user-B'`, `parentId: root.id`
   - GET tree for root
   - Verify `root.labels` is `['backend']`, `root.assigneeId` is `'user-A'`
   - Verify `descendants[0].labels` is `['frontend']`, `descendants[0].assigneeId` is `'user-B'`

5. Inside `describe('PATCH /internal/issues/:issueId/state')`, verify the `STATE_NAME_MAP` coverage:

   **Test: `resolves 'todo' state name through STATE_NAME_MAP`:**
   - This test already exists (line 1289-1302) and correctly verifies that 'todo' maps to 'Todo' which is not found in the fake's workflow states. No new test needed.

### Files to Create
None.

### Files to Modify
- `apps/linear-agent/src/__tests__/fakes.ts` — add `setLabels` support to `FakeLinearApiClient`
- `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts` — add tests for label mutation with addLabels/removeLabels, tree with labels/assigneeId

### Test Requirements
- [ ] Test: `applies addLabels and removeLabels correctly` — verifies label mutation logic (lines 359-372)
- [ ] Test: `tree includes labels and assigneeId` — verifies tree response shape (lines 910-926)

### Acceptance Criteria
- [ ] All new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-COV-4 — Add tests for linearRoutes.ts retry + pagination edge cases

### Context
The existing tests cover most linearRoutes paths. Gaps: (1) retry route when `failedIssueRepository.update` fails during retry failure (lines 331-335 — logged but execution continues); (2) retry route when `failedIssueRepository.delete` fails after successful retry (lines 341-347 — logged but returns success); (3) `handleLinearError` with `INTERNAL_ERROR` code (line 35); (4) pagination edge case where offset equals total (no hasMore, 0 comments returned).

### Pre-conditions
- [ ] Read `apps/linear-agent/src/routes/linearRoutes.ts` lines 22-39, 316-349, 609-656
- [ ] Read `apps/linear-agent/src/__tests__/routes/linearRoutes.test.ts`
- [ ] Read `apps/linear-agent/src/__tests__/fakes.ts` — verify `FakeFailedIssueRepository` has `setUpdateFailure` and `setDeleteFailure`

### Steps
1. Open `apps/linear-agent/src/__tests__/routes/linearRoutes.test.ts`

2. Inside the existing `describe('POST /linear/failed-issues/:id/retry')` block, add:

   **Test: `still returns 422 when failedIssueRepository.update fails during retry failure`:**
   - Setup: `seedConnection('test-user-123')`, create failed issue, set `ctx.linearApiClient.setFailure(true, { code: 'API_ERROR', message: 'API unavailable' })`, set `ctx.failedIssueRepository.setUpdateFailure(true)`
   - POST retry
   - Verify: response is 422, `error.code === 'UNPROCESSABLE_ENTITY'`, `error.message === 'API unavailable'`
   - Rationale: Lines 331-335 log but don't block on update failure

   **Test: `still returns 200 when failedIssueRepository.delete fails after successful retry`:**
   - Setup: `seedConnection('test-user-123')`, create failed issue, `ctx.failedIssueRepository.setDeleteFailure(true)` (set AFTER creating the issue)
   - POST retry
   - Verify: response is 200, `body.success === true`, `body.data.issue` is defined
   - Rationale: Lines 341-347 log but return success
   - Verify: the failed issue still exists (since delete failed): `ctx.failedIssueRepository.listByUser('test-user-123')` should have length 1

3. Inside the existing `describe('GET /linear/issues/:identifier/comments')` block, add:

   **Test: `returns empty comments when offset equals total`:**
   - Setup: seed issue, save 2 comments
   - GET `/linear/issues/ENG-123/comments?offset=2&limit=20`
   - Verify: `comments` array is empty, `total === 2`, `offset === 2`, `hasMore === false`

   **Test: `returns empty comments when offset exceeds total`:**
   - Setup: seed issue, save 2 comments
   - GET `/linear/issues/ENG-123/comments?offset=10&limit=20`
   - Verify: `comments` array is empty, `total === 2`, `offset === 10`, `hasMore === false`

4. Inside the existing `describe('GET /linear/connection')` block (or at the top level as a new describe `'handleLinearError edge cases'`), add:

   **Test: `handleLinearError maps INTERNAL_ERROR code to INTERNAL_ERROR response`:**
   - Setup: `ctx.connectionRepository.setGetConnectionFailure(true, { code: 'INTERNAL_ERROR', message: 'Internal database error' })`
   - GET `/linear/connection` with valid auth token
   - Verify: status 500, `error.code === 'INTERNAL_ERROR'`
   - Rationale: Covers lines 35-36 of handleLinearError

### Files to Create
None.

### Files to Modify
- `apps/linear-agent/src/__tests__/routes/linearRoutes.test.ts` — add tests for retry error resilience, pagination edge cases, handleLinearError INTERNAL_ERROR path

### Test Requirements
- [ ] Test: `retry — update failure doesn't block` — verifies lines 327-336
- [ ] Test: `retry — delete failure doesn't block success` — verifies lines 341-347
- [ ] Test: `pagination offset=total` — verifies lines 643-646 edge case
- [ ] Test: `pagination offset>total` — verifies slice behavior
- [ ] Test: `handleLinearError INTERNAL_ERROR` — verifies line 35

### Acceptance Criteria
- [ ] All new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-1 — Extract domain logic from internalIssuesRoutes.ts

### Context
`internalIssuesRoutes.ts` (933 lines) contains significant domain logic embedded in route handlers: `STATE_NAME_MAP`, `findStateId`, `toCommentSummary`, `buildIssueDisplayResponse`, label mutation logic, and tree traversal. These should be extracted to domain layer files so routes only handle HTTP concerns.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/routes/internalIssuesRoutes.ts` — identify all non-route logic
- [ ] Read `apps/linear-agent/src/domain/models.ts` — understand existing domain types
- [ ] Read `apps/linear-agent/src/domain/index.ts` — understand current exports
- [ ] Run `pnpm run verify:workspace:tracked -- linear-agent` and confirm it passes before starting

### Steps

1. **Create `apps/linear-agent/src/domain/stateUtils.ts`:**
   - Move `STATE_NAME_MAP` (lines 38-44) as an exported const
   - Move `findStateId` (lines 121-129) as an exported function
   - Export type annotation: function takes `states: { id: string; name: string; type: string }[]` and `stateName: string`, returns `string | null`

2. **Create `apps/linear-agent/src/domain/issueDisplayMapper.ts`:**
   - Move `toCommentSummary` (lines 96-103) as an exported function. Keep its v8 ignore comments.
   - Move `buildIssueDisplayResponse` (lines 66-94) as an exported function. Keep its v8 ignore comments.
   - Import the `IssueDisplayResponse` interface — move it here too (lines 54-64) and export it
   - Import needed types from `./models.js`

3. **Create `apps/linear-agent/src/domain/useCases/resolveLabels.ts`:**
   - Extract label mutation logic from lines 359-372 into a pure function:
     ```ts
     export function resolveDesiredLabelIds(
       currentLabels: { name: string }[],
       addLabels: string[],
       removeLabels: string[],
       availableLabels: { id: string; name: string }[]
     ): string[]
     ```
   - Logic: build set from current label names, add `addLabels`, remove `removeLabels`, then filter `availableLabels` by the resulting set, return their IDs

4. **Create `apps/linear-agent/src/domain/useCases/buildIssueTree.ts`:**
   - Extract tree traversal from lines 860-927 into a pure function:
     ```ts
     export function buildIssueTree(
       allIssues: SyncedLinearIssue[],
       rootId: string
     ): { root: SyncedLinearIssue; descendants: SyncedLinearIssue[] } | null
     ```
   - Returns null if root not found
   - Import `SyncedLinearIssue` from `../models.js`

5. **Update `apps/linear-agent/src/domain/index.ts`:**
   - Add exports for new files:
     ```ts
     export { STATE_NAME_MAP, findStateId } from './stateUtils.js';
     export { toCommentSummary, buildIssueDisplayResponse, type IssueDisplayResponse } from './issueDisplayMapper.js';
     export { resolveDesiredLabelIds } from './useCases/resolveLabels.js';
     export { buildIssueTree } from './useCases/buildIssueTree.js';
     ```

6. **Update `apps/linear-agent/src/routes/internalIssuesRoutes.ts`:**
   - Remove moved code (STATE_NAME_MAP, findStateId, toCommentSummary, buildIssueDisplayResponse, IssueDisplayResponse interface, IssueResponse type stays since it's route-specific)
   - Import from domain: `import { STATE_NAME_MAP, findStateId, toCommentSummary, buildIssueDisplayResponse, type IssueDisplayResponse, resolveDesiredLabelIds, buildIssueTree } from '../domain/index.js';`
   - Replace label mutation logic (lines 359-372) with: `const desiredLabelIds = resolveDesiredLabelIds(syncedIssue.labels, request.body.addLabels ?? [], request.body.removeLabels ?? [], labelsResult.value);`
   - Replace tree traversal (lines 860-927) with: call `buildIssueTree(allIssues, issueId)`, handle null return as 404, then format response from the result
   - Keep v8 ignore comments on lines that remain in the route

7. **Create tests for extracted domain logic:**
   - Create `apps/linear-agent/src/__tests__/domain/stateUtils.test.ts`:
     - Test `findStateId` finds match (case-insensitive)
     - Test `findStateId` returns null when no match
     - Test `STATE_NAME_MAP` contains all expected keys
   - Create `apps/linear-agent/src/__tests__/domain/issueDisplayMapper.test.ts`:
     - Test `toCommentSummary` with empty array
     - Test `toCommentSummary` with comments
     - Test `buildIssueDisplayResponse` with assignee
     - Test `buildIssueDisplayResponse` without assignee
   - Create `apps/linear-agent/src/__tests__/domain/useCases/resolveLabels.test.ts`:
     - Test add labels
     - Test remove labels
     - Test combined add + remove
     - Test empty inputs
   - Create `apps/linear-agent/src/__tests__/domain/useCases/buildIssueTree.test.ts`:
     - Test root found with children
     - Test root found with no children
     - Test root not found returns null
     - Test grandchildren included

### Files to Create
- `apps/linear-agent/src/domain/stateUtils.ts` — STATE_NAME_MAP + findStateId
- `apps/linear-agent/src/domain/issueDisplayMapper.ts` — toCommentSummary + buildIssueDisplayResponse + IssueDisplayResponse
- `apps/linear-agent/src/domain/useCases/resolveLabels.ts` — resolveDesiredLabelIds
- `apps/linear-agent/src/domain/useCases/buildIssueTree.ts` — buildIssueTree
- `apps/linear-agent/src/__tests__/domain/stateUtils.test.ts`
- `apps/linear-agent/src/__tests__/domain/issueDisplayMapper.test.ts`
- `apps/linear-agent/src/__tests__/domain/useCases/resolveLabels.test.ts`
- `apps/linear-agent/src/__tests__/domain/useCases/buildIssueTree.test.ts`

### Files to Modify
- `apps/linear-agent/src/domain/index.ts` — add exports
- `apps/linear-agent/src/routes/internalIssuesRoutes.ts` — replace inline logic with domain imports

### Test Requirements
- [ ] Test: findStateId match — verifies case-insensitive matching
- [ ] Test: findStateId no match — verifies null return
- [ ] Test: toCommentSummary empty/populated — verifies comment counting
- [ ] Test: buildIssueDisplayResponse with/without assignee — verifies response mapping
- [ ] Test: resolveDesiredLabelIds add/remove/combined — verifies label logic
- [ ] Test: buildIssueTree root/children/grandchildren/not-found — verifies tree traversal

### Acceptance Criteria
- [ ] All extracted functions have direct unit tests
- [ ] internalIssuesRoutes.ts is reduced by ~100-150 lines
- [ ] Route handlers only handle HTTP concerns (auth, parse, call domain, format response)
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-2 — Extract repository calls from linearRoutes.ts to use-cases

### Context
`linearRoutes.ts` (983 lines) has route handlers that directly call repositories and embed business logic (e.g., failed issue retry with fallback values at lines 316-323, error update at lines 327-336, pagination at lines 643-646). These should be extracted to domain use-cases.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/routes/linearRoutes.ts` — identify all direct repository/client calls
- [ ] Read `apps/linear-agent/src/domain/useCases/` — understand existing use-case patterns
- [ ] Run `pnpm run verify:workspace:tracked -- linear-agent` before starting

### Steps

1. **Create `apps/linear-agent/src/domain/useCases/retryFailedIssue.ts`:**
   - Extract retry logic from lines 268-349 into:
     ```ts
     export interface RetryFailedIssueDeps {
       failedIssueRepository: FailedIssueRepository;
       linearApiClient: LinearApiClient;
       connectionRepository: LinearConnectionRepository;
       logger?: Logger;
     }
     export interface RetryFailedIssueRequest {
       failedIssueId: string;
       userId: string;
     }
     export type RetryFailedIssueResult =
       | { status: 'success'; issue: LinearIssue }
       | { status: 'not_found' }
       | { status: 'not_connected' }
       | { status: 'creation_failed'; errorMessage: string };
     export async function retryFailedIssue(
       request: RetryFailedIssueRequest,
       deps: RetryFailedIssueDeps
     ): Promise<Result<RetryFailedIssueResult, LinearError>>
     ```
   - Move: getById check + ownership check + getApiKey + getFullConnection + createIssue with fallback values + update error on failure + delete on success
   - Keep the v8 ignore comments on lines 316-323 fallback values

2. **Create `apps/linear-agent/src/domain/useCases/getIssueComments.ts`:**
   - Extract comment pagination from lines 597-656 into:
     ```ts
     export interface GetIssueCommentsDeps {
       issueRepository: LinearIssueRepository;
       commentRepository: LinearCommentRepository;
       logger?: Logger;
     }
     export interface GetIssueCommentsRequest {
       identifier: string;
       userId: string;
       limit: number;
       offset: number;
     }
     export interface PaginatedComments {
       comments: LinearComment[];
       total: number;
       limit: number;
       offset: number;
       hasMore: boolean;
     }
     export async function getIssueComments(
       request: GetIssueCommentsRequest,
       deps: GetIssueCommentsDeps
     ): Promise<Result<PaginatedComments | null, LinearError>>
     ```
   - Returns `null` in the Result value when issue not found (route maps to 404)
   - Handles: findByIdentifier + listByIssueId + countByIssueId + slice pagination

3. **Create `apps/linear-agent/src/domain/useCases/getIssueDetail.ts`:**
   - Extract single issue fetch from lines 447-508:
     ```ts
     export interface GetIssueDetailDeps {
       issueRepository: LinearIssueRepository;
       commentRepository: LinearCommentRepository;
       logger?: Logger;
     }
     export async function getIssueDetail(
       identifier: string,
       userId: string,
       deps: GetIssueDetailDeps
     ): Promise<Result<IssueDetailResponse | null, LinearError>>
     ```
   - Combine issue lookup + comment fetching + response assembly

4. **Update `apps/linear-agent/src/domain/index.ts`** — add exports for new use-cases

5. **Update `apps/linear-agent/src/routes/linearRoutes.ts`** — replace inline logic with use-case calls. Routes become thin: parse request -> call use-case -> send response.

6. **Write tests:**
   - `apps/linear-agent/src/__tests__/domain/useCases/retryFailedIssue.test.ts` — success, not found, ownership mismatch, not connected, API failure + update error, delete failure still succeeds
   - `apps/linear-agent/src/__tests__/domain/useCases/getIssueComments.test.ts` — success, issue not found, pagination edges
   - `apps/linear-agent/src/__tests__/domain/useCases/getIssueDetail.test.ts` — success with/without comments, not found

### Files to Create
- `apps/linear-agent/src/domain/useCases/retryFailedIssue.ts`
- `apps/linear-agent/src/domain/useCases/getIssueComments.ts`
- `apps/linear-agent/src/domain/useCases/getIssueDetail.ts`
- `apps/linear-agent/src/__tests__/domain/useCases/retryFailedIssue.test.ts`
- `apps/linear-agent/src/__tests__/domain/useCases/getIssueComments.test.ts`
- `apps/linear-agent/src/__tests__/domain/useCases/getIssueDetail.test.ts`

### Files to Modify
- `apps/linear-agent/src/domain/index.ts` — add exports
- `apps/linear-agent/src/routes/linearRoutes.ts` — replace inline logic with use-case calls

### Test Requirements
- [ ] Test: retryFailedIssue all paths (success, not found, ownership, not connected, API failure, save failures)
- [ ] Test: getIssueComments pagination (normal, offset=total, offset>total, not found)
- [ ] Test: getIssueDetail success and not found paths

### Acceptance Criteria
- [ ] All use-cases have 100% branch coverage
- [ ] linearRoutes.ts route handlers reduced to HTTP-only logic
- [ ] All existing route tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-3 — Extract webhook handler into use-case

### Context
`linearWebhookRoutes.ts` has a 288-line `handleLinearWebhook` function (lines 75-362) mixing HTTP concerns with domain logic: type guards, connection lookups, signature validation, fan-out sync, code task triggering. The domain logic should live in a use-case.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/routes/linearWebhookRoutes.ts` lines 75-362
- [ ] Read `apps/linear-agent/src/domain/webhookTypes.ts`
- [ ] Read `apps/linear-agent/src/domain/useCases/syncSingleIssueUseCase.ts`
- [ ] Run `pnpm run verify:workspace:tracked -- linear-agent` before starting

### Steps

1. **Create `apps/linear-agent/src/domain/webhookTypeGuards.ts`:**
   - Extract `isIssueData` (lines 87-115) and `isCommentData` (lines 118-131) as exported type guard functions
   - Define the narrowed types they guard to (currently inline)
   - Export: `export function isIssueWebhookData(data: unknown): data is IssueWebhookData`
   - Export: `export function isCommentWebhookData(data: unknown): data is CommentWebhookData`

2. **Create `apps/linear-agent/src/domain/useCases/processWebhook.ts`:**
   - Extract the core orchestration into:
     ```ts
     export interface ProcessWebhookDeps {
       connectionRepository: LinearConnectionRepository;
       issueRepository: LinearIssueRepository;
       commentRepository: LinearCommentRepository;
       codeAgentClient: CodeAgentClient;
       validateSignature: (rawBody: string, secret: string) => Result<void, string>;
       logger?: Logger;
     }
     export interface WebhookPayload {
       action: string;
       type: string;
       data: unknown;
       updatedFrom?: LinearWebhookUpdatedFrom;
       webhookTimestamp: number;
       webhookId: string;
       rawBody: string;
     }
     export type ProcessWebhookResult =
       | { outcome: 'ignored'; message: string }
       | { outcome: 'processed'; action: string; issueId?: string; commentId?: string }
       | { outcome: 'unauthorized'; message: string }
       | { outcome: 'error'; message: string };
     ```
   - Move: type check, connection lookup, signature validation, fan-out sync, code task trigger, comment processing
   - The route becomes a thin adapter: extract rawBody + body, call `processWebhook`, map result to HTTP status

3. **Update `apps/linear-agent/src/domain/index.ts`** — add exports

4. **Update `apps/linear-agent/src/routes/linearWebhookRoutes.ts`** — replace `handleLinearWebhook` body with call to `processWebhook` use-case, map result discriminant to HTTP response

5. **Write tests:**
   - `apps/linear-agent/src/__tests__/domain/webhookTypeGuards.test.ts` — test both guards with valid and invalid payloads
   - `apps/linear-agent/src/__tests__/domain/useCases/processWebhook.test.ts` — test ignored types, issue processing, comment processing, signature failure, connection not found

### Files to Create
- `apps/linear-agent/src/domain/webhookTypeGuards.ts`
- `apps/linear-agent/src/domain/useCases/processWebhook.ts`
- `apps/linear-agent/src/__tests__/domain/webhookTypeGuards.test.ts`
- `apps/linear-agent/src/__tests__/domain/useCases/processWebhook.test.ts`

### Files to Modify
- `apps/linear-agent/src/domain/index.ts` — add exports
- `apps/linear-agent/src/routes/linearWebhookRoutes.ts` — thin down to HTTP adapter

### Test Requirements
- [ ] Test: type guards with issue data, comment data, unknown data
- [ ] Test: processWebhook — ignored type, issue create, comment create, signature failure, no connection

### Acceptance Criteria
- [ ] `handleLinearWebhook` reduced from ~288 lines to ~30 lines
- [ ] All existing webhook route tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-4 — Split linearApiClient.ts into client + mappers

### Context
`linearApiClient.ts` (637 lines) mixes pure mapper functions with API client implementation, caching, and deduplication. The pure functions should be extracted to make them independently testable and the client file focused on API communication.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/infra/linear/linearApiClient.ts` — identify mapper functions and caching utilities
- [ ] Run `pnpm run verify:workspace:tracked -- linear-agent` before starting

### Steps

1. **Create `apps/linear-agent/src/infra/linear/linearMappers.ts`:**
   - Move: `mapIssueStateType` (lines 70-85), `mapTeam` (lines 240-246), `mapLinearError` (lines 249-267), `filterIssuesByCompletionDate` (lines 278-296)
   - Move: `IssueState` interface (lines 87-91)
   - Move: `mapIssuesWithBatchedStates` (lines 94-158), `mapSingleIssue` (lines 161-198), `mapSingleIssueWithTeam` (lines 201-237) — these keep their istanbul ignore comments
   - All functions remain exported
   - Import needed types from `../../domain/index.js`

2. **Create `apps/linear-agent/src/infra/linear/requestCache.ts`:**
   - Move: `CLIENT_TTL_MS`, `DEDUP_TTL_MS` constants (lines 29-30)
   - Move: `CachedClient` interface (lines 32-35)
   - Move: `clientCache`, `requestDedup` maps (lines 37-38)
   - Move: `getOrCreateClient` (lines 41-54), `cleanupExpiredClients` (lines 57-64), setInterval (line 67), `withDeduplication` (lines 299-317)
   - Move: `createDedupKey` (lines 270-272), `clearClientCache` (lines 625-628), `getClientCacheSize` (lines 630-632), `getDedupCacheSize` (lines 634-636)
   - Keep istanbul ignore comments

3. **Update `apps/linear-agent/src/infra/linear/linearApiClient.ts`:**
   - Import from `./linearMappers.js`: `mapIssueStateType`, `mapTeam`, `mapLinearError`, `filterIssuesByCompletionDate`, `mapIssuesWithBatchedStates`, `mapSingleIssue`, `mapSingleIssueWithTeam`
   - Import from `./requestCache.js`: `getOrCreateClient`, `withDeduplication`, `createDedupKey`
   - Re-export the functions that tests import directly: `export { mapIssueStateType, mapTeam, mapLinearError, createDedupKey, filterIssuesByCompletionDate, clearClientCache, getClientCacheSize, getDedupCacheSize } from ...`
   - The client file should shrink to ~200 lines (just the `createLinearApiClient` factory + re-exports)

4. **Update existing test import paths** — tests currently import from `linearApiClient.js`, the re-exports ensure no test changes needed

5. **Verify no import path breakage** — all consumers import via `linearApiClient.js` or `domain/index.js`

### Files to Create
- `apps/linear-agent/src/infra/linear/linearMappers.ts` — pure mapper functions
- `apps/linear-agent/src/infra/linear/requestCache.ts` — caching and deduplication

### Files to Modify
- `apps/linear-agent/src/infra/linear/linearApiClient.ts` — import from new files, re-export

### Test Requirements
- [ ] No new tests needed — existing tests validate via re-exports
- [ ] All existing tests must pass with no changes to test files

### Acceptance Criteria
- [ ] `linearApiClient.ts` reduced to ~200 lines
- [ ] `linearMappers.ts` contains all pure mapping functions
- [ ] `requestCache.ts` contains caching infrastructure
- [ ] All existing tests pass unchanged (re-exports maintain API)
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-5 — Move parsing/validation from linearActionExtractionService to domain

### Context
`linearActionExtractionService.ts` (132 lines) contains response parsing logic (JSON parse, markdown stripping, Zod validation) that is domain-level concern mixed with infrastructure (LLM client calls). The parsing should be a separate domain function.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/infra/llm/linearActionExtractionService.ts`
- [ ] Read the `LinearIssueDataSchema` import — find its definition in `@intexuraos/llm-prompts`
- [ ] Run `pnpm run verify:workspace:tracked -- linear-agent` before starting

### Steps

1. **Create `apps/linear-agent/src/domain/extractionParser.ts`:**
   ```ts
   import { err, ok, type Result } from '@intexuraos/common-core';
   import { LinearIssueDataSchema } from '@intexuraos/llm-prompts';
   import { formatZodErrors } from '@intexuraos/llm-utils';
   import type { ExtractedIssueData } from './models.js';
   import type { LinearError } from './errors.js';

   export function parseExtractionResponse(
     rawContent: string
   ): Result<ExtractedIssueData, LinearError>
   ```
   - Move lines 74-127 logic: markdown code block stripping, JSON.parse, Zod validation, mapping to `ExtractedIssueData`
   - Return `err` with `EXTRACTION_FAILED` code for parse/validation errors
   - Return `ok` with `ExtractedIssueData` on success

2. **Update `apps/linear-agent/src/domain/index.ts`** — export `parseExtractionResponse`

3. **Update `apps/linear-agent/src/infra/llm/linearActionExtractionService.ts`:**
   - Import `parseExtractionResponse` from `../../domain/index.js`
   - Replace lines 74-127 with: `return parseExtractionResponse(result.value.content);`
   - The service now only handles: get LLM client, build prompt, call generate, delegate parsing

4. **Write tests:**
   - Create `apps/linear-agent/src/__tests__/domain/extractionParser.test.ts`:
     - Test: valid JSON response -> parsed ExtractedIssueData
     - Test: JSON wrapped in markdown code block -> parsed correctly
     - Test: invalid JSON -> returns EXTRACTION_FAILED error
     - Test: valid JSON but fails Zod schema -> returns EXTRACTION_FAILED with Zod errors
     - Test: JSON with `valid: false` -> returns ok with `valid: false` in result

### Files to Create
- `apps/linear-agent/src/domain/extractionParser.ts`
- `apps/linear-agent/src/__tests__/domain/extractionParser.test.ts`

### Files to Modify
- `apps/linear-agent/src/domain/index.ts` — add export
- `apps/linear-agent/src/infra/llm/linearActionExtractionService.ts` — replace inline parsing with domain call

### Test Requirements
- [ ] Test: parseExtractionResponse with valid JSON
- [ ] Test: parseExtractionResponse with markdown-wrapped JSON
- [ ] Test: parseExtractionResponse with invalid JSON
- [ ] Test: parseExtractionResponse with schema-invalid JSON
- [ ] Test: parseExtractionResponse with valid=false response

### Acceptance Criteria
- [ ] `linearActionExtractionService.ts` reduced to ~60 lines
- [ ] Parsing logic fully testable without LLM client
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-6 — Decompose listIssues.ts use-case

### Context
`listIssues.ts` (209 lines) combines three concerns: (1) `syncedToLinearIssue` mapper, (2) parent-child tree building, (3) dashboard column grouping with date-based archive logic. These should be separate pure functions.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/domain/useCases/listIssues.ts`
- [ ] Read `apps/linear-agent/src/domain/models.ts` — `mapStateToDashboardColumn`
- [ ] Run `pnpm run verify:workspace:tracked -- linear-agent` before starting

### Steps

1. **Create `apps/linear-agent/src/domain/syncedIssueMapper.ts`:**
   - Move `syncedToLinearIssue` function (lines 50-74) and export it
   - Keep v8 ignore comments

2. **Create `apps/linear-agent/src/domain/issueTreeBuilder.ts`:**
   - Extract tree building logic (lines 107-138) into:
     ```ts
     export function buildIssueHierarchy(
       syncedIssues: SyncedLinearIssue[]
     ): { topLevel: LinearIssue[]; subtasks: LinearIssue[]; all: LinearIssue[] }
     ```
   - Uses `syncedToLinearIssue` internally (import from `./syncedIssueMapper.js`)
   - First pass: convert all issues, split into top-level and children
   - Second pass: attach children to parents, update childCount
   - Return both arrays plus combined

3. **Create `apps/linear-agent/src/domain/issueGrouper.ts`:**
   - Extract grouping logic (lines 141-188) into:
     ```ts
     export function groupIssuesByDashboardColumn(
       issues: LinearIssue[],
       options: { includeArchive: boolean; doneDays?: number }
     ): GroupedIssues
     ```
   - Move `DONE_RECENT_DAYS` constant (line 45) here
   - Import `mapStateToDashboardColumn` from `./models.js`
   - Import `GroupedIssues` type from `./useCases/listIssues.js` (or move type to `models.ts`)
   - Keep v8 ignore comments

4. **Move `GroupedIssues` type to `apps/linear-agent/src/domain/models.ts`** if it makes sense architecturally (it's a domain type). Otherwise keep in `listIssues.ts` and import in `issueGrouper.ts`.

5. **Update `apps/linear-agent/src/domain/index.ts`** — add exports

6. **Update `apps/linear-agent/src/domain/useCases/listIssues.ts`:**
   - Import `buildIssueHierarchy` from `../issueTreeBuilder.js`
   - Import `groupIssuesByDashboardColumn` from `../issueGrouper.js`
   - Replace inline logic with calls to these functions
   - The use-case becomes: fetch connection, fetch issues, build hierarchy, group, return

7. **Write tests:**
   - `apps/linear-agent/src/__tests__/domain/syncedIssueMapper.test.ts`:
     - Test mapping with all fields populated
     - Test mapping with null assignee
   - `apps/linear-agent/src/__tests__/domain/issueTreeBuilder.test.ts`:
     - Test with flat list (all top-level)
     - Test with parent-child relationships
     - Test empty input
   - `apps/linear-agent/src/__tests__/domain/issueGrouper.test.ts`:
     - Test grouping by state type
     - Test done vs archive split by date
     - Test includeArchive=false excludes old done items

### Files to Create
- `apps/linear-agent/src/domain/syncedIssueMapper.ts`
- `apps/linear-agent/src/domain/issueTreeBuilder.ts`
- `apps/linear-agent/src/domain/issueGrouper.ts`
- `apps/linear-agent/src/__tests__/domain/syncedIssueMapper.test.ts`
- `apps/linear-agent/src/__tests__/domain/issueTreeBuilder.test.ts`
- `apps/linear-agent/src/__tests__/domain/issueGrouper.test.ts`

### Files to Modify
- `apps/linear-agent/src/domain/index.ts` — add exports
- `apps/linear-agent/src/domain/useCases/listIssues.ts` — use extracted functions

### Test Requirements
- [ ] Test: syncedToLinearIssue field mapping
- [ ] Test: buildIssueHierarchy flat list, nested, empty
- [ ] Test: groupIssuesByDashboardColumn all states, archive logic

### Acceptance Criteria
- [ ] `listIssues.ts` reduced to ~50 lines of orchestration
- [ ] Each extracted function is independently tested
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes

---

## TASK: LA-7 — Decompose processLinearAction.ts orchestration

### Context
`processLinearAction.ts` (234 lines) is a single function combining: idempotency check, connection lookup, LLM extraction, description building, issue creation, and result recording. The `buildDescription` function (lines 44-68) is already separated but private. Sub-operations can be extracted.

### Pre-conditions
- [ ] Read `apps/linear-agent/src/domain/useCases/processLinearAction.ts`
- [ ] Run `pnpm run verify:workspace:tracked -- linear-agent` before starting

### Steps

1. **Create `apps/linear-agent/src/domain/descriptionBuilder.ts`:**
   - Move `buildDescription` function (lines 44-68) and export it:
     ```ts
     export function buildIssueDescription(
       extracted: ExtractedIssueData,
       originalText: string,
       summary?: string
     ): string
     ```
   - Import `ExtractedIssueData` from `./models.js`

2. **Create `apps/linear-agent/src/domain/useCases/checkIdempotency.ts`:**
   - Extract idempotency check (lines 87-104) into:
     ```ts
     export async function checkProcessedAction(
       actionId: string,
       repository: ProcessedActionRepository,
       logger?: Logger
     ): Promise<Result<ProcessLinearActionResponse | null, LinearError>>
     ```
   - Returns `ok(null)` if action not yet processed (caller should continue)
   - Returns `ok(ServiceFeedback)` if already processed (caller should return early)
   - Returns `err` if repository check fails

3. **Update `apps/linear-agent/src/domain/index.ts`** — add exports

4. **Update `apps/linear-agent/src/domain/useCases/processLinearAction.ts`:**
   - Import `buildIssueDescription` from `../descriptionBuilder.js`
   - Import `checkProcessedAction` from `./checkIdempotency.js`
   - Replace `buildDescription` call with `buildIssueDescription`
   - Replace idempotency block with `checkProcessedAction` call
   - The orchestrator shrinks by ~40 lines and becomes clearer

5. **Write tests:**
   - `apps/linear-agent/src/__tests__/domain/descriptionBuilder.test.ts`:
     - Test with all sections present
     - Test with only originalText (null functional/technical)
     - Test with summary
     - Test without summary
     - Test section ordering (Original > Key Points > Functional > Technical)
   - `apps/linear-agent/src/__tests__/domain/useCases/checkIdempotency.test.ts`:
     - Test returns null when action not processed
     - Test returns existing result when action already processed
     - Test returns error when repository fails

### Files to Create
- `apps/linear-agent/src/domain/descriptionBuilder.ts`
- `apps/linear-agent/src/domain/useCases/checkIdempotency.ts`
- `apps/linear-agent/src/__tests__/domain/descriptionBuilder.test.ts`
- `apps/linear-agent/src/__tests__/domain/useCases/checkIdempotency.test.ts`

### Files to Modify
- `apps/linear-agent/src/domain/index.ts` — add exports
- `apps/linear-agent/src/domain/useCases/processLinearAction.ts` — use extracted functions

### Test Requirements
- [ ] Test: buildIssueDescription all section combinations
- [ ] Test: checkProcessedAction — not found, found, error

### Acceptance Criteria
- [ ] `processLinearAction.ts` reduced by ~40 lines
- [ ] `buildDescription` is directly testable (not buried in use-case)
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- linear-agent` passes
