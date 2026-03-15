# Refactoring Tasks — whatsapp-service

The tests pass (the 1 failure is in web app, not whatsapp-service). Now I have comprehensive understanding of all the source and test files. Let me produce the detailed task instructions.

---

## TASK: WS-COV-1 — Add tests for GET /webhooks verification + sendCtaUrlMessage

### Context

The GET `/whatsapp/webhooks` verification handler (lines 46-113 of `webhookRoutes.ts`) is tested in `webhookVerification.test.ts` (which I haven't read yet but exists) and possibly `verificationRoutes.test.ts`. The `sendCtaUrlMessage` method (lines 193-273 of `sender.ts`) is entirely wrapped in `/* v8 ignore start */` because tests use fake sender. However, there ARE already tests for `sendTextMessage` and `sendInteractiveMessage` in `sender.test.ts`. The `sendCtaUrlMessage` is structurally identical but currently excluded from coverage.

### Pre-conditions

- [ ] Read `src/__tests__/webhookVerification.test.ts` and `src/__tests__/verificationRoutes.test.ts` to understand what GET /whatsapp/webhooks tests already exist
- [ ] Run `pnpm run verify:workspace:tracked whatsapp-service` and confirm current tests pass

### Steps

**For sendCtaUrlMessage tests:**

1. Open `apps/whatsapp-service/src/__tests__/infra/sender.test.ts`
2. Add a new `describe('sendCtaUrlMessage', ...)` block after the `sendInteractiveMessage` describe block (after line 312)
3. Add the following tests, mirroring the exact patterns used in `sendTextMessage` and `sendInteractiveMessage` describes:

**Test 1: `'sends CTA URL message successfully'`**

- Mock `fetch` to return `{ ok: true, json: () => Promise.resolve({ messages: [{ id: 'wamid.cta-123' }] }) }`
- Call `sender.sendCtaUrlMessage('+1234567890', 'Check this out', { displayText: 'View PR', url: 'https://github.com/repo/pull/1' })`
- Assert `result.ok === true` and `result.value.wamid === 'wamid.cta-123'`
- Assert fetch was called with URL `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`
- Parse the body from `mockFetch.mock.calls[0]` and assert:
  - `body['messaging_product'] === 'whatsapp'`
  - `body['to'] === '1234567890'` (+ prefix removed)
  - `body['type'] === 'interactive'`
  - `body['interactive']` equals `{ type: 'cta_url', body: { text: 'Check this out' }, action: { name: 'cta_url', parameters: { display_text: 'View PR', url: 'https://github.com/repo/pull/1' } } }`

**Test 2: `'removes + prefix from phone number for CTA URL messages'`**

- Mock fetch returning success (same as test 1)
- Call with `'+447123456789'`
- Assert body `to` is `'447123456789'`

**Test 3: `'returns error on API failure for CTA URL message'`**

- Mock fetch returning `{ ok: false, status: 400, text: () => Promise.resolve('Bad Request') }`
- Assert `result.ok === false`, `result.error.code === 'PERSISTENCE_ERROR'`, message contains `'400'`

**Test 4: `'returns error on network failure for CTA URL message'`**

- Mock fetch rejecting with `new Error('Network error')`
- Assert `result.ok === false`, `result.error.code === 'PERSISTENCE_ERROR'`, message contains `'Network error'`

**Test 5: `'returns error on timeout for CTA URL message'`**

- Create AbortError: `const abortError = new Error('Aborted'); abortError.name = 'AbortError';`
- Mock fetch rejecting with it
- Assert `result.ok === false`, `result.error.code === 'PERSISTENCE_ERROR'`, message contains `'timed out'`

**Test 6: `'generates fallback wamid when response has no message id'`**

- Mock fetch returning `{ ok: true, json: () => Promise.resolve({}) }`
- Assert `result.ok === true`, `result.value.wamid` matches `/^unknown-\d+$/`

4. **Remove v8 ignore markers** from `sender.ts`: Remove the `/* v8 ignore start */` on line 101 and `/* v8 ignore stop */` on line 274. The individual inner ignore on line 115-117 for `normalizedPhone` can also be removed since the new CTA URL tests will exercise the phone normalization path (but the `sendInteractiveMessage` tests already test this -- keep the inner one if removing the outer ones doesn't cover it).

   **IMPORTANT**: The outer v8 ignore on line 101 covers BOTH `sendInteractiveMessage` AND `sendCtaUrlMessage`. Since `sendInteractiveMessage` already has tests in the test file, removing this marker should work. However, verify coverage passes after removing. If the existing `sendInteractiveMessage` tests don't cover every branch (they should -- check the existing tests), you may need to keep `/* v8 ignore */` on specific uncoverable lines only.

### Files to Create

- None

### Files to Modify

- `apps/whatsapp-service/src/__tests__/infra/sender.test.ts` -- add `describe('sendCtaUrlMessage', ...)` block with 6 tests
- `apps/whatsapp-service/src/infra/whatsapp/sender.ts` -- remove outer `/* v8 ignore start */` on line 101 and `/* v8 ignore stop */` on line 274. Keep the inner `/* v8 ignore */` on line 115-117 for `normalizedPhone` in `sendInteractiveMessage` only if needed.

### Test Requirements

- [ ] Test: `sendCtaUrlMessage > sends CTA URL message successfully` -- verifies correct API call structure
- [ ] Test: `sendCtaUrlMessage > removes + prefix from phone number for CTA URL messages` -- verifies phone normalization
- [ ] Test: `sendCtaUrlMessage > returns error on API failure for CTA URL message` -- verifies error handling on HTTP error
- [ ] Test: `sendCtaUrlMessage > returns error on network failure for CTA URL message` -- verifies error handling on network error
- [ ] Test: `sendCtaUrlMessage > returns error on timeout for CTA URL message` -- verifies timeout handling
- [ ] Test: `sendCtaUrlMessage > generates fallback wamid when response has no message id` -- verifies fallback wamid generation

### Acceptance Criteria

- [ ] All 6 new tests pass
- [ ] v8 ignore markers removed from `sendInteractiveMessage` and `sendCtaUrlMessage` methods (lines 101 and 274)
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked whatsapp-service` passes

---

## TASK: WS-COV-2 — Add tests for pubsubRoutes.ts routing branches + auth

### Context

The `pubsubRoutes.ts` send-message handler (lines 105-288) has a routing branch at lines 210-227 that chooses between `sendCtaUrlMessage`, `sendInteractiveMessage`, and `sendTextMessage`. The existing tests cover ctaUrl, buttons, and text individually. The missing coverage is: (1) when `buttons` is provided as an empty array `[]` (the condition on line 217 checks `buttons.length > 0`, so empty array falls through to text), and (2) potential edge cases around the auth detection for each endpoint.

### Pre-conditions

- [ ] Existing `pubsubRoutes.test.ts` tests all pass
- [ ] Read current tests to verify what's already covered

### Steps

1. Open `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`

2. **Add test for empty buttons array routing** inside the `describe('POST /internal/whatsapp/pubsub/send-message', ...)` block (after the existing `'prefers ctaUrl over buttons when both are provided'` test around line 611):

**Test: `'sends plain text message when buttons array is empty'`**

```
- Setup: `await userMappingRepository.saveMapping('user-empty-btns', ['+48111222333']);`
- Create body with `createPubSubBody({ type: 'whatsapp.message.send', userId: 'user-empty-btns', message: 'No buttons', buttons: [], correlationId: 'corr-empty-btns', timestamp: new Date().toISOString() })`
- POST to `/internal/whatsapp/pubsub/send-message` with `x-internal-auth` header
- Assert response 200, `success: true`
- Assert `messageSender.getSentMessages()` has 1 message
- Assert `sentMessages[0]?.buttons` is `undefined` (plain text, not interactive)
- Assert `sentMessages[0]?.message` is `'No buttons'`
```

This test covers the branch at line 217: `eventData.buttons !== undefined && eventData.buttons.length > 0`. When `buttons` is `[]`, `length > 0` is false, so it falls through to `sendTextMessage`.

3. **Add test for outbound message save success logging** (verifying the else branch at line 279-284 that logs success):

**Test: `'saves outbound message successfully after sending'`**

```
- Setup: `await userMappingRepository.saveMapping('user-save-ok', ['+48111222333']);`
- Create body with `createPubSubBody({ type: 'whatsapp.message.send', userId: 'user-save-ok', message: 'Save success', correlationId: 'corr-save-ok', timestamp: new Date().toISOString() })`
- POST with auth header
- Assert response 200
- Assert outbound message was saved: `const saved = outboundMessageRepository.getSaved(); expect(saved.length).toBe(1); expect(saved[0]?.correlationId).toBe('corr-save-ok');`
```

### Files to Create

- None

### Files to Modify

- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts` -- add 2 tests in the send-message describe block

### Test Requirements

- [ ] Test: `sends plain text message when buttons array is empty` -- verifies empty buttons falls through to text
- [ ] Test: `saves outbound message successfully after sending` -- verifies outbound message save path

### Acceptance Criteria

- [ ] Both new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked whatsapp-service` passes

---

## TASK: WS-COV-3 — Add tests for webhookRoutes.ts metadata + button edge cases

### Context

The `handleTextMessage` function (lines 851-1054 of `webhookRoutes.ts`) has a metadata conditional block at lines 881-892 that is wrapped in `/* v8 ignore */` because webhook payloads in tests always include contacts and phoneNumberId. The `handleButtonMessage` function (lines 700-846) has several branches already tested (approve, cancel, convert, reject, invalid format, unknown intent). The remaining uncovered branches relate to the `publishApprovalReply` failure for text reply messages (line 980) and the `command.ingest` publish failure (line 1025).

### Pre-conditions

- [ ] All existing `webhookAsyncProcessing.test.ts` tests pass

### Steps

1. Open `apps/whatsapp-service/src/__tests__/webhookAsyncProcessing.test.ts`

2. **Add test for approval reply publish failure in text message handler** inside the `describe('Approval reply handling', ...)` block:

**Test: `'handles approval reply publish failure gracefully for text replies'`**

```
- Setup user mapping for `testUserId` with `senderPhone`
- Create outbound message with approval correlationId: `{ wamid: 'wamid.approval-pub-fail', correlationId: 'action-note-approval-action-pub-fail', userId: testUserId, sentAt: ..., expiresAt: ... }`
- Save it via `ctx.outboundMessageRepository.save(...)`
- Set publisher to fail: `ctx.eventPublisher.setApprovalReplyFailure('Simulated text approval failure')`
- Create reply payload with `createReplyWebhookPayload({ replyToWamid: 'wamid.approval-pub-fail', messageText: 'Sure!' })`
- POST to webhooks, trigger processing
- Assert event status is 'completed' (approval reply publish failure is non-fatal for text messages -- check source: lines 980-989 just log the error, don't update event status to failed)
- Assert no approval reply events were published (empty because publisher failed)
- Assert command.ingest was NOT published (because actionId was found, line 1005 skips it)
- Clear publisher failure: `ctx.eventPublisher.clear()`
```

3. **Add test for command.ingest publish failure** in a new describe block or within `Approval reply handling`:

**Test: `'handles command.ingest publish failure gracefully'`**

```
- Setup user mapping
- Create a standard text webhook (no reply context, so it goes through command.ingest path)
- Set publisher to fail for command ingest: `ctx.eventPublisher.setCommandIngestFailure('PubSub failure')`
- POST to webhooks, trigger processing
- Assert event status is 'completed' (command.ingest failure is non-fatal -- lines 1025-1030 just log)
- Clear failure
```

4. **Add test for cancel-task button intent** and **view-task button intent** (line 762 validIntents includes 'cancel-task' and 'view-task' but no existing tests exercise them):

**Test: `'processes cancel-task button'`**

```
- Setup user mapping for testUserId
- Create button payload: `createButtonWebhookPayload({ replyToWamid: 'wamid.cancel-task', buttonId: 'cancel-task:task-xyz', buttonTitle: 'Cancel Task' })`
- POST and trigger processing
- Assert approval reply event published with `replyText: 'cancel-task'`, `actionId: 'task-xyz'`
```

**Test: `'processes view-task button'`**

```
- Same pattern but buttonId: 'view-task:task-abc', title: 'View Task'
- Assert replyText: 'view-task', actionId: 'task-abc'
```

**Test: `'processes proceed-implementation button'`**

```
- Same pattern but buttonId: 'proceed-implementation:exec-123', title: 'Proceed'
- Assert replyText: 'proceed-implementation', actionId: 'exec-123'
```

### Files to Create

- None

### Files to Modify

- `apps/whatsapp-service/src/__tests__/webhookAsyncProcessing.test.ts` -- add 5 tests

### Test Requirements

- [ ] Test: `handles approval reply publish failure gracefully for text replies` -- covers lines 980-989
- [ ] Test: `handles command.ingest publish failure gracefully` -- covers lines 1025-1030
- [ ] Test: `processes cancel-task button` -- covers cancel-task intent at line 762
- [ ] Test: `processes view-task button` -- covers view-task intent at line 762
- [ ] Test: `processes proceed-implementation button` -- covers proceed-implementation intent at line 762

### Acceptance Criteria

- [ ] All 5 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked whatsapp-service` passes

---

## TASK: WS-COV-4 — Add tests for messageRoutes.ts GCS paths + ownership

### Context

The `messageRoutes.ts` DELETE handler (lines 545-603) has GCS path collection logic (lines 570-577) that collects `gcsPath` and `thumbnailGcsPath` before deletion. The existing tests already cover: message with both gcsPath+thumbnailGcsPath, message with only gcsPath, and text-only message (no paths). The current test coverage for this file appears comprehensive. The remaining uncoverable branches relate to `hasMedia` field at line 207 (`msg.gcsPath !== undefined`) and fromNumber mapping at line 180.

### Pre-conditions

- [ ] All existing `messageRoutes.test.ts` tests pass
- [ ] Review current coverage output to identify actual gaps

### Steps

1. Open `apps/whatsapp-service/src/__tests__/messageRoutes.test.ts`

2. **Add test for hasMedia field in GET /whatsapp/messages** to verify the `hasMedia: msg.gcsPath !== undefined` transformation at line 207:

**Test: `'returns hasMedia=true for messages with gcsPath'`** in the `describe('GET /whatsapp/messages', ...)` block:

```
- Setup userId, token, user mapping
- Save an image message with gcsPath set
- GET /whatsapp/messages
- Assert response 200
- Parse body and assert messages[0].hasMedia === true
- Assert messages[0].mediaType === 'image'
```

**Test: `'returns hasMedia=false for text messages without gcsPath'`**:

```
- Setup userId, token
- Save a text message (no gcsPath)
- GET /whatsapp/messages
- Assert messages[0].hasMedia === false
- Assert messages[0].mediaType === 'text'
```

3. **Add test for caption field** in the GET response (line 208 `caption: msg.caption ?? null`):

**Test: `'returns null caption for messages without caption'`**:

```
- Save a text message (no caption field)
- Assert response messages[0].caption === null
```

### Files to Create

- None

### Files to Modify

- `apps/whatsapp-service/src/__tests__/messageRoutes.test.ts` -- add 3 tests in GET /whatsapp/messages describe block

### Test Requirements

- [ ] Test: `returns hasMedia=true for messages with gcsPath` -- verifies gcsPath presence maps to hasMedia
- [ ] Test: `returns hasMedia=false for text messages without gcsPath` -- verifies absence maps to false
- [ ] Test: `returns null caption for messages without caption` -- verifies caption fallback

### Acceptance Criteria

- [ ] All 3 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked whatsapp-service` passes

---

## TASK: WS-1 — Split webhookRoutes.ts into use-cases

### Context

`webhookRoutes.ts` is 1,117 lines. It contains HTTP route handlers (GET/POST) AND 5 business-logic functions: `processWebhookEvent`, `handleImageMessage`, `handleAudioMessage`, `handleButtonMessage`, `handleTextMessage`, plus 2 helper functions: `markMessageAsRead`, `markAudioAsReadWithTyping`. The route definitions (lines 1-296) should stay; the processing logic (lines 298-1117) should be extracted.

### Pre-conditions

- [ ] All WS-COV tasks are completed first (coverage tasks provide safety net)
- [ ] All existing tests pass

### Steps

1. **Create `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts`**

   Extract the `processWebhookEvent` function (lines 305-585) and its 5 helper functions (lines 590-1117) into a new use-case class.

   **New class signature:**

   ```typescript
   export class ProcessWebhookEventUseCase {
     constructor(
       private readonly deps: {
         webhookEventRepository: WhatsAppWebhookEventRepository;
         userMappingRepository: WhatsAppUserMappingRepository;
         messageRepository: WhatsAppMessageRepository;
         outboundMessageRepository: OutboundMessageRepository;
         mediaStorage: MediaStoragePort;
         whatsappCloudApi: WhatsAppCloudApiPort;
         thumbnailGenerator: ThumbnailGeneratorPort;
         eventPublisher: EventPublisherPort;
       }
     ) {}

     async execute(
       payload: WebhookPayload,
       savedEvent: { id: string },
       logger: Logger
     ): Promise<void> {
       // Move processWebhookEvent body here, replacing request.log with logger,
       // replacing request.body with payload,
       // replacing getServices() calls with this.deps
     }
   }
   ```

2. **Move these private helper functions INTO the class as private methods:**
   - `handleImageMessage` (lines 590-629) -> `private async handleImageMessage(...)`
   - `handleAudioMessage` (lines 635-692) -> `private async handleAudioMessage(...)`
   - `handleButtonMessage` (lines 700-846) -> `private async handleButtonMessage(...)`
   - `handleTextMessage` (lines 851-1054) -> `private async handleTextMessage(...)`
   - `markMessageAsRead` (lines 1060-1084) -> `private async markMessageAsRead(...)`
   - `markAudioAsReadWithTyping` (lines 1091-1117) -> `private async markAudioAsReadWithTyping(...)`

3. **Simplify function signatures**: Instead of passing `request`, pass only what's needed:
   - Replace `request: FastifyRequest<{ Body: WebhookPayload }>` with `payload: WebhookPayload` and `logger: Logger`
   - Replace `request.body` with `payload`
   - Replace `request.log` with `logger`
   - Replace `getServices()` with `this.deps`

4. **Update `webhookRoutes.ts`:**
   - Remove lines 298-1117 (all the extracted functions)
   - Remove the `processWebhookEvent` export
   - Keep lines 1-296 (the route plugin) unchanged

5. **Update `pubsubRoutes.ts`:**
   - Line 17: Change `import { processWebhookEvent } from './webhookRoutes.js';` to import from the new use case
   - Line 684-689: Update the call site to instantiate `ProcessWebhookEventUseCase` with services from `getServices()`, then call `.execute(payload, { id: eventData.eventId }, request.log)`

6. **Update domain index:**
   - Export `ProcessWebhookEventUseCase` from `apps/whatsapp-service/src/domain/whatsapp/index.ts`

7. **Update imports** in the new file:
   - Import extractors from `../../routes/shared.js`
   - Import `ProcessImageMessageUseCase`, `ProcessAudioMessageUseCase`, `WhatsAppCloudApiPort` from domain
   - Import `getErrorMessage` from `@intexuraos/common-core`
   - Import `WebhookPayload` from `../../routes/schemas.js`
   - Import all port types from domain index

### Files to Create

- `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts` -- new use case with all business logic

### Files to Modify

- `apps/whatsapp-service/src/routes/webhookRoutes.ts` -- remove lines 298-1117 (exported `processWebhookEvent` and all helpers)
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts` -- update import and usage at line 17 and lines 684-689
- `apps/whatsapp-service/src/domain/whatsapp/index.ts` -- export new use case

### Test Requirements

- [ ] All existing `webhookAsyncProcessing.test.ts` tests (66 tests) pass without modification
- [ ] All existing `webhookReceiver.test.ts` tests (13 tests) pass without modification
- [ ] All existing `pubsubRoutes.test.ts` tests (47 tests) pass without modification

### Acceptance Criteria

- [ ] `webhookRoutes.ts` is under 300 lines
- [ ] New use case file exists with all extracted logic
- [ ] All v8 ignore comments preserved in new locations
- [ ] All existing tests pass unchanged (no test migration needed -- tests exercise routes which call the use case)
- [ ] `pnpm run verify:workspace:tracked whatsapp-service` passes

---

## TASK: WS-2 — Extract business logic from pubsubRoutes.ts

### Context

`pubsubRoutes.ts` is 751 lines. It contains 4 POST handlers with significant inline business logic. The auth detection pattern (lines 115-139) is duplicated 4 times. The message routing logic in send-message (lines 207-227) and the outbound message save (lines 254-284) should be extracted.

### Pre-conditions

- [ ] WS-1 is completed (since WS-1 changes pubsubRoutes.ts imports)
- [ ] All existing tests pass

### Steps

1. **Extract auth detection into a shared helper function** within `pubsubRoutes.ts` or a shared module:

   Create function at the top of `pubsubRoutes.ts` (after imports):

   ```typescript
   function authenticatePubSubRequest(
     request: FastifyRequest,
     reply: FastifyReply,
     endpointName: string
   ): { authenticated: boolean; isPubSubPush: boolean } | Promise<FastifyReply> {
     const fromHeader = request.headers.from;
     const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

     if (isPubSubPush) {
       request.log.info(
         { from: fromHeader, userAgent: request.headers['user-agent'] },
         'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
       );
       return { authenticated: true, isPubSubPush: true };
     }

     const authResult = validateInternalAuth(request);
     if (!authResult.valid) {
       request.log.warn(
         { reason: authResult.reason },
         `Internal auth failed for ${endpointName} endpoint`
       );
       // Return the reply promise -- caller must check and return it
       return reply.fail('UNAUTHORIZED', `Internal auth failed for ${endpointName} endpoint`);
     }

     return { authenticated: true, isPubSubPush: false };
   }
   ```

   **Note**: This is tricky because the reply.fail returns a Promise. The pattern should be:

   ```typescript
   // In each handler:
   const auth = await authenticatePubSubRequest(request, reply, 'pubsub/send-message');
   if (!('authenticated' in auth)) return; // reply already sent
   ```

   Actually, a cleaner approach matching the existing codebase patterns: keep it as an inline helper that returns `boolean` indicating whether to continue:

   ```typescript
   async function authenticateOrReject(
     request: FastifyRequest,
     reply: FastifyReply,
     endpointName: string
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
       request.log.warn(
         { reason: authResult.reason },
         `Internal auth failed for ${endpointName} endpoint`
       );
       await reply.fail('UNAUTHORIZED', `Internal auth failed for ${endpointName} endpoint`);
       return false;
     }

     return true;
   }
   ```

2. **Replace the 4 duplicated auth blocks** (send-message lines 115-139, media-cleanup lines 371-395, transcription-completed lines 525-544, process-webhook lines 633-653) with:

   ```typescript
   const isAuthenticated = await authenticateOrReject(request, reply, 'pubsub/send-message');
   if (!isAuthenticated) return;
   ```

3. **Extract PubSub message decoding into a helper**:

   ```typescript
   function decodePubSubMessage<T>(body: PubSubPushMessage, request: FastifyRequest): T | null {
     try {
       const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
       return JSON.parse(decoded) as T;
     } catch {
       request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
       return null;
     }
   }
   ```

   Replace the 4 duplicated try/catch decode blocks with this helper. Note: the error response differs per handler (send-message/media-cleanup return `reply.fail`, transcription-completed/process-webhook return `reply.ok`), so the caller still needs to handle the null case differently. The helper just deduplicates the decode+parse logic.

### Files to Create

- None

### Files to Modify

- `apps/whatsapp-service/src/routes/pubsubRoutes.ts` -- add `authenticateOrReject` helper, add `decodePubSubMessage` helper, replace 4 inline auth blocks and 4 inline decode blocks with helper calls

### Test Requirements

- [ ] All existing `pubsubRoutes.test.ts` tests (47 tests) pass without modification

### Acceptance Criteria

- [ ] Auth detection code appears once (in the helper), not 4 times
- [ ] PubSub decode logic appears once (in the helper), not 4 times
- [ ] `pubsubRoutes.ts` is reduced by ~80-100 lines
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked whatsapp-service` passes

---

## TASK: WS-3 — Deduplicate sender.ts HTTP patterns

### Context

`sender.ts` has 3 methods (`sendTextMessage`, `sendInteractiveMessage`, `sendCtaUrlMessage`) that share identical HTTP plumbing: AbortController setup, phone normalization, fetch call, error handling, wamid extraction. Only the request body structure differs.

### Pre-conditions

- [ ] WS-COV-1 is completed (so sendCtaUrlMessage has test coverage and v8 ignores are removed)
- [ ] All existing tests pass

### Steps

1. **Add a private `sendRequest` method** to `WhatsAppCloudApiSender`:

   ```typescript
   private async sendRequest(
     phoneNumber: string,
     body: Record<string, unknown>,
     messageTypeLabel: string
   ): Promise<Result<{ wamid: string }, WhatsAppError>> {
     logger.info({ phoneNumber, messageType: messageTypeLabel }, `Sending WhatsApp ${messageTypeLabel} message`);
     const controller = new AbortController();
     const timeoutId = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);

     try {
       const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;

       const response = await fetch(`${WHATSAPP_API_BASE}/${this.phoneNumberId}/messages`, {
         method: 'POST',
         headers: {
           Authorization: `Bearer ${this.accessToken}`,
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           messaging_product: 'whatsapp',
           recipient_type: 'individual',
           to: normalizedPhone,
           ...body,
         }),
         signal: controller.signal,
       });

       clearTimeout(timeoutId);

       if (!response.ok) {
         const errorBody = await response.text();
         logger.error({ phoneNumber, status: response.status, errorBody }, `WhatsApp API returned error for ${messageTypeLabel}`);
         return err({ code: 'PERSISTENCE_ERROR', message: `WhatsApp API error: ${String(response.status)} - ${errorBody}` });
       }

       const responseBody = (await response.json()) as { messages?: { id?: string }[] };
       const wamid = responseBody.messages?.[0]?.id ?? `unknown-${String(Date.now())}`;

       logger.info({ phoneNumber, normalizedPhone, wamid }, `${messageTypeLabel} message sent successfully`);
       return ok({ wamid });
     } catch (error) {
       clearTimeout(timeoutId);
       if (error instanceof Error && error.name === 'AbortError') {
         logger.error({ phoneNumber, timeoutMs: REQUEST_TIMEOUT_MS }, 'WhatsApp request timed out');
         return err({ code: 'PERSISTENCE_ERROR', message: `WhatsApp request timed out after ${String(REQUEST_TIMEOUT_MS)}ms` });
       }
       logger.error({ phoneNumber, error: getErrorMessage(error) }, `Failed to send WhatsApp ${messageTypeLabel} message`);
       return err({ code: 'PERSISTENCE_ERROR', message: `Failed to send WhatsApp ${messageTypeLabel} message: ${getErrorMessage(error)}` });
     }
   }
   ```

2. **Simplify `sendTextMessage`** (lines 27-99) to:

   ```typescript
   async sendTextMessage(phoneNumber: string, message: string): Promise<Result<{ wamid: string }, WhatsAppError>> {
     return this.sendRequest(phoneNumber, {
       type: 'text',
       text: { preview_url: false, body: message },
     }, 'text');
   }
   ```

3. **Simplify `sendInteractiveMessage`** (lines 102-191) to:

   ```typescript
   async sendInteractiveMessage(phoneNumber: string, message: string, buttons: WhatsAppInteractiveButton[]): Promise<Result<{ wamid: string }, WhatsAppError>> {
     const truncatedButtons = buttons.map((btn) => ({
       type: btn.type,
       reply: {
         id: btn.reply.id,
         title: btn.reply.title.length > 20 ? btn.reply.title.substring(0, 20) : btn.reply.title,
       },
     }));
     return this.sendRequest(phoneNumber, {
       type: 'interactive',
       interactive: { type: 'button', body: { text: message }, action: { buttons: truncatedButtons } },
     }, 'interactive');
   }
   ```

4. **Simplify `sendCtaUrlMessage`** (lines 193-273) to:

   ```typescript
   async sendCtaUrlMessage(phoneNumber: string, message: string, ctaUrl: { displayText: string; url: string }): Promise<Result<{ wamid: string }, WhatsAppError>> {
     return this.sendRequest(phoneNumber, {
       type: 'interactive',
       interactive: { type: 'cta_url', body: { text: message }, action: { name: 'cta_url', parameters: { display_text: ctaUrl.displayText, url: ctaUrl.url } } },
     }, 'CTA URL');
   }
   ```

5. **Remove all v8 ignore comments** that were protecting the duplicated code since it's now covered through the shared `sendRequest`.

### Files to Create

- None

### Files to Modify

- `apps/whatsapp-service/src/infra/whatsapp/sender.ts` -- add `sendRequest`, simplify 3 public methods

### Test Requirements

- [ ] All existing `sender.test.ts` tests (14 existing + 6 from WS-COV-1) pass without modification

### Acceptance Criteria

- [ ] `sender.ts` is reduced from 275 lines to approximately 100-120 lines
- [ ] HTTP plumbing (fetch, abort, error handling) appears exactly once in `sendRequest`
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked whatsapp-service` passes

---

## TASK: WS-4 — Split messageRoutes.ts by concern

### Context

`messageRoutes.ts` is 607 lines. It contains 4 routes that fall into 2 logical groups: (1) message listing (GET /messages) and (2) media access (GET /media, GET /thumbnail, DELETE). The file is manageable but could be cleaner with a split.

### Pre-conditions

- [ ] WS-COV-4 is completed
- [ ] All existing tests pass

### Steps

1. **Create `apps/whatsapp-service/src/routes/messageMediaRoutes.ts`** with the 3 media-related routes:
   - GET `/whatsapp/messages/:message_id/media` (lines 240-357)
   - GET `/whatsapp/messages/:message_id/thumbnail` (lines 360-478)
   - DELETE `/whatsapp/messages/:message_id` (lines 481-603)

   Export as: `export const messageMediaRoutes: FastifyPluginCallback = (fastify, _opts, done) => { ... done(); };`

   **Imports needed:**

   ```typescript
   import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
   import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
   import { getServices } from '../services.js';
   ```

   Also move the `MessageParams` interface (lines 12-14).

2. **Modify `messageRoutes.ts`:**
   - Remove lines 240-603 (the 3 media routes)
   - Remove `MessageParams` interface (line 12-14) -- it moves to the new file
   - Keep only GET `/whatsapp/messages` (lines 23-237) and the `ListQuerystring` interface (lines 16-19)
   - Rename export to `messageListRoutes` for clarity, OR keep as `messageRoutes` (less disruptive)

3. **Update `apps/whatsapp-service/src/server.ts`** (or wherever routes are registered):
   - Import `messageMediaRoutes` from the new file
   - Register it alongside `messageRoutes`
   - Look for the existing registration: `app.register(messageRoutes)` and add `app.register(messageMediaRoutes)` next to it

4. **Check test imports**: `messageRoutes.test.ts` tests all 4 routes via `app.inject()`, so the tests should work unchanged as long as both route plugins are registered on the same server. No test changes needed.

### Files to Create

- `apps/whatsapp-service/src/routes/messageMediaRoutes.ts` -- media/thumbnail/delete routes

### Files to Modify

- `apps/whatsapp-service/src/routes/messageRoutes.ts` -- remove 3 routes, keep only GET /messages list
- `apps/whatsapp-service/src/server.ts` (or route registration file) -- register new `messageMediaRoutes` plugin

### Test Requirements

- [ ] All existing `messageRoutes.test.ts` tests (32 tests) pass without modification

### Acceptance Criteria

- [ ] `messageRoutes.ts` is reduced from 607 to approximately 240 lines
- [ ] New `messageMediaRoutes.ts` contains the 3 extracted routes (~370 lines)
- [ ] Both files have proper JSDoc headers
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked whatsapp-service` passes
