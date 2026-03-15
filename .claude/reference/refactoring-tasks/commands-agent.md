# Refactoring Tasks — commands-agent

Now I have all the information needed. Let me produce the detailed instructions for each task.

---

## TASK: CA-COV-1 — Add tests for commandsRoutes.ts owner auth + status validation

### Context
The `commandsRoutes.ts` file has owner-check logic on lines 270 and 376 (DELETE and PATCH) where `command?.userId !== user.userId` returns NOT_FOUND, and status-based validation on lines 274-279 (deletable statuses) and line 380 (only classified can be archived). The existing routes test file covers some of these but misses cross-user deletion/patch, archived-status deletion, and externalId auto-generation.

### Pre-conditions
- [ ] Read `apps/commands-agent/src/routes/commandsRoutes.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/routes.test.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/fakes.ts` (already read)

### Steps
1. Open `apps/commands-agent/src/__tests__/routes.test.ts`.
2. Inside the existing `describe('DELETE /commands/:commandId (authenticated)')` block (starting at line 1244), add the following test cases after the existing tests (after line 1384):

   **Test 1: Cross-user deletion attempt returns 404**
   - Add a command with `userId: 'user-owner'` and `id: 'cmd-cross-user-del'`, status `'received'`.
   - Create an access token for a different user `'user-other'`.
   - Send `DELETE /commands/cmd-cross-user-del` with the other user's token.
   - Assert `response.statusCode` is `404`.
   - Assert the command still exists in the repository via `fakeCommandRepo.getById('cmd-cross-user-del')` — it should NOT be null.

   **Test 2: Archived status deletion attempt returns 400**
   - Add a command with `userId: 'user-archive-del'`, `id: 'cmd-archived'`, status `'archived'`.
   - Create an access token for `'user-archive-del'`.
   - Send `DELETE /commands/cmd-archived` with the token.
   - Assert `response.statusCode` is `400`.
   - Assert response body error message contains `'Cannot delete classified command'`.

3. Inside the existing `describe('PATCH /commands/:commandId (authenticated)')` block (starting at line 1386), add the following test case after the existing tests (after line 1483):

   **Test 3: Cross-user PATCH attempt returns 404**
   - Add a command with `userId: 'user-patch-owner'`, `id: 'cmd-cross-user-patch'`, status `'classified'`, with a classification object (type `'todo'`, confidence `0.9`, reasoning `'Test'`, promptVersion `'1.0.0'`, classifiedAt `'2025-01-01T12:00:01.000Z'`).
   - Create an access token for a different user `'user-patch-other'`.
   - Send `PATCH /commands/cmd-cross-user-patch` with the other user's token and body `{ status: 'archived' }`.
   - Assert `response.statusCode` is `404`.
   - Verify the command's status is still `'classified'` via `fakeCommandRepo.getById`.

4. Inside the existing `describe('POST /commands (create command)')` block (starting at line 711), add:

   **Test 4: Auto-generates externalId when not provided**
   - Create an access token for `'user-pwa-autoid'`.
   - Set API keys for `'user-pwa-autoid'` via `fakeUserServiceClient.setApiKeys`.
   - Set classifier result to a valid classification (type `'note'`, confidence `0.85`, title `'Auto ID Note'`, reasoning `'Test'`, promptVersion `'1.0.0'`).
   - Send `POST /commands` with body `{ text: 'Auto-generated ID test', source: 'pwa-shared' }` (no `externalId`).
   - Assert `response.statusCode` is `201`.
   - Assert `body.data.command.externalId` is defined (truthy).
   - Assert `body.data.command.sourceType` is `'pwa-shared'`.

   **Test 5: Uses client-provided externalId when given**
   - Create an access token for `'user-pwa-customid'`.
   - Set API keys for `'user-pwa-customid'`.
   - Set classifier result.
   - Send `POST /commands` with body `{ text: 'Custom ID test', source: 'pwa-shared', externalId: 'custom-ext-123' }`.
   - Assert `response.statusCode` is `201`.
   - Assert `body.data.command.externalId` is `'custom-ext-123'`.

### Files to Create
- None

### Files to Modify
- `apps/commands-agent/src/__tests__/routes.test.ts` — Add 5 new test cases in existing describe blocks as specified above.

### Test Requirements
- [ ] Test: `returns 404 when trying to delete another user's command` — verifies line 270 owner check in DELETE handler
- [ ] Test: `returns 400 when trying to delete archived command` — verifies line 275 status check catches `'archived'` status
- [ ] Test: `returns 404 when trying to archive another user's command` — verifies line 376 owner check in PATCH handler
- [ ] Test: `auto-generates externalId when not provided` — verifies line 179-180 auto-generation in POST handler
- [ ] Test: `uses client-provided externalId when given` — verifies line 179 conditional in POST handler

### Acceptance Criteria
- [ ] All 5 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes

---

## TASK: CA-COV-2 — Add tests for processCommand.ts existing command + exceptions

### Context
The `processCommand.ts` use-case has branches for: existing command with non-classified status returning early (lines 62-72), `userServiceClient.getLlmClient` failing (lines 93-108), the classifier `catch` block (lines 244-255), and the relationship between `actionId` being set only when action creation succeeds (line 225). The existing test file covers some paths but misses: existing failed command reprocessing skip, classifier exception with non-Error type, and verifying `actionId` is undefined when action creation fails.

