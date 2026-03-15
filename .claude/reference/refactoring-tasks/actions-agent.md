# Refactoring Tasks — actions-agent

I now have a comprehensive understanding of the entire codebase. Let me produce the detailed instructions for all tasks.

---

## TASK: AA-COV-1

### Context

The `handleApprovalReply.ts` use case has uncovered branches for button ID mismatch (line 296), reminder type fallback (line 546), invalid button ID format (lines 282-284), and the processing status when an approval button is pressed. Some of these are already tested (button ID mismatch at line 405, invalid format at line 388), so this task focuses on the gaps: the **reminder type fallback** path (line 546 `case 'reminder'`) and the **processing status** (action in `processing` status, which is NOT terminal, so the code continues past the terminal check at line 196 and reaches buttonId handling).

### Pre-conditions

- [ ] Read the existing test file at `apps/actions-agent/src/__tests__/usecases/handleApprovalReply.test.ts` to confirm no duplicate tests
- [ ] Read the source file at `apps/actions-agent/src/domain/usecases/handleApprovalReply.ts`

### Steps

1. Open `apps/actions-agent/src/__tests__/usecases/handleApprovalReply.test.ts`
2. Find the end of the file (after the last `describe` block, before the final closing `});`)
3. Add the following new `describe` blocks before the final `});`:

**Test 1: Reminder type fallback to event publishing after approval**

- Add inside a new `describe('reminder action type fallback', () => { ... })` block
- Create a reminder-type action: `{ id: 'reminder-action-1', type: 'reminder', userId: 'user-1', commandId: 'cmd-1', title: 'Test reminder', status: 'awaiting_approval', confidence: 0.85, payload: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }`
- Save to `actionRepository`
- Call useCase with `buttonId: 'approve:reminder-action-1'`, `actionId: 'reminder-action-1'`, `userId: 'user-1'`, `replyText: ''`, `replyToWamid: 'wamid-123'`
- Assert `result.ok === true`, `result.value.outcome === 'approved'`
- Assert `actionEventPublisher.getPublishedEvents()` has length 1 (because reminder type falls through the switch at line 546 to the fallback event publishing at line 551)
- Assert `actionEventPublisher.getPublishedEvents()[0]?.actionType === 'reminder'`

**Test 2: Processing status is NOT terminal, so text reply re-sends buttons**

- Add inside a new `describe('non-terminal status handling', () => { ... })` block
- Save action with `status: 'processing'` to repository
- Call useCase with text reply only (no `buttonId`), `actionId: 'action-1'`, `userId: 'user-1'`, `replyText: 'yes'`, `replyToWamid: 'wamid-123'`
- Assert `result.ok === true`, `result.value.matched === true`, `result.value.outcome === 'unclear_requested_clarification'`
- Assert WhatsApp message was sent with buttons (re-send approval buttons)

**Test 3: Processing status is NOT terminal, approve button still works**

- Same `describe` block
- Save action with `status: 'processing'` to repository
- Call useCase with `buttonId: 'approve:action-1'`, `actionId: 'action-1'`, `userId: 'user-1'`
- The `updateStatusIf` at line 312 will return `status_mismatch` (processing !== awaiting_approval)
- Assert `result.ok === true`, `result.value.matched === true`, no intent/outcome set (race condition path)

**Test 4: Event publishing failure after approval for reminder type**