### Pre-conditions
- [ ] Read `apps/commands-agent/src/domain/usecases/processCommand.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/usecases/processCommand.test.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/fakes.ts` (already read)

### Steps
1. Open `apps/commands-agent/src/__tests__/usecases/processCommand.test.ts`.

2. Inside the existing `describe('successful paths')` block (after the test at line 221 `'returns existing command without reprocessing'`), add:

   **Test 1: Returns existing failed command without reprocessing**
   - Add a command to `commandRepository` with `id: 'whatsapp_text:msg-failed-existing'`, `userId: 'user-test-failed-existing'`, `status: 'failed'`, `failureReason: 'Previous failure'`, and matching `sourceType`, `externalId`, `text`, `timestamp`, `createdAt`, `updatedAt` fields.
   - Execute the use case with `sourceType: 'whatsapp_text'`, `externalId: 'msg-failed-existing'`.
   - Assert `result.isNew` is `false`.
   - Assert `result.command.status` is `'failed'` (original status preserved).
   - Assert `result.command.failureReason` is `'Previous failure'`.
   - Assert no actions were created: `actionsAgentClient.getCreatedActions()` has length 0.
   - Assert no events were published: `eventPublisher.getPublishedEvents()` has length 0.

3. Inside the existing `describe('error paths')` block (after line 131), add:

   **Test 2: Marks command as pending_classification when getLlmClient fails**
   - Set `userServiceClient.setFailNext(true)` so `getLlmClient` returns an error.
   - Execute the use case.
   - Assert `result.isNew` is `true`.
   - Assert `result.command.status` is `'pending_classification'`.
   - Verify the command was saved to the repository (via `commandRepository.getById`) and has status `'pending_classification'`.
   - Assert no actions created, no events published.

   **Test 3: Marks command as failed when classifier throws non-Error value**
   - Modify `FakeClassifier` behavior: instead of using `setFailNext`, directly override the classifier's `classify` method to throw a string value: `throw 'string error';`. Do this by creating a local classifier object conforming to `Classifier` interface: `{ async classify() { throw 'string error'; } }`.
   - Create the use case with `classifierFactory: () => localClassifier`.
   - Set up `userServiceClient.setApiKeys(userId, { google: 'google-key' })` and `userServiceClient.setLlmClientResult(ok(createFakeLlmClient(classifier)))` so getLlmClient succeeds.
   - Execute the use case.
   - Assert `result.command.status` is `'failed'`.
   - Assert `result.command.failureReason` is `'string error'` (the `getErrorMessage` function extracts this from non-Error values).

   **Test 4: actionId is undefined when action creation fails**
   - Set up a valid user with API keys, set classifier to return a valid result, set `actionsAgentClient.setFailNext(true)`.
   - Execute the use case.
   - Assert `result.command.status` is `'failed'`.
   - Assert `result.command.actionId` is `undefined` — line 225 (`command.actionId = action.id`) is never reached when `actionResult.ok` is false.

4. To create "Test 3", you need to import `Classifier` type. Add to the import at the top of the file:
   - Add `import type { Classifier } from '../../domain/ports/classifier.js';`

### Files to Create
- None

### Files to Modify
- `apps/commands-agent/src/__tests__/usecases/processCommand.test.ts` — Add 4 new test cases and 1 import.

### Test Requirements
- [ ] Test: `returns existing failed command without reprocessing` — verifies lines 62-72 for failed status existing commands
- [ ] Test: `marks command as pending_classification when getLlmClient fails` — verifies lines 93-108 llm client fetch failure path
- [ ] Test: `marks command as failed when classifier throws non-Error value` — verifies lines 244-255 catch block with non-Error exception
- [ ] Test: `actionId is undefined when action creation fails` — verifies actionId is not set when line 151 condition triggers early return

### Acceptance Criteria
- [ ] All 4 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes

---

## TASK: CA-COV-3 — Add tests for retryPendingCommands.ts filtering + failures

### Context
The `retryPendingCommands.ts` use-case has branches for: the `listByStatus('pending_classification')` query (line 43), multiple skips accumulating the same reason key (line 66), action creation failure incrementing `failed` counter without updating command status (lines 92-101), event publish failure throwing (line 122 is not wrapped in try/catch — it will propagate to the catch block on line 147), and different exception types in the catch block (lines 147-160).

### Pre-conditions
- [ ] Read `apps/commands-agent/src/domain/usecases/retryPendingCommands.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/usecases/retryPendingCommands.test.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/fakes.ts` (already read)

### Steps
1. Open `apps/commands-agent/src/__tests__/usecases/retryPendingCommands.test.ts`.

2. After the last existing test (line 277), add the following test cases inside the main `describe('retryPendingCommands usecase')` block:

   **Test 1: Only queries commands with pending_classification status**
   - Add THREE commands to `commandRepository`:
     - `createCommand({ id: 'cmd-pending-1', status: 'pending_classification' })`
     - `createCommand({ id: 'cmd-received', status: 'received' })` — override status
     - `createCommand({ id: 'cmd-failed', status: 'failed' })` — override status
   - NOTE: The `createCommand` helper already sets `status: 'pending_classification'`, so for the `received` and `failed` commands, you must override the status explicitly.
   - Set up `userServiceClient.setApiKeys('user-456', { google: 'key' })` and a valid classifier result.
   - Execute the use case.
   - Assert `result.total` is `1` (only the `pending_classification` command was found).
   - Assert `result.processed` is `1`.

   **Test 2: Accumulates multiple skips with same reason key**
   - Add TWO commands with different user IDs: `createCommand({ id: 'cmd-skip-1', userId: 'user-no-key-1' })` and `createCommand({ id: 'cmd-skip-2', userId: 'user-no-key-2' })`.
   - Do NOT set API keys for either user (so `getLlmClient` will return error for both).
   - Execute the use case.
   - Assert `result.skipped` is `2`.
   - Assert `result.skipReasons` equals `{ llm_client_fetch_failed: 2 }`.

   **Test 3: Action creation failure increments failed counter and continues to next command**
   - Add TWO commands: `createCommand({ id: 'cmd-action-fail', userId: 'user-af-1' })` and `createCommand({ id: 'cmd-action-ok', userId: 'user-af-2' })`.
   - Set API keys for both users.
   - Set classifier to return a valid result.
   - Call `actionsAgentClient.setFailNext(true)` so the FIRST action creation fails, and the second succeeds.
   - Execute the use case.
   - Assert `result.failed` is `1`.
   - Assert `result.processed` is `1`.
   - Verify the first command's status is still `'pending_classification'` (action failure does NOT update command status in `retryPendingCommands` — it just increments `failed` and `continue`s on line 101).
   - Verify the second command's status is `'classified'`.

   **Test 4: Event publish failure propagates to catch block and marks command as failed**
   - Add ONE command: `createCommand({ id: 'cmd-pub-fail', userId: 'user-pub-fail' })`.
   - Set API keys for the user, set a valid classifier result.
   - Note: Looking at `retryPendingCommands.ts` line 122, `eventPublisher.publishActionCreated(event)` is called with `await` but NOT wrapped in an error check — the result is NOT checked for `!result.ok`. The `FakeEventPublisher` returns `err(...)` when `failNext` is true, which does NOT throw. So the event publish failure is silently ignored in `retryPendingCommands.ts` (unlike `processCommand.ts` which explicitly checks `!publishResult.ok`).
   - Actually, re-reading line 122: `await eventPublisher.publishActionCreated(event);` — the return value is NOT checked at all. It's fire-and-forget. When `FakeEventPublisher.setFailNext(true)`, it returns `err(...)` but does not throw. So the command still gets classified.
   - Set `eventPublisher.setFailNext(true)`.
   - Execute the use case.
   - Assert `result.processed` is `1` (command still succeeds despite publish failure).
   - Assert `eventPublisher.getPublishedEvents()` has length `0`.
   - Verify the command is `'classified'` status.

   **Test 5: Classifier throw with non-Error type sets failureReason correctly**
   - Add ONE command: `createCommand({ id: 'cmd-nonerror', userId: 'user-nonerror' })`.
   - Set API keys for the user.
   - Create a local classifier object: `const throwingClassifier = { async classify() { throw 42; } }`.
   - Create the use case with `classifierFactory: () => throwingClassifier as any`.
   - Execute the use case.
   - Assert `result.failed` is `1`.
   - Verify the command's `failureReason` via `commandRepository.getById('cmd-nonerror')` — `getErrorMessage(42, 'Unknown classification error during retry')` returns `'Unknown classification error during retry'` because `42` is not an Error and not a string.
   - Assert `updatedCommand?.failureReason` is `'Unknown classification error during retry'`.
   - Assert `updatedCommand?.status` is `'failed'`.

3. For Test 5, you need to import `Classifier` type. Check if it is already imported — it is not. Add to the imports at the top of the file:
   - Add `import type { Classifier } from '../../domain/ports/classifier.js';`

### Files to Create
- None

### Files to Modify
- `apps/commands-agent/src/__tests__/usecases/retryPendingCommands.test.ts` — Add 5 new test cases and 1 import.

### Test Requirements
- [ ] Test: `only queries commands with pending_classification status` — verifies line 43 filter
- [ ] Test: `accumulates multiple skips with same reason key` — verifies line 66 counter increment
- [ ] Test: `action creation failure increments failed counter and continues` — verifies lines 92-101 continue behavior
- [ ] Test: `event publish failure is silently ignored and command still classified` — verifies line 122 fire-and-forget pattern
- [ ] Test: `classifier throw with non-Error type sets failureReason correctly` — verifies lines 147-158 catch block with non-Error

### Acceptance Criteria
- [ ] All 5 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes

---

## TASK: CA-1 — Move repository calls from commandsRoutes.ts to use-cases

### Context
The `commandsRoutes.ts` route handlers directly call `commandRepository.listByUserId`, `commandRepository.getById`, `commandRepository.delete`, and `commandRepository.update` for the GET, DELETE, and PATCH endpoints. These should be moved into domain use-cases to follow the same pattern as `processCommand` and `retryPendingCommands`.

### Pre-conditions
- [ ] Read `apps/commands-agent/src/routes/commandsRoutes.ts` (already read)
- [ ] Read `apps/commands-agent/src/services.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/fakes.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/routes.test.ts` (already read)
- [ ] Verify all existing tests pass before making changes