- Create a reminder action, save it
- Set `actionEventPublisher` to fail next (use `vi.spyOn(actionEventPublisher, 'publishActionCreated').mockResolvedValueOnce(err(...)`)
- Call useCase with approve button
- Assert `result.ok === true` and `result.value.outcome === 'approved'` (event publish failure is logged but doesn't fail the use case)

### Files to Create

- None

### Files to Modify

- `apps/actions-agent/src/__tests__/usecases/handleApprovalReply.test.ts` — Add 4 new test cases in 2 new `describe` blocks

### Test Requirements

- [ ] Test: `'falls back to event publishing when approving a reminder action'` — verifies the `case 'reminder'` branch at line 546 falls through to the event publishing fallback
- [ ] Test: `'re-sends approval buttons for action in processing status (non-terminal)'` — verifies processing is not treated as terminal
- [ ] Test: `'returns race condition result when approving action in processing status'` — verifies the `status_mismatch` path
- [ ] Test: `'still succeeds when event publishing fails after reminder approval'` — verifies the `!eventPublishResult.ok` branch at line 567

### Acceptance Criteria

- [ ] All 4 new tests pass
- [ ] All existing tests in the file pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-COV-2

### Context

The PATCH `/actions/:actionId` handler in `publicRoutes.ts` (lines 132-253) has untested branches for: combined status+type update, invalid status/type values (handled by Fastify schema validation), status-only update, type-only update, `changeActionTypeUseCase` error, and `actionRepository.update` failure.

### Pre-conditions

- [ ] Read `apps/actions-agent/src/routes/publicRoutes.ts` lines 132-253
- [ ] Read `apps/actions-agent/src/__tests__/routes.test.ts` to identify existing PATCH tests
- [ ] Read `apps/actions-agent/src/__tests__/fakes.ts` for `createFakeServices` signature

### Steps

1. Open `apps/actions-agent/src/__tests__/routes.test.ts`
2. Locate the PATCH test section (search for `PATCH /actions/:actionId` or `updateAction`)
3. If no PATCH section exists, add a new `describe('PATCH /actions/:actionId', () => { ... })` block
4. The test setup uses `buildServer()` + `setServices(createFakeServices(...))`. Ensure `fakeActionRepository`, `fakeCommandsAgentClient`, and `fakeActionTransitionRepository` are available in `beforeEach`.
5. Create a JWT token helper like the existing tests: `const createToken = (sub: string) => \`header.${Buffer.from(JSON.stringify({ sub })).toString('base64')}.sig\``
6. Pre-save an action with `status: 'awaiting_approval'`, `type: 'todo'`, `userId: 'user-1'`

**Test cases to add:**

**Test 1: `'updates status only'`**

- PATCH with `{ status: 'processing' }`, no `type`
- Assert 200, `response.data.action.status === 'processing'`, `response.data.action.type === 'todo'`

**Test 2: `'updates type only'`**

- Pre-set command in `fakeCommandsAgentClient.setCommand(action.commandId, 'text', 'whatsapp_text')`
- PATCH with `{ type: 'note' }`, no `status`
- Assert 200, `response.data.action.type === 'note'`, status unchanged

**Test 3: `'updates both status and type'`**

- PATCH with `{ status: 'processing', type: 'note' }`
- Assert 200, action has both `status: 'processing'` AND `type: 'note'`

**Test 4: `'returns error when changeActionTypeUseCase fails'`**

- Mock `changeActionTypeUseCase` to return `{ ok: false, error: { code: 'INVALID_REQUEST', message: 'Cannot change type' } }`
- PATCH with `{ type: 'note' }`
- Assert the response returns the error (status code depends on fail() implementation, likely 400)

**Test 5: `'returns 404 when action not found'`**

- PATCH with non-existent actionId
- Assert 404

**Test 6: `'returns 404 when action belongs to different user'`**

- Save action with `userId: 'other-user'`
- PATCH with auth token for `user-1`
- Assert 404

**Test 7: `'returns 400 for invalid status value'`** (Fastify schema validation)

- PATCH with `{ status: 'invalid_status' }`
- Assert 400

**Test 8: `'returns 400 for invalid type value'`**

- PATCH with `{ type: 'invalid_type' }`
- Assert 400

### Files to Create

- None

### Files to Modify

- `apps/actions-agent/src/__tests__/routes.test.ts` — Add `describe('PATCH /actions/:actionId')` block with 8 test cases

### Test Requirements

- [ ] Test: `'updates status only'` — covers the `status !== undefined` branch at line 245 without triggering `newType` branch
- [ ] Test: `'updates type only'` — covers the `newType !== undefined` branch at line 231 without triggering `status` branch
- [ ] Test: `'updates both status and type'` — covers both branches in sequence
- [ ] Test: `'returns error when changeActionTypeUseCase fails'` — covers `!result.ok` branch at line 237
- [ ] Test: `'returns 404 when action not found'` — covers `action?.userId !== user.userId` at line 226
- [ ] Test: `'returns 404 when action belongs to different user'` — same branch, different scenario
- [ ] Test: `'returns 400 for invalid status value'` — Fastify schema enum validation
- [ ] Test: `'returns 400 for invalid type value'` — Fastify schema enum validation

### Acceptance Criteria

- [ ] All 8 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-COV-3

### Context

The 7 `handle*Action` use cases (note, todo, link, research, calendar, linear, code) are wrapped by `registerActionHandler` which calls `actionRepository.updateStatusIf`. There are existing tests for the `error` outcome from `updateStatusIf` (via `setFailNext`), but the test for the actual repository `getById` failure within the inner handler (when the repo throws/fails during message building) is already tested indirectly. The **handleLinearAction** lacks auto-execute tests (since it has no `shouldAutoExecute` integration -- it always goes to approval). The **confidence boundary tests** for `shouldAutoExecute` threshold (0.9) are needed.

### Pre-conditions

- [ ] Read `apps/actions-agent/src/domain/usecases/shouldAutoExecute.ts` (threshold = 0.9)
- [ ] Read all 7 `handle*Action.test.ts` test files to identify missing coverage
- [ ] Read `apps/actions-agent/src/__tests__/shouldAutoExecute.test.ts` to check existing boundary tests

### Steps

**For handleLinearAction (no auto-execute path):**

1. Open `apps/actions-agent/src/__tests__/handleLinearAction.test.ts`
2. The `handleLinearAction` use case does NOT have `shouldAutoExecute` logic (it always sends approval). No auto-execute test needed for this type. Instead, verify that the `registerActionHandler` wrapper's `error` case from `updateStatusIf` is tested -- this is already covered by `'fails when marking action as awaiting_approval fails'`. No new tests needed for linear handle.

**For shouldAutoExecute confidence boundary tests:**

1. Open `apps/actions-agent/src/__tests__/shouldAutoExecute.test.ts`
2. Add boundary tests:
   - `shouldAutoExecute` returns `false` for confidence `0.89` (just below threshold)
   - `shouldAutoExecute` returns `true` for confidence `0.9` (exactly at threshold)
   - `shouldAutoExecute` returns `true` for confidence `0.91` (just above threshold)
   - `shouldAutoExecute` returns `true` for confidence `1.0` (maximum)
   - `shouldAutoExecute` returns `false` for confidence `0.0` (minimum)

**For all 7 handle\*Action -- repository `getById` failure:**
The `registerActionHandler` wrapper calls `updateStatusIf` first. If `updateStatusIf` returns `{ outcome: 'error', error: ... }`, the handler returns an error. This path IS already tested (each handle\*Action test has `'fails when marking action as awaiting_approval fails'`). No additional repository `getById` failure tests are needed because the handlers don't call `getById` directly.

### Files to Create

- None

### Files to Modify

- `apps/actions-agent/src/__tests__/shouldAutoExecute.test.ts` — Add 5 boundary test cases (if not already present)

### Test Requirements

- [ ] Test: `'returns false for confidence 0.89 (below threshold)'`
- [ ] Test: `'returns true for confidence 0.9 (at threshold)'`
- [ ] Test: `'returns true for confidence 0.91 (above threshold)'`
- [ ] Test: `'returns true for confidence 1.0 (maximum)'`
- [ ] Test: `'returns false for confidence 0.0 (minimum)'`

### Acceptance Criteria

- [ ] All boundary tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-COV-4

### Context

The 7 `execute*Action` use cases all call `actionRepository.update()` at multiple state transitions (to `processing`, to `completed`, to `failed`). These `update()` calls currently don't handle failures -- they just `await` and assume success. Since the `ActionRepository.update()` method returns `Promise<void>`, a thrown error would propagate up as an unhandled error. Additionally, the `resourceUrl` conditionals (e.g., `if (resourceUrl !== undefined)`) mean the WhatsApp notification is skipped for empty/undefined resourceUrl, which should be tested. The actual "repository update failure" would cause the entire use case to throw, which would propagate to the caller. However, the existing fakes' `update` method does not have a "fail" mechanism independent of `save`. This task should verify that when `resourceUrl` is `undefined`, the WhatsApp notification is NOT sent.

### Pre-conditions

- [ ] Read all 7 `execute*Action.ts` source files
- [ ] Read all 7 `execute*Action.test.ts` test files
- [ ] Read `apps/actions-agent/src/__tests__/fakes.ts` for `FakeActionRepository` capabilities

### Steps

**For each of the 7 execute\*Action test files, add tests for `undefined` resourceUrl:**

1. **executeNoteAction** (`apps/actions-agent/src/__tests__/executeNoteAction.test.ts`):
   - Add test `'does not send WhatsApp notification when resourceUrl is undefined'`
   - Setup: Save action with `payload: { prompt: 'test' }`, status `awaiting_approval`
   - Configure `fakeNotesClient` to return `{ status: 'completed', message: 'Note created' }` (no `resourceUrl`)
   - Assert result is `ok`, `status: 'completed'`, `resourceUrl` is undefined
   - Assert `fakeWhatsappPublisher.getSentMessages()` has length 0

2. **executeTodoAction** (`apps/actions-agent/src/__tests__/executeTodoAction.test.ts`):
   - Same pattern: return `{ status: 'completed', message: 'Todo created' }` (no `resourceUrl`)
   - Assert no WhatsApp message sent

3. **executeResearchAction** (`apps/actions-agent/src/__tests__/executeResearchAction.test.ts`):
   - Same pattern: return `{ status: 'completed', message: 'Research created' }` (no `resourceUrl`)
   - Assert no WhatsApp message sent

4. **executeLinearAction** (`apps/actions-agent/src/__tests__/executeLinearAction.test.ts`):
   - Same pattern: return `{ status: 'completed', message: 'Linear issue created' }` (no `resourceUrl`)
   - Assert no WhatsApp message sent

5. **executeCalendarAction** (`apps/actions-agent/src/__tests__/executeCalendarAction.test.ts`):
   - Same pattern: return `{ status: 'completed', message: 'Event created' }` (no `resourceUrl`)
   - Assert no WhatsApp message sent

6. **executeLinkAction** (`apps/actions-agent/src/__tests__/executeLinkAction.test.ts`):
   - The link action always produces a `resourceUrl` (line 177: `const resourceUrl = \`/#/bookmarks/${bookmarkId}\``), so this test is N/A for link action. Instead test: when `bookmarksServiceClient.createBookmark`returns error with`existingBookmarkId`, the action is marked failed with the `existingBookmarkId` in payload.

7. **executeCodeAction** (`apps/actions-agent/src/__tests__/executeCodeAction.test.ts`):
   - The code action always has `resourceUrl` from `result.value` (line 180), so this test is N/A. Instead test: `WORKER_UNAVAILABLE` error code handling (if not already tested).

**For repository update failure propagation:**
Add test to one representative execute\*Action (e.g., `executeNoteAction`):

- Test `'propagates error when repository update to processing fails'`
- Save action, then `vi.spyOn(fakeActionRepo, 'update').mockRejectedValueOnce(new Error('DB failure'))`
- Call usecase
- Assert the returned promise rejects (wrapping try/catch, or `expect(usecase(...)).rejects.toThrow('DB failure')`)

### Files to Create

- None

### Files to Modify

- `apps/actions-agent/src/__tests__/executeNoteAction.test.ts` — Add 2 tests
- `apps/actions-agent/src/__tests__/executeTodoAction.test.ts` — Add 1 test
- `apps/actions-agent/src/__tests__/executeResearchAction.test.ts` — Add 1 test
- `apps/actions-agent/src/__tests__/executeLinearAction.test.ts` — Add 1 test
- `apps/actions-agent/src/__tests__/executeCalendarAction.test.ts` — Add 1 test

### Test Requirements

- [ ] Test: `'does not send WhatsApp notification when resourceUrl is undefined'` (in 4 test files: note, todo, research, linear)
- [ ] Test: `'propagates error when repository update to processing fails'` (in executeNoteAction.test.ts)
- [ ] Test: `'does not send WhatsApp notification when resourceUrl is undefined'` (in executeCalendarAction.test.ts)

### Acceptance Criteria

- [ ] All new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-COV-5

### Context

The `internalRoutes.ts` POST `/internal/actions/:actionType` endpoint routes all 8 action types (note, todo, link, research, calendar, linear, code, and the catch-all for unknown). The existing `internalRoutes.test.ts` tests `todo` routing and `unsupported` type, but does not test routing for all 8 valid action types individually. It also lacks tests for missing `message` field and malformed JSON in decoded base64.

### Pre-conditions

- [ ] Read `apps/actions-agent/src/routes/internalRoutes.ts` lines 183-368
- [ ] Read `apps/actions-agent/src/__tests__/internalRoutes.test.ts`
- [ ] Read `apps/actions-agent/src/domain/usecases/actionHandlerRegistry.ts`

### Steps

1. Open `apps/actions-agent/src/__tests__/internalRoutes.test.ts`
2. In the `describe('POST /internal/actions/:actionType')` block, add:

**Test 1: `'routes research action type correctly'`**

- Create event with `actionType: 'research'`, send to `/internal/actions/research`
- Assert 200, `body.data.actionId === 'action-1'`

**Test 2: `'routes note action type correctly'`**

- Create event with `actionType: 'note'`, send to `/internal/actions/note`
- Assert 200

**Test 3: `'routes link action type correctly'`**

- Create event with `actionType: 'link'`, send to `/internal/actions/link`
- Assert 200

**Test 4: `'routes calendar action type correctly'`**

- Create event with `actionType: 'calendar'`, send to `/internal/actions/calendar`
- Assert 200

**Test 5: `'routes linear action type correctly'`**

- Create event with `actionType: 'linear'`, send to `/internal/actions/linear`
- Assert 200

**Test 6: `'routes code action type correctly'`**

- Create event with `actionType: 'code'`, send to `/internal/actions/code`
- Assert 200

**Test 7: `'returns 400 when handler returns error result'`**

- This is already tested as `'returns 500 when handler fails'` at line 294. Verify it exists. If it only tests `todo`, add one that tests with a different type to confirm routing.

**Test 8: `'returns 400 when message field is missing from body'`**

- Send POST to `/internal/actions/todo` with payload `{}` (no `message` field)
- Assert 400 (Fastify schema validation: `required: ['message']`)

**Test 9: `'returns 400 when decoded base64 contains malformed JSON'`**

- Send POST with `message.data` = `Buffer.from('not json {{{').toString('base64')`
- Assert 400, error message `'Failed to decode PubSub message'`

Note: The `createFakeServices` in the test setup already registers handlers for all 7 types via `registerActionHandler`. Each handler's `execute` goes through the idempotent wrapper. For the routing tests, you need to save an action in `fakeActionRepository` matching the `actionId` in the event, with status `pending`, and the matching `type`.

### Files to Create

- None

### Files to Modify

- `apps/actions-agent/src/__tests__/internalRoutes.test.ts` — Add 8 test cases

### Test Requirements

- [ ] Test: `'routes research action type correctly'`
- [ ] Test: `'routes note action type correctly'`
- [ ] Test: `'routes link action type correctly'`
- [ ] Test: `'routes calendar action type correctly'`
- [ ] Test: `'routes linear action type correctly'`
- [ ] Test: `'routes code action type correctly'`
- [ ] Test: `'returns 400 when message field is missing from body'`
- [ ] Test: `'returns 400 when decoded base64 contains malformed JSON'`

### Acceptance Criteria

- [ ] All 8 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-1

### Context

`handleApprovalReply.ts` is 817 lines with 4 private functions (`handleButtonResponse`, `executeActionByType`, `executeRejection`, `handleCancelTaskButton`, `handleProceedToImplementationButton`) that should be extracted into separate files for maintainability.

### Pre-conditions

- [ ] Read `apps/actions-agent/src/domain/usecases/handleApprovalReply.ts` completely
- [ ] All existing tests in `apps/actions-agent/src/__tests__/usecases/handleApprovalReply.test.ts` pass

### Steps

1. **Create `apps/actions-agent/src/domain/usecases/approval/executeActionByType.ts`**
   - Move the `executeActionByType` function (lines 426-578) to this new file
   - Export signature: `export async function executeActionByType(action: Action, actionEventPublisher: ActionEventPublisher, logger: Logger, executeNoteAction?: ExecuteNoteActionUseCase, executeTodoAction?: ExecuteTodoActionUseCase, executeResearchAction?: ExecuteResearchActionUseCase, executeLinkAction?: ExecuteLinkActionUseCase, executeCalendarAction?: ExecuteCalendarActionUseCase, executeLinearAction?: ExecuteLinearActionUseCase, executeCodeAction?: ExecuteCodeActionUseCase): Promise<void>`
   - Add all necessary imports: `Result`, `Logger`, `getErrorMessage` from `@intexuraos/common-core`, `Action` from `../../models/action.js`, `ActionEventPublisher` from `../../ports/actionEventPublisher.js`, and all 7 `Execute*ActionUseCase` types

2. **Create `apps/actions-agent/src/domain/usecases/approval/executeRejection.ts`**
   - Move the `executeRejection` function (lines 583-658)
   - Export signature: `export async function executeRejection(action: Action, actionRepository: ActionRepository, reason: string, whatsappPublisher: WhatsAppSendPublisher, approvalMessageRepository: ApprovalMessageRepository, logger: Logger, isConvert?: boolean): Promise<Result<ApprovalReplyResult>>`
   - Import `ApprovalReplyResult` and `ApprovalIntent` from the main `handleApprovalReply.ts` (or define a shared types file)

3. **Create `apps/actions-agent/src/domain/usecases/approval/handleCancelTaskButton.ts`**
   - Move the `handleCancelTaskButton` function (lines 664-735)
   - Export it with its current signature

4. **Create `apps/actions-agent/src/domain/usecases/approval/handleProceedToImplementationButton.ts`**
   - Move the `handleProceedToImplementationButton` function (lines 741-816)
   - Export it with its current signature

5. **Create `apps/actions-agent/src/domain/usecases/approval/handleButtonResponse.ts`**
   - Move the `handleButtonResponse` function (lines 264-421)
   - It calls `executeActionByType` and `executeRejection`, so import from those new files
   - Export it

6. **Update `apps/actions-agent/src/domain/usecases/handleApprovalReply.ts`**
   - Remove all extracted functions
   - Add imports from the 5 new files
   - The main `createHandleApprovalReplyUseCase` function orchestrates by calling the imported functions
   - Keep the `ApprovalReplyResult`, `ApprovalIntent`, `HandleApprovalReplyDeps`, `ApprovalReplyInput`, and `HandleApprovalReplyUseCase` types in the main file (they're the public API)

7. **Shared types consideration**: The `ApprovalReplyResult` and `ApprovalIntent` types are used by `executeRejection` and `handleButtonResponse`. Either:
   - (a) Create `apps/actions-agent/src/domain/usecases/approval/types.ts` for shared types, or
   - (b) Import them from the main `handleApprovalReply.ts` (may cause circular dependency issues)
   - Preferred: option (a)

### Files to Create

- `apps/actions-agent/src/domain/usecases/approval/types.ts` — Shared types: `ApprovalReplyResult`, `ApprovalIntent`
- `apps/actions-agent/src/domain/usecases/approval/executeActionByType.ts` — Execute action by type after approval
- `apps/actions-agent/src/domain/usecases/approval/executeRejection.ts` — Rejection handling
- `apps/actions-agent/src/domain/usecases/approval/handleCancelTaskButton.ts` — Cancel task button handler
- `apps/actions-agent/src/domain/usecases/approval/handleProceedToImplementationButton.ts` — Proceed to implementation button handler
- `apps/actions-agent/src/domain/usecases/approval/handleButtonResponse.ts` — Button response dispatcher

### Files to Modify

- `apps/actions-agent/src/domain/usecases/handleApprovalReply.ts` — Remove 5 functions (~560 lines), add imports, re-export types from `./approval/types.js`

### Test Requirements

- [ ] No new tests needed; all existing tests in `handleApprovalReply.test.ts` must pass unchanged

### Acceptance Criteria

- [ ] `handleApprovalReply.ts` is reduced to ~260 lines (orchestrator only)
- [ ] Each extracted file is < 150 lines
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes
- [ ] No circular imports

---

## TASK: AA-2

### Context

All 7 `execute*Action` files share identical boilerplate: getById -> null check -> completed idempotency -> status validation -> update to processing -> call service -> handle failure -> update to completed -> send WhatsApp notification. This should be extracted into a shared template.

### Pre-conditions

- [ ] Read all 7 `execute*Action.ts` files to confirm the common pattern
- [ ] Note deviations: `executeLinkAction` has URL extraction logic; `executeCodeAction` has `approvalEventId` + `WORKER_UNAVAILABLE`/`DUPLICATE` handling; `executeCalendarAction` fetches preview; `executeResearchAction` has different valid statuses

### Steps

1. **Create `apps/actions-agent/src/domain/usecases/executeActionTemplate.ts`**

2. Define the template type:

   ```typescript
   export interface ExecuteActionConfig<TResult> {
     actionType: string;
     validStatuses: ActionStatus[];
     preparePayload: (action: Action) => Record<string, unknown>;
     callService: (
       action: Action,
       prepared: Record<string, unknown>
     ) => Promise<Result<ServiceFeedback>>;
     buildCompletionMessage?: (action: Action, response: ServiceFeedback) => string;
     buildResourceUrl?: (action: Action, response: ServiceFeedback) => string | undefined;
     onCompleted?: (action: Action, response: ServiceFeedback) => Promise<void>;
     correlationPrefix: string;
   }
   ```

3. Define the template function:

   ```typescript
   export function createExecuteActionTemplate<TResult>(
     deps: {
       actionRepository: ActionRepository;
       whatsappPublisher: WhatsAppSendPublisher;
       webAppUrl: string;
       logger: Logger;
     },
     config: ExecuteActionConfig<TResult>
   ): (actionId: string) => Promise<Result<ExecuteActionResult>>;
   ```

4. The template handles:
   - `getById` + null check -> `err('Action not found')`
   - `status === 'completed'` idempotency -> return existing result
   - Status validation against `config.validStatuses`
   - Update to `processing`
   - Call `config.callService`
   - Handle service error -> update to `failed`
   - Handle service `status === 'failed'` -> update to `failed`
   - Handle success -> update to `completed`
   - Send WhatsApp notification if `resourceUrl` exists
   - Return result

5. **Migrate one use case first as proof**: Migrate `executeNoteAction.ts` to use the template:

   ```typescript
   export function createExecuteNoteActionUseCase(deps: ExecuteNoteActionDeps): ExecuteNoteActionUseCase {
     return createExecuteActionTemplate(deps, {
       actionType: 'note',
       validStatuses: ['pending', 'awaiting_approval', 'failed'],
       preparePayload: (action) => { ... },
       callService: async (action, prepared) => deps.notesServiceClient.createNote({ ... }),
       correlationPrefix: 'note-complete',
     });
   }
   ```

6. **Do NOT migrate** `executeLinkAction` and `executeCodeAction` in this task -- they have too many deviations. Document them as "candidates for future migration" with a comment.

7. Migrate the remaining 4 (todo, research, linear, calendar) in the same pattern.

### Files to Create

- `apps/actions-agent/src/domain/usecases/executeActionTemplate.ts` — Template function (~100 lines)

### Files to Modify

- `apps/actions-agent/src/domain/usecases/executeNoteAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/executeTodoAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/executeResearchAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/executeLinearAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts` — Refactor to use template

### Test Requirements

- [ ] No new tests needed; all existing tests for all 7 execute\*Action must pass unchanged

### Acceptance Criteria

- [ ] 5 of 7 execute\*Action files use the template
- [ ] Each migrated file is < 50 lines (config + factory call)
- [ ] `executeLinkAction` and `executeCodeAction` remain unchanged
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-3

### Context

The PATCH `/actions/:actionId` handler in `publicRoutes.ts` (lines 210-252) directly calls `actionRepository.getById()`, `changeActionTypeUseCase()`, and `actionRepository.update()`. The business logic should be extracted to a use case, leaving the route as a thin adapter.

### Pre-conditions

- [ ] Read `apps/actions-agent/src/routes/publicRoutes.ts` lines 210-252
- [ ] Read `apps/actions-agent/src/domain/usecases/changeActionType.ts`
- [ ] Read `apps/actions-agent/src/services.ts` for the Services interface

### Steps

1. **Create `apps/actions-agent/src/domain/usecases/updateAction.ts`**

2. Define the interface:

   ```typescript
   export interface UpdateActionParams {
     actionId: string;
     userId: string;
     status?: 'processing' | 'rejected' | 'archived';
     type?: ActionType;
   }

   export interface UpdateActionDeps {
     actionRepository: ActionRepository;
     changeActionTypeUseCase: ChangeActionTypeUseCase;
     logger: Logger;
   }

   export type UpdateActionUseCase = (
     params: UpdateActionParams
   ) => Promise<Result<{ action: Action }, { code: ErrorCode; message: string }>>;
   ```

3. Implement `createUpdateActionUseCase(deps: UpdateActionDeps): UpdateActionUseCase`:
   - `getById(actionId)` -> if `action?.userId !== userId` -> return error `NOT_FOUND`
   - If `type !== undefined && type !== action.type` -> call `changeActionTypeUseCase` -> if error, return it -> update `action.type = type`
   - If `status !== undefined` -> update `action.status = status`, `action.updatedAt = new Date().toISOString()`, `await actionRepository.update(action)`
   - Return `ok({ action })`

4. **Update `apps/actions-agent/src/routes/publicRoutes.ts`**:
   - Replace lines 217-251 with a call to `services.updateActionUseCase({ actionId, userId: user.userId, status, type: newType })`
   - Handle the result: if `!result.ok`, call `reply.fail(result.error.code, result.error.message)`, else `reply.ok({ action: result.value.action })`

5. **Update `apps/actions-agent/src/services.ts`**:
   - Add `updateActionUseCase: UpdateActionUseCase` to the `Services` interface
   - Create it in `initServices()`: `const updateActionUseCase = createUpdateActionUseCase({ actionRepository, changeActionTypeUseCase, logger: createAppLogger({ name: 'updateAction' }) })`
   - Add to container

6. **Update `apps/actions-agent/src/__tests__/fakes.ts`**:
   - Add `updateActionUseCase` to `createFakeServices` (pass-through to existing logic or create a simple fake)

7. **Create `apps/actions-agent/src/__tests__/usecases/updateAction.test.ts`**:
   - Test all branches from the extracted logic
   - Use `FakeActionRepository` and mock `changeActionTypeUseCase`

### Files to Create

- `apps/actions-agent/src/domain/usecases/updateAction.ts` — Update action use case (~60 lines)
- `apps/actions-agent/src/__tests__/usecases/updateAction.test.ts` — Unit tests for the use case

### Files to Modify

- `apps/actions-agent/src/routes/publicRoutes.ts` — Replace PATCH handler body with use case call
- `apps/actions-agent/src/services.ts` — Add `updateActionUseCase` to Services interface and initialization
- `apps/actions-agent/src/__tests__/fakes.ts` — Add `updateActionUseCase` to `createFakeServices`

### Test Requirements

- [ ] Test: `'returns NOT_FOUND when action does not exist'`
- [ ] Test: `'returns NOT_FOUND when userId does not match'`
- [ ] Test: `'updates status only'`
- [ ] Test: `'updates type only'`
- [ ] Test: `'updates both status and type'`
- [ ] Test: `'returns error when changeActionTypeUseCase fails'`

### Acceptance Criteria

- [ ] PATCH handler is < 15 lines (thin adapter)
- [ ] All existing route tests pass unchanged
- [ ] New unit tests cover all use case branches
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-4

### Context

This task was described as "same scope as AA-3 -- may be combined." Since AA-3 already extracts the PATCH handler business logic into `updateAction` use case, AA-4 is **identical to AA-3 and should be combined**. No separate implementation needed.

### Pre-conditions

- [ ] AA-3 is completed

### Steps

1. Verify AA-3 is complete by confirming the PATCH handler in `publicRoutes.ts` is a thin adapter calling `updateActionUseCase`
2. No additional work needed

### Files to Create

- None (combined with AA-3)

### Files to Modify

- None (combined with AA-3)

### Test Requirements

- [ ] Same as AA-3

### Acceptance Criteria

- [ ] AA-3 is complete
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-5

### Context

All 7 `handle*Action` use cases share a common pattern: log incoming event -> check shouldAutoExecute -> if auto-execute, call execute\*Action -> if not, build WhatsApp message + buttons -> publish. This should be extracted into a factory/template.

### Pre-conditions

- [ ] Read all 7 `handle*Action.ts` files
- [ ] Note deviations: `handleCalendarAction` fetches a preview and formats a special message; `handleLinearAction` has no auto-execute; `handleCodeAction` has 3 buttons and special message format

### Steps

1. **Create `apps/actions-agent/src/domain/usecases/handleActionTemplate.ts`**

2. Define the template config:

   ```typescript
   export interface HandleActionConfig {
     actionType: ActionType;
     emoji: string;
     buildMessage: (event: ActionCreatedEvent, webAppUrl: string) => string;
     extraButtons?: (event: ActionCreatedEvent) => WhatsAppButton[];
     autoExecuteFn?: string; // key in deps for the execute*Action function
     preProcess?: (event: ActionCreatedEvent, deps: Record<string, unknown>) => Promise<void>;
   }
   ```

3. Define the template factory:

   ```typescript
   export function createHandleActionTemplate(
     config: HandleActionConfig,
     deps: {
       actionRepository: ActionRepository;
       whatsappPublisher: WhatsAppSendPublisher;
       webAppUrl: string;
       logger: Logger;
       executeAction?: (actionId: string) => Promise<Result<unknown>>;
     }
   ): { execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>> };
   ```

4. The template handles:
   - Logging incoming event
   - If `shouldAutoExecute(event) && executeAction !== undefined` -> auto-execute, return result
   - Build message using `config.buildMessage(event, deps.webAppUrl)`
   - Build buttons using `buildApprovalButtons({ actionId, extraButtons: config.extraButtons?.(event) })`
   - Publish WhatsApp message (best-effort)
   - Return `ok({ actionId })`

5. **Migrate simple handlers first**: note, todo, link, research (they follow the exact pattern)

   ```typescript
   // handleNoteAction.ts becomes:
   export function createHandleNoteActionUseCase(
     deps: HandleNoteActionDeps
   ): HandleNoteActionUseCase {
     return createHandleActionTemplate(
       {
         actionType: 'note',
         emoji: '📒',
         buildMessage: (event, webAppUrl) => {
           const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
           return `📒 New note ready for approval: "${event.title}"\n\nReview: ${actionLink}`;
         },
       },
       { ...deps, executeAction: deps.executeNoteAction }
     );
   }
   ```

6. **Handle deviations**:
   - `handleCalendarAction`: Uses `preProcess` to fetch preview and format message. Pass a custom `buildMessage` that takes the preview into account. The preview fetch can go in `preProcess`.
   - `handleLinearAction`: No `executeAction` dependency (always approval). Template handles this (if `executeAction === undefined`, skip auto-execute).
   - `handleCodeAction`: Custom message format (cost/time estimates, 3 buttons). Use `buildMessage` and `extraButtons` config.

### Files to Create

- `apps/actions-agent/src/domain/usecases/handleActionTemplate.ts` — Template (~70 lines)

### Files to Modify

- `apps/actions-agent/src/domain/usecases/handleNoteAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/handleTodoAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/handleLinkAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/handleResearchAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/handleLinearAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/handleCodeAction.ts` — Refactor to use template
- `apps/actions-agent/src/domain/usecases/handleCalendarAction.ts` — Refactor to use template (with `preProcess` for preview)

### Test Requirements

- [ ] No new tests needed; all existing tests for all 7 handle\*Action must pass unchanged

### Acceptance Criteria

- [ ] All 7 handle\*Action files use the template
- [ ] Each handler file is < 40 lines (config + factory call)
- [ ] Template file is < 80 lines
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-6

### Context

The `internalRoutes.ts` file has repeated auth detection + message decoding logic across 3 PubSub endpoints (`/internal/actions/:actionType`, `/internal/actions/process`, `/internal/actions/approval-reply`). The pattern is: check `from` header for `noreply@google.com` -> if PubSub, accept OIDC -> else validate `x-internal-auth` -> decode base64 message -> parse JSON.

### Pre-conditions

- [ ] Read `apps/actions-agent/src/routes/internalRoutes.ts` lines 260-306 (first occurrence), lines 442-479 (second), lines 682-719 (third)

### Steps

1. **Create `apps/actions-agent/src/routes/pubsubAuth.ts`**

2. Define:

   ```typescript
   import type { FastifyRequest, FastifyReply } from 'fastify';
   import { validateInternalAuth } from '@intexuraos/common-http';

   export async function validatePubSubOrInternalAuth(
     request: FastifyRequest,
     reply: FastifyReply
   ): Promise<boolean> {
     const fromHeader = request.headers.from;
     const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

     if (isPubSubPush) {
       request.log.info(
         { from: fromHeader, userAgent: request.headers['user-agent'] },
         'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
       );
       return true;
     }

     const authResult = validateInternalAuth(request);
     if (!authResult.valid) {
       request.log.warn({ reason: authResult.reason }, 'Internal auth failed');
       await reply.fail('UNAUTHORIZED', 'Internal auth failed');
       return false;
     }

     return true;
   }
   ```

3. **Create `apps/actions-agent/src/routes/decodePubSubMessage.ts`**

4. Define:

   ```typescript
   import type { FastifyRequest, FastifyReply } from 'fastify';

   interface PubSubMessage {
     message: { data: string; messageId: string; publishTime: string };
     subscription: string;
   }

   export function decodePubSubMessage<T>(request: FastifyRequest, reply: FastifyReply): T | null {
     const body = request.body as PubSubMessage;
     try {
       const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
       return JSON.parse(decoded) as T;
     } catch {
       request.log.error({ data: body.message.data }, 'Failed to decode PubSub message');
       void reply.fail('INVALID_REQUEST', 'Failed to decode PubSub message');
       return null;
     }
   }
   ```

5. **Update `apps/actions-agent/src/routes/internalRoutes.ts`**:
   - Import `validatePubSubOrInternalAuth` and `decodePubSubMessage`
   - Replace the 3 repeated auth blocks with `if (!(await validatePubSubOrInternalAuth(request, reply))) return;`
   - Replace the 3 repeated decode blocks with `const eventData = decodePubSubMessage<ActionCreatedEvent>(request, reply); if (eventData === null) return;`
   - Remove the `PubSubMessage` interface from `internalRoutes.ts` (now in `decodePubSubMessage.ts`)

### Files to Create

- `apps/actions-agent/src/routes/pubsubAuth.ts` — PubSub auth detection utility (~25 lines)
- `apps/actions-agent/src/routes/decodePubSubMessage.ts` — PubSub message decoding utility (~25 lines)

### Files to Modify

- `apps/actions-agent/src/routes/internalRoutes.ts` — Replace 3x auth blocks and 3x decode blocks with utility calls

### Test Requirements

- [ ] No new tests needed; all existing route tests must pass unchanged
- [ ] Optionally, unit tests for the utilities in `apps/actions-agent/src/__tests__/routes/pubsubAuth.test.ts` and `decodePubSubMessage.test.ts`

### Acceptance Criteria

- [ ] `internalRoutes.ts` is reduced by ~60 lines
- [ ] Auth + decode logic is DRY
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes

---

## TASK: AA-7

### Context

`linearAgentHttpClient.ts` creates a module-level logger using `createAppLogger` (line 25). This makes it impossible to inject a test logger and creates a hidden dependency. The logger should be accepted via config (it already has an optional `logger` field in `LinearAgentHttpClientConfig` at line 22).

### Pre-conditions

- [ ] Read `apps/actions-agent/src/infra/http/linearAgentHttpClient.ts`
- [ ] Read `apps/actions-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts`
- [ ] Read `apps/actions-agent/src/services.ts` line 255-259 (how the client is created)

### Steps

1. Open `apps/actions-agent/src/infra/http/linearAgentHttpClient.ts`

2. **Remove the module-level default logger** at line 25:

   ```typescript
   // DELETE this line:
   const defaultLogger = createAppLogger({
     name: 'linearAgentHttpClient',
   }) as unknown as HttpLogger;
   ```

3. **Make `logger` required** in `LinearAgentHttpClientConfig`:
   - Change line 22 from `logger?: HttpLogger` to `logger: HttpLogger`

4. **Update the factory function** at line 41:
   - Change `const logger = config.logger ?? defaultLogger;` to `const logger = config.logger;`

5. **Remove the import** of `createAppLogger` from `@intexuraos/infra-sentry` (line 8) since it's no longer used in this file.

6. **Update `apps/actions-agent/src/services.ts`** line 255-259:
   - The config already passes `logger`, so no change needed (it already has `logger: createAppLogger({ name: 'linearAgentClient' })`)

7. **Update test file** `apps/actions-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts`:
   - Ensure the test creates the client with a mock logger. If it currently doesn't pass `logger`, add it to the config.

### Files to Create

- None

### Files to Modify

- `apps/actions-agent/src/infra/http/linearAgentHttpClient.ts` — Make `logger` required, remove `defaultLogger` and `createAppLogger` import
- `apps/actions-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts` — Ensure `logger` is passed in test config (if not already)

### Test Requirements

- [ ] All existing tests pass (with logger now required in config)

### Acceptance Criteria

- [ ] `logger` is required in `LinearAgentHttpClientConfig` (no optional `?`)
- [ ] No module-level `createAppLogger` call in the file
- [ ] No `@intexuraos/infra-sentry` import in the file
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- actions-agent` passes