### Steps

#### Step 1: Create `listCommands` use-case
1. Create file `apps/commands-agent/src/domain/usecases/listCommands.ts`.
2. Define the interface and factory:
   ```
   export interface ListCommandsResult { commands: Command[] }
   export interface ListCommandsUseCase {
     execute(userId: string): Promise<ListCommandsResult>;
   }
   export function createListCommandsUseCase(deps: {
     commandRepository: CommandRepository;
     logger: Logger;
   }): ListCommandsUseCase
   ```
3. Implementation: call `deps.commandRepository.listByUserId(userId)` and return `{ commands }`.

#### Step 2: Create `deleteCommand` use-case
1. Create file `apps/commands-agent/src/domain/usecases/deleteCommand.ts`.
2. Define:
   ```
   export type DeleteCommandResult =
     | { success: true }
     | { success: false; error: 'NOT_FOUND' | 'INVALID_STATUS'; message: string }
   export interface DeleteCommandUseCase {
     execute(commandId: string, userId: string): Promise<DeleteCommandResult>;
   }
   export function createDeleteCommandUseCase(deps: {
     commandRepository: CommandRepository;
     logger: Logger;
   }): DeleteCommandUseCase
   ```
3. Implementation:
   - Call `commandRepository.getById(commandId)`.
   - If `command?.userId !== userId`, return `{ success: false, error: 'NOT_FOUND', message: 'Command not found' }`.
   - Define `const deletableStatuses = ['received', 'pending_classification', 'failed']`.
   - If `!deletableStatuses.includes(command.status)`, return `{ success: false, error: 'INVALID_STATUS', message: 'Cannot delete classified command. Use archive instead.' }`.
   - Call `await commandRepository.delete(commandId)`.
   - Return `{ success: true }`.

#### Step 3: Create `archiveCommand` use-case
1. Create file `apps/commands-agent/src/domain/usecases/archiveCommand.ts`.
2. Define:
   ```
   export type ArchiveCommandResult =
     | { success: true; command: Command }
     | { success: false; error: 'NOT_FOUND' | 'INVALID_STATUS'; message: string }
   export interface ArchiveCommandUseCase {
     execute(commandId: string, userId: string): Promise<ArchiveCommandResult>;
   }
   export function createArchiveCommandUseCase(deps: {
     commandRepository: CommandRepository;
     logger: Logger;
   }): ArchiveCommandUseCase
   ```
3. Implementation:
   - Call `commandRepository.getById(commandId)`.
   - If `command?.userId !== userId`, return `{ success: false, error: 'NOT_FOUND', message: 'Command not found' }`.
   - If `command.status !== 'classified'`, return `{ success: false, error: 'INVALID_STATUS', message: 'Can only archive classified commands' }`.
   - Set `command.status = 'archived'` and `command.updatedAt = new Date().toISOString()`.
   - Call `await commandRepository.update(command)`.
   - Return `{ success: true, command }`.

#### Step 4: Register use-cases in services.ts
1. In `apps/commands-agent/src/services.ts`:
   - Import `createListCommandsUseCase`, `createDeleteCommandUseCase`, `createArchiveCommandUseCase` and their types.
   - Add to the `Services` interface: `listCommandsUseCase: ListCommandsUseCase`, `deleteCommandUseCase: DeleteCommandUseCase`, `archiveCommandUseCase: ArchiveCommandUseCase`.
   - In `initServices()`, create each use-case and add to the `container` object.

#### Step 5: Update commandsRoutes.ts
1. In the GET `/commands` handler (lines 100-103):
   - Replace `const { commandRepository } = getServices();` and `commandRepository.listByUserId(user.userId)` with:
   - `const { listCommandsUseCase } = getServices();` and `const result = await listCommandsUseCase.execute(user.userId);` then `return await reply.ok({ commands: result.commands });`.

2. In the DELETE `/commands/:commandId` handler (lines 267-284):
   - Replace the entire repository interaction block with:
   - `const { deleteCommandUseCase } = getServices();`
   - `const result = await deleteCommandUseCase.execute(commandId, user.userId);`
   - If `!result.success`, map `result.error` to `reply.fail(result.error === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST', result.message)`.
   - If success, `return await reply.ok({})`.

3. In the PATCH `/commands/:commandId` handler (lines 373-388):
   - Replace the entire repository interaction block with:
   - `const { archiveCommandUseCase } = getServices();`
   - `const result = await archiveCommandUseCase.execute(commandId, user.userId);`
   - If `!result.success`, map `result.error` to `reply.fail(result.error === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST', result.message)`.
   - If success, `return await reply.ok({ command: result.command })`.

#### Step 6: Update fakes.ts and test setup
1. In `apps/commands-agent/src/__tests__/fakes.ts`, update `createFakeServices` to also create the three new use-cases using their factory functions, passing `commandRepository` and the test `logger`.
2. The `Services` interface change will require all `createFakeServices` calls to include the new fields.

#### Step 7: Write unit tests for each new use-case
1. Create `apps/commands-agent/src/__tests__/usecases/listCommands.test.ts` — test: returns empty when no commands for user, returns commands for matching user.
2. Create `apps/commands-agent/src/__tests__/usecases/deleteCommand.test.ts` — test: NOT_FOUND for missing command, NOT_FOUND for wrong user, INVALID_STATUS for classified/archived, success for received/pending_classification/failed.
3. Create `apps/commands-agent/src/__tests__/usecases/archiveCommand.test.ts` — test: NOT_FOUND for missing command, NOT_FOUND for wrong user, INVALID_STATUS for non-classified command, success for classified command.

### Files to Create
- `apps/commands-agent/src/domain/usecases/listCommands.ts` — listCommands use-case
- `apps/commands-agent/src/domain/usecases/deleteCommand.ts` — deleteCommand use-case
- `apps/commands-agent/src/domain/usecases/archiveCommand.ts` — archiveCommand use-case
- `apps/commands-agent/src/__tests__/usecases/listCommands.test.ts` — unit tests
- `apps/commands-agent/src/__tests__/usecases/deleteCommand.test.ts` — unit tests
- `apps/commands-agent/src/__tests__/usecases/archiveCommand.test.ts` — unit tests

### Files to Modify
- `apps/commands-agent/src/services.ts` — Add 3 use-cases to interface and initialization
- `apps/commands-agent/src/routes/commandsRoutes.ts` — Replace direct repo calls with use-case calls
- `apps/commands-agent/src/__tests__/fakes.ts` — Add new use-cases to `createFakeServices`

### Test Requirements
- [ ] Test: `listCommands.test.ts` — verifies list use-case returns correct commands per user
- [ ] Test: `deleteCommand.test.ts` — verifies owner check, status check, successful delete
- [ ] Test: `archiveCommand.test.ts` — verifies owner check, status check, successful archive

### Acceptance Criteria
- [ ] Route handlers no longer import or call `commandRepository` directly (only use-cases)
- [ ] All existing route tests pass unchanged (behavior is identical)
- [ ] All new use-case unit tests pass
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes

---

## TASK: CA-2 — Extract PubSub handling from internalRoutes.ts

### Context
The `internalRoutes.ts` file (357 lines) contains inline PubSub types (`PubSubMessage`, `CommandEvent`), inline auth logic for dual OIDC/internal-auth, and inline base64 message decoding. These cross-cutting concerns should be extracted to dedicated files.

### Pre-conditions
- [ ] Read `apps/commands-agent/src/routes/internalRoutes.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/routes.test.ts` (already read)
- [ ] Verify all existing tests pass before making changes

### Steps

#### Step 1: Extract types to domain
1. Create file `apps/commands-agent/src/domain/events/commandEvent.ts`.
2. Move the `CommandEvent` interface (lines 15-23 of `internalRoutes.ts`) into this new file:
   ```typescript
   import type { CommandSourceType } from '../models/command.js';
   export interface CommandEvent {
     type: 'command.ingest';
     userId: string;
     sourceType: CommandSourceType;
     externalId: string;
     text: string;
     summary?: string;
     timestamp: string;
   }
   ```

#### Step 2: Extract PubSub message type
1. Create file `apps/commands-agent/src/infra/pubsub/types.ts`.
2. Move the `PubSubMessage` interface (lines 6-13 of `internalRoutes.ts`) into this file:
   ```typescript
   export interface PubSubMessage {
     message: {
       data: string;
       messageId: string;
       publishTime: string;
     };
     subscription: string;
   }
   ```

#### Step 3: Extract PubSub message decoder
1. Create file `apps/commands-agent/src/infra/pubsub/decoder.ts`.
2. Create a `decodePubSubMessage<T>` function:
   ```typescript
   import type { Result } from '@intexuraos/common-core';
   import { ok, err } from '@intexuraos/common-core';
   export function decodePubSubMessage<T>(data: string): Result<T, { message: string }> {
     try {
       const decoded = Buffer.from(data, 'base64').toString('utf-8');
       return ok(JSON.parse(decoded) as T);
     } catch {
       return err({ message: 'Failed to decode PubSub message' });
     }
   }
   ```

#### Step 4: Extract internal auth helper
1. Create file `apps/commands-agent/src/routes/helpers/internalAuth.ts`.
2. Create a function that encapsulates the dual auth pattern used in both `/internal/commands` and `/internal/retry-pending`:
   ```typescript
   import type { FastifyRequest, FastifyReply } from 'fastify';
   import { validateInternalAuth } from '@intexuraos/common-http';
   
   export type InternalAuthStrategy = 'pubsub-oidc' | 'scheduler-oidc' | 'internal-token';
   
   export function authenticateInternalPubSub(request: FastifyRequest, reply: FastifyReply): 
     { authenticated: true; strategy: InternalAuthStrategy } | { authenticated: false } 
   ```
   - Check `from: noreply@google.com` header for PubSub OIDC.
   - Otherwise, validate `x-internal-auth` header.
   - Return the result (do not send reply — let the caller handle the 401).

   Similarly, create `authenticateInternalScheduler` for the scheduler pattern (Bearer OIDC or x-internal-auth).

#### Step 5: Update internalRoutes.ts
1. Replace inline `PubSubMessage` import with import from `../infra/pubsub/types.js`.
2. Replace inline `CommandEvent` import with import from `../domain/events/commandEvent.js`.
3. Replace the try/catch base64 decode block (lines 131-138) with a call to `decodePubSubMessage<CommandEvent>(body.message.data)`, checking the result.
4. Replace the inline auth blocks in both handlers with calls to the auth helpers.
5. Remove the now-unused inline type definitions.

#### Step 6: Update pubsub/index.ts barrel export
1. Add re-exports for `PubSubMessage` from `./types.js` and `decodePubSubMessage` from `./decoder.js`.

### Files to Create
- `apps/commands-agent/src/domain/events/commandEvent.ts` — CommandEvent type
- `apps/commands-agent/src/infra/pubsub/types.ts` — PubSubMessage type
- `apps/commands-agent/src/infra/pubsub/decoder.ts` — base64 decode helper
- `apps/commands-agent/src/routes/helpers/internalAuth.ts` — dual auth helpers

### Files to Modify
- `apps/commands-agent/src/routes/internalRoutes.ts` — Replace inline code with imports of extracted modules
- `apps/commands-agent/src/infra/pubsub/index.ts` — Add new exports

### Test Requirements
- [ ] Test: Create `apps/commands-agent/src/__tests__/infra/pubsub/decoder.test.ts` — test valid base64, invalid base64, invalid JSON
- [ ] Test: All existing route integration tests pass unchanged (behavior is identical)

### Acceptance Criteria
- [ ] `PubSubMessage` and `CommandEvent` types no longer defined inline in `internalRoutes.ts`
- [ ] Base64 decoding logic extracted to a reusable function
- [ ] Auth logic extracted to reusable helpers
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes

---

## TASK: CA-3 — Decompose processCommand.ts use-case

### Context
The `processCommand.ts` file (260 lines) is a single monolithic function that handles classification, action creation, event publishing, and command status updates. These distinct responsibilities should be extracted into helper functions for readability and testability.

### Pre-conditions
- [ ] Read `apps/commands-agent/src/domain/usecases/processCommand.ts` (already read)
- [ ] Read `apps/commands-agent/src/__tests__/usecases/processCommand.test.ts` (already read)
- [ ] Verify all existing tests pass before making changes

### Steps

#### Step 1: Extract classification helper
1. Within the same file `apps/commands-agent/src/domain/usecases/processCommand.ts`, create a private helper function ABOVE the `createProcessCommandUseCase` export:
   ```typescript
   async function classifyCommand(deps: {
     classifierFactory: ClassifierFactory;
     llmClient: LlmGenerateClient;
     text: string;
     sourceType: CommandSourceType;
     logger: Logger;
   }): Promise<ClassificationResult> {
     const classifier = deps.classifierFactory(deps.llmClient, deps.logger);
     return await classifier.classify(deps.text, { sourceType: deps.sourceType });
   }
   ```
2. Import `LlmGenerateClient` type and `ClassificationResult` type if not already imported.
3. In the main use-case, replace lines 117-118 with a call to `classifyCommand(...)`.

#### Step 2: Extract action creation helper
1. Create another private helper:
   ```typescript
   async function createActionFromClassification(deps: {
     actionsAgentClient: ActionsAgentClient;
     userId: string;
     commandId: string;
     classification: ClassificationResult;
     text: string;
     summary?: string;
     logger: Logger;
   }): Promise<Result<Action>> {
     return await deps.actionsAgentClient.createAction({
       userId: deps.userId,
       commandId: deps.commandId,
       type: deps.classification.type,
       confidence: deps.classification.confidence,
       title: deps.classification.title,
       payload: {
         prompt: deps.text,
         ...(deps.summary !== undefined && { summary: deps.summary }),
       },
     });
   }
   ```
2. In the main use-case, replace lines 139-149 with a call to `createActionFromClassification(...)`.

#### Step 3: Extract event building + publishing helper
1. Create another private helper:
   ```typescript
   async function publishActionEvent(deps: {
     eventPublisher: EventPublisherPort;
     action: Action;
     userId: string;
     commandId: string;
     classification: ClassificationResult;
     text: string;
     summary?: string;
     logger: Logger;
   }): Promise<void> {
     // Build event payload (lines 172-189)
     // Publish (line 200)
     // Log result (lines 202-216)
   }
   ```
2. Move lines 172-216 into this helper.
3. Call it from the main use-case.

#### Step 4: Extract command finalization helper
1. Create another private helper:
   ```typescript
   function finalizeClassifiedCommand(
     command: Command,
     classification: ClassificationResult,
     actionId: string
   ): void {
     command.classification = {
       type: classification.type,
       confidence: classification.confidence,
       reasoning: classification.reasoning,
       promptVersion: classification.promptVersion,
       classifiedAt: new Date().toISOString(),
     };
     command.actionId = actionId;
     command.status = 'classified';
   }
   ```
2. Replace lines 218-226 with a call to this helper.

### Files to Create
- None (all helpers stay within the same file)

### Files to Modify
- `apps/commands-agent/src/domain/usecases/processCommand.ts` — Extract 4 helper functions, reduce main `execute` body

### Test Requirements
- [ ] All existing `processCommand.test.ts` tests pass unchanged
- [ ] All existing `routes.test.ts` tests pass unchanged

### Acceptance Criteria
- [ ] The `execute` method body is reduced to ~50-60 lines (from ~210 lines)
- [ ] Each helper has a clear, single responsibility
- [ ] No public API change — `ProcessCommandUseCase` interface unchanged
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes

---

## TASK: CA-4 — Deduplicate retryPendingCommands.ts with processCommand

### Context
`retryPendingCommands.ts` (lines 70-160) duplicates classification, action creation, event publishing, and command finalization logic from `processCommand.ts`. After CA-3 extracts helpers in processCommand.ts, retryPendingCommands should call those same helpers.

### Pre-conditions
- [ ] **CA-3 must be completed first** — the helper functions must exist
- [ ] Read `apps/commands-agent/src/domain/usecases/retryPendingCommands.ts` (already read)
- [ ] Read `apps/commands-agent/src/domain/usecases/processCommand.ts` (post CA-3 version)
- [ ] Verify all existing tests pass before making changes

### Steps

#### Step 1: Export the helpers from processCommand.ts
1. The four helper functions created in CA-3 (`classifyCommand`, `createActionFromClassification`, `publishActionEvent`, `finalizeClassifiedCommand`) are currently file-private. Export them with an `export` keyword.

#### Step 2: Refactor retryPendingCommands.ts to use shared helpers
1. Import the four helpers from `./processCommand.js`.
2. Replace the duplicated classification logic (lines 71-72) with `classifyCommand(...)`.
3. Replace the duplicated action creation logic (lines 83-89) with `createActionFromClassification(...)`.
4. Replace the duplicated event building and publishing (lines 106-122) with `publishActionEvent(...)`.
5. Replace the duplicated command finalization (lines 131-138) with `finalizeClassifiedCommand(command, classification, action.id)`.
6. Keep the retry-specific logic: the `for` loop, the `skipped`/`failed`/`processed` counters, the `skipReasons` tracking, and the `try/catch` wrapper.

#### Step 3: Verify behavior is identical
1. The `retryPendingCommands` use-case has one behavioral difference from `processCommand`: it does NOT pass `sourceType` to `classifier.classify()` (line 72 calls `classifier.classify(command.text)` with no options). The shared `classifyCommand` helper takes `sourceType` as a parameter. Pass `command.sourceType` to maintain parity, OR verify the existing test expectations still hold. Since `retryPendingCommands` currently doesn't pass sourceType, to avoid behavior change, make the `sourceType` parameter optional in `classifyCommand` and pass `undefined` from retry.
   - Actually, looking more carefully: `retryPendingCommands` line 72: `classifier.classify(command.text)` — no options object. In `processCommand` line 118: `classifier.classify(input.text, { sourceType: input.sourceType })`. The `classifyCommand` helper should accept an optional `sourceType`. When called from retry, pass `undefined`.

### Files to Create
- None

### Files to Modify
- `apps/commands-agent/src/domain/usecases/processCommand.ts` — Export the 4 helper functions
- `apps/commands-agent/src/domain/usecases/retryPendingCommands.ts` — Replace duplicated code with imported helpers

### Test Requirements
- [ ] All existing `retryPendingCommands.test.ts` tests pass unchanged
- [ ] All existing `processCommand.test.ts` tests pass unchanged
- [ ] All existing `routes.test.ts` tests pass unchanged

### Acceptance Criteria
- [ ] `retryPendingCommands.ts` no longer contains duplicated classification/action/event/finalization code
- [ ] Both use-cases share the same helper functions
- [ ] No behavior change — all test assertions pass identically
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes

---

## TASK: CA-5 — Define domain ports for infrastructure clients

### Context
The `processCommand.ts` use-case imports `UserServiceClient` from `@intexuraos/internal-clients` (line 9) and `ActionsAgentClient` from `../ports/actionsAgentClient.js` (line 10). The `UserServiceClient` import comes from an infrastructure package, violating the hexagonal architecture pattern. A domain port should be defined for the user-service dependency.

### Pre-conditions
- [ ] Read `apps/commands-agent/src/domain/usecases/processCommand.ts` (already read — lines 9-10)
- [ ] Read `apps/commands-agent/src/domain/ports/actionsAgentClient.ts` (already read — already a proper port)
- [ ] Read `apps/commands-agent/src/__tests__/fakes.ts` lines 148-207 to understand `FakeUserServiceClient`
- [ ] Verify the `UserServiceClient` interface exported by `@intexuraos/internal-clients`

### Steps

#### Step 1: Identify the subset of UserServiceClient used by commands-agent
1. Search for all uses of `userServiceClient` in the commands-agent codebase.
2. In `processCommand.ts` line 93: `userServiceClient.getLlmClient(input.userId)` — only `getLlmClient` is used.
3. In `retryPendingCommands.ts` line 58: `userServiceClient.getLlmClient(command.userId)` — only `getLlmClient` is used.
4. So the domain port only needs the `getLlmClient` method.

#### Step 2: Create the domain port
1. Create file `apps/commands-agent/src/domain/ports/userServicePort.ts`:
   ```typescript
   import type { Result } from '@intexuraos/common-core';
   import type { LlmGenerateClient } from '@intexuraos/llm-factory';

   export interface UserServiceError {
     code: string;
     message: string;
   }

   export interface UserServicePort {
     getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
   }
   ```

#### Step 3: Update use-case deps to use the port
1. In `apps/commands-agent/src/domain/usecases/processCommand.ts`:
   - Change the import on line 9 from `import type { UserServiceClient } from '@intexuraos/internal-clients';` to `import type { UserServicePort } from '../ports/userServicePort.js';`.
   - Change the deps type from `userServiceClient: UserServiceClient` to `userServiceClient: UserServicePort`.

2. In `apps/commands-agent/src/domain/usecases/retryPendingCommands.ts`:
   - Same change: replace `import type { UserServiceClient } from '@intexuraos/internal-clients';` with `import type { UserServicePort } from '../ports/userServicePort.js';`.
   - Change deps type from `userServiceClient: UserServiceClient` to `userServiceClient: UserServicePort`.

#### Step 4: Ensure services.ts still works
1. In `apps/commands-agent/src/services.ts`, the `Services` interface has `userServiceClient: UserServiceClient` from `@intexuraos/internal-clients`. This is the INFRA layer, which is correct — services.ts is the composition root. No change needed here because `UserServiceClient` (infra) implements the `UserServicePort` (domain) interface structurally (TypeScript structural typing). Verify this compiles.

#### Step 5: Update fakes.ts
1. In `apps/commands-agent/src/__tests__/fakes.ts`, `FakeUserServiceClient` implements `UserServiceClient` from `@intexuraos/internal-clients`. Since `services.ts` still uses `UserServiceClient`, the fake must still implement the full interface. No change needed.

### Files to Create
- `apps/commands-agent/src/domain/ports/userServicePort.ts` — domain port for user service dependency

### Files to Modify
- `apps/commands-agent/src/domain/usecases/processCommand.ts` — Change import + deps type to use domain port
- `apps/commands-agent/src/domain/usecases/retryPendingCommands.ts` — Change import + deps type to use domain port

### Test Requirements
- [ ] All existing tests pass unchanged (structural typing ensures compatibility)

### Acceptance Criteria
- [ ] Domain use-cases no longer import from `@intexuraos/internal-clients`
- [ ] Domain port defines the minimal interface needed
- [ ] Composition root (`services.ts`) still uses the concrete infra type
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes

---

## TASK: CA-6 — Extract inline schemas from commandsRoutes.ts

### Context
The `commandsRoutes.ts` file defines a large inline `commandSchema` object (lines 5-47) at the top of the file, mixed with route logic. This schema definition should be extracted to a dedicated schemas file for reusability and separation of concerns.

### Pre-conditions
- [ ] Read `apps/commands-agent/src/routes/commandsRoutes.ts` lines 5-47 (already read)
- [ ] Verify all existing tests pass before making changes

### Steps

#### Step 1: Create schemas file
1. Create file `apps/commands-agent/src/routes/schemas/commandSchemas.ts`.
2. Move the `commandSchema` constant (lines 5-47 of `commandsRoutes.ts`) into this file:
   ```typescript
   export const commandSchema = {
     type: 'object',
     properties: {
       id: { type: 'string' },
       userId: { type: 'string' },
       sourceType: { type: 'string', enum: ['whatsapp_text', 'whatsapp_voice', 'pwa-shared'] },
       externalId: { type: 'string' },
       text: { type: 'string' },
       timestamp: { type: 'string', format: 'date-time' },
       status: {
         type: 'string',
         enum: ['received', 'classified', 'pending_classification', 'failed', 'archived'],
       },
       classification: {
         type: 'object',
         nullable: true,
         properties: {
           type: {
             type: 'string',
             enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder', 'linear', 'code'],
           },
           confidence: { type: 'number' },
           reasoning: { type: 'string' },
           promptVersion: { type: 'string' },
           classifiedAt: { type: 'string', format: 'date-time' },
         },
       },
       actionId: { type: 'string', nullable: true },
       createdAt: { type: 'string', format: 'date-time' },
       updatedAt: { type: 'string', format: 'date-time' },
     },
     required: [
       'id',
       'userId',
       'sourceType',
       'externalId',
       'text',
       'timestamp',
       'status',
       'createdAt',
       'updatedAt',
     ],
   } as const;
   ```

#### Step 2: Create barrel export
1. Create file `apps/commands-agent/src/routes/schemas/index.ts`:
   ```typescript
   export { commandSchema } from './commandSchemas.js';
   ```

#### Step 3: Update commandsRoutes.ts
1. Remove lines 5-47 (the `commandSchema` definition).
2. Add import at the top: `import { commandSchema } from './schemas/index.js';`.
3. Verify the `commandSchema` is referenced in exactly 3 places within the route definitions: line 69 (GET response), line 133 (POST response), line 319 (PATCH response). All three references should still work with the import.

### Files to Create
- `apps/commands-agent/src/routes/schemas/commandSchemas.ts` — extracted command schema
- `apps/commands-agent/src/routes/schemas/index.ts` — barrel export

### Files to Modify
- `apps/commands-agent/src/routes/commandsRoutes.ts` — Remove inline schema, add import from schemas module

### Test Requirements
- [ ] All existing route tests pass unchanged (schema is identical, just moved)

### Acceptance Criteria
- [ ] `commandSchema` no longer defined inline in `commandsRoutes.ts`
- [ ] Schema is importable from `./schemas/index.js`
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- commands-agent` passes
