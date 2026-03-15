# Refactoring Tasks — calendar-agent

I now have a thorough understanding of all the source files and tests. Let me produce the detailed instructions for all tasks.

---

## TASK: CL-COV-1

### Context

`calendarRoutes.ts` contains three helper functions (`buildListEventsOptions`, `buildCreateEventInput`, `buildUpdateEventInput`), an error handler (`handleCalendarError`), and a `Map`-to-`Object` transformation in the FreeBusy route. Some code paths in these are not exercised by existing route-level tests -- specifically: the unknown error code fallback to 500 in `handleCalendarError`, individual optional-field inclusion/exclusion in the builder functions, and the FreeBusy `Map`-to-`Object` conversion with multiple calendars including empty maps.

### Pre-conditions

- [ ] Read `apps/calendar-agent/src/routes/calendarRoutes.ts` (lines 69-123 and 775-778)
- [ ] Read `apps/calendar-agent/src/__tests__/calendarRoutes.test.ts` to understand existing test setup and patterns
- [ ] Read `apps/calendar-agent/src/__tests__/fakes.ts` for available fake methods

### Steps

1. **Open** `apps/calendar-agent/src/__tests__/calendarRoutes.test.ts`.

2. **Add a new describe block** at the end (before the closing `});` of the root `describe('Calendar Routes', ...)`) called `describe('handleCalendarError edge cases', () => { ... })`. Inside, add the following test:
   - **Test: `it('returns 500 with DOWNSTREAM_ERROR for unknown error codes', ...)`**
     - Set up `fakeCalendarClient.setListResult(err({ code: 'QUOTA_EXCEEDED' as CalendarErrorCode, message: 'Rate limit exceeded' }))` — note: `QUOTA_EXCEEDED` is a valid `CalendarErrorCode` but it is NOT handled explicitly in `handleCalendarError`, so it falls through to the default 500 path.
     - You will need to import `CalendarErrorCode` from `'../domain/index.js'`. Add this to the existing imports: `import type { CalendarEvent, FreeBusySlot, CalendarErrorCode } from '../domain/index.js';` (modify the existing import line which currently imports `CalendarEvent, FreeBusySlot`).
     - Create a JWT with `await createJwt('user-123')`.
     - Send `GET /calendar/events` with the JWT.
     - Assert `response.statusCode` is `500` (this is the Fastify schema response — if the route schema only allows specific status codes, check that 500 is listed; it is, per the schema at line 173).
     - Assert the response body has `success: false` and `error.code === 'DOWNSTREAM_ERROR'` and `error.message === 'Rate limit exceeded'`.

3. **Add a new describe block** called `describe('buildListEventsOptions', () => { ... })`. These tests exercise the helper indirectly through the route. Add the following tests:
   - **Test: `it('excludes undefined query parameters from options', ...)`**
     - Create a JWT. Send `GET /calendar/events` with NO query parameters (no timeMin, timeMax, maxResults, q).
     - Assert 200. This confirms `buildListEventsOptions` returns `{}` when all params are undefined.
   - **Test: `it('passes only the provided query parameters', ...)`**
     - Create a JWT. Send `GET /calendar/events?timeMin=2025-01-01T00:00:00Z` (only timeMin, no timeMax/maxResults/q).
     - Assert 200. This confirms timeMin is passed while others are excluded.

4. **Add a new describe block** called `describe('buildCreateEventInput', () => { ... })`. Add these tests:
   - **Test: `it('creates event with only required fields (no description, location, attendees)', ...)`**
     - Create a JWT. Send `POST /calendar/events` with only `summary`, `start`, `end` (no description, no location, no attendees).
     - Assert 201 and the response body has the event with the correct summary.

   - **Test: `it('includes description only when provided', ...)`**
     - Create a JWT. Send `POST /calendar/events` with `summary`, `start`, `end`, and `description: 'A description'` but no location and no attendees.
     - Assert 201 and `body.data.event.description` is `'A description'`.

   - **Test: `it('includes location only when provided', ...)`**
     - Create a JWT. Send `POST /calendar/events` with `summary`, `start`, `end`, and `location: 'Room A'` but no description and no attendees.
     - Assert 201.

   - **Test: `it('includes attendees only when provided', ...)`**
     - Create a JWT. Send `POST /calendar/events` with `summary`, `start`, `end`, and `attendees: [{ email: 'a@b.com' }]` but no description and no location.
     - Assert 201.

5. **Add a new describe block** called `describe('buildUpdateEventInput', () => { ... })`. Add these tests:
   - **Test: `it('sends empty update when body is empty', ...)`**
     - Create a JWT. Add an event to `fakeCalendarClient` with id `event-123`.
     - Send `PATCH /calendar/events/event-123` with an empty body `{}`.
     - Assert 200. This exercises `buildUpdateEventInput` returning `{}`.

   - **Test: `it('includes only summary when only summary is provided', ...)`**
     - Create a JWT. Add an event. Send `PATCH /calendar/events/event-123` with `{ summary: 'New' }`.
     - Assert 200.

   - **Test: `it('includes only description when only description is provided', ...)`**
     - Create a JWT. Add an event. Send `PATCH /calendar/events/event-123` with `{ description: 'New desc' }`.
     - Assert 200.

   - **Test: `it('includes only start and end when only times are provided', ...)`**
     - Create a JWT. Add an event. Send `PATCH /calendar/events/event-123` with `{ start: { dateTime: '2025-06-01T10:00:00Z' }, end: { dateTime: '2025-06-01T11:00:00Z' } }`.
     - Assert 200.

   - **Test: `it('includes only attendees when only attendees are provided', ...)`**
     - Create a JWT. Add an event. Send `PATCH /calendar/events/event-123` with `{ attendees: [{ email: 'x@y.com' }] }`.
     - Assert 200.

6. **Add a new describe block** called `describe('FreeBusy Map-to-Object transformation', () => { ... })`. Add these tests:
   - **Test: `it('converts empty Map to empty calendars object', ...)`**
     - Create a JWT. Set `fakeCalendarClient.setFreeBusyResult(ok(new Map()))`.
     - Send `POST /calendar/freebusy` with valid `timeMin`, `timeMax`.
     - Assert 200 and `body.data.calendars` is `{}` (empty object).

   - **Test: `it('converts Map with multiple calendars to object with busy arrays', ...)`**
     - Create a JWT. Set `fakeCalendarClient.setFreeBusyResult(ok(new Map([['cal1', [{ start: 'a', end: 'b' }]], ['cal2', [{ start: 'c', end: 'd' }, { start: 'e', end: 'f' }]]])))`.
     - Send `POST /calendar/freebusy` with valid `timeMin`, `timeMax`.
     - Assert 200 and `body.data.calendars.cal1.busy` has length 1 and `body.data.calendars.cal2.busy` has length 2.

### Files to Create

- None

### Files to Modify

- `apps/calendar-agent/src/__tests__/calendarRoutes.test.ts` — Add 12 new test cases across 5 new describe blocks, modify the `CalendarEvent, FreeBusySlot` import to also include `CalendarErrorCode`.

### Test Requirements

- [ ] Test: `returns 500 with DOWNSTREAM_ERROR for unknown error codes` — verifies the fallback path at calendarRoutes.ts lines 89-90
- [ ] Test: `excludes undefined query parameters from options` — verifies buildListEventsOptions returns empty object
- [ ] Test: `passes only the provided query parameters` — verifies partial query inclusion
- [ ] Test: `creates event with only required fields` — verifies buildCreateEventInput without optionals
- [ ] Test: `includes description only when provided` — verifies description branch
- [ ] Test: `includes location only when provided` — verifies location branch
- [ ] Test: `includes attendees only when provided` — verifies attendees branch
- [ ] Test: `sends empty update when body is empty` — verifies buildUpdateEventInput returns empty object
- [ ] Test: `includes only summary when only summary is provided` — verifies summary-only branch
- [ ] Test: `includes only description when only description is provided` — verifies description-only branch
- [ ] Test: `includes only start and end when only times are provided` — verifies start/end branches
- [ ] Test: `includes only attendees when only attendees are provided` — verifies attendees-only branch
- [ ] Test: `converts empty Map to empty calendars object` — verifies empty Map conversion
- [ ] Test: `converts Map with multiple calendars to object` — verifies multi-calendar Map conversion

### Acceptance Criteria

- [ ] All 14 new tests pass
- [ ] All existing tests pass unchanged
- [ ] The import line is changed from `import type { CalendarEvent, FreeBusySlot } from '../domain/index.js';` to `import type { CalendarEvent, CalendarErrorCode, FreeBusySlot } from '../domain/index.js';`
- [ ] `pnpm run verify:workspace:tracked calendar-agent` passes

---

## TASK: CL-COV-2

### Context

`internalRoutes.ts` has a local `handleCalendarError` (lines 46-60) that only handles `NOT_CONNECTED` and `TOKEN_ERROR` — other codes fall through to 500. The existing tests cover NOT_CONNECTED (via process-action) and TOKEN_ERROR but do not test the generate-preview endpoint returning NOT_CONNECTED. Additionally, the Pub/Sub endpoint and the direct HTTP endpoint both call `generateCalendarPreview` with the same arguments, but there are no tests verifying they produce identical outputs for identical inputs, and there are no tests for partially-missing fields in the decoded Pub/Sub message.

### Pre-conditions

- [ ] Read `apps/calendar-agent/src/routes/internalRoutes.ts` (full file)
- [ ] Read `apps/calendar-agent/src/__tests__/routes/internalRoutes.test.ts` (full file)
- [ ] Read `apps/calendar-agent/src/__tests__/fakes.ts` for available fake methods

### Steps

1. **Open** `apps/calendar-agent/src/__tests__/routes/internalRoutes.test.ts`.

2. **Inside the `describe('POST /internal/calendar/process-action', ...)` block**, add these tests after the existing ones:
   - **Test: `it('returns 403 for NOT_CONNECTED error from process-action', ...)`**
     - Set `fakeUserService.setTokenError('CONNECTION_NOT_FOUND', 'Google Calendar not connected')`.
     - Send `POST /internal/calendar/process-action` with valid payload and `x-internal-auth` header.
     - Assert `response.statusCode` is `403`.
     - Assert `body.error.code` is `'FORBIDDEN'`.
     - Assert `body.error.message` is `'Google Calendar not connected'`.
     - **Rationale:** This tests the `handleCalendarError` in `internalRoutes.ts` line 50-53 for NOT_CONNECTED from the process-action endpoint specifically.

3. **Inside the `describe('POST /internal/calendar/generate-preview', ...)` block**, add these tests after the existing ones:
   - **Test: `it('returns 200 for empty/missing optional fields in decoded message', ...)`**
     - Create a Pub/Sub payload where the decoded data has all required fields (`actionId`, `userId`, `text`, `currentDate`) but the `text` is an empty string: `{ actionId: 'action-123', userId: 'user-456', text: '', currentDate: '2025-01-14' }`.
     - Send `POST /internal/calendar/generate-preview` with `from: 'noreply@google.com'` header and the encoded payload.
     - Assert `response.statusCode` is `200`.
     - This verifies the handler does not crash on edge-case input.

   - **Test: `it('handles message with extra unknown fields gracefully', ...)`**
     - Create a Pub/Sub payload with extra fields: `{ actionId: 'action-123', userId: 'user-456', text: 'Meeting', currentDate: '2025-01-14', unknownField: 'extra' }`.
     - Send with `from: 'noreply@google.com'`.
     - Assert 200 — the `JSON.parse` cast does not fail on extra fields.

4. **Add a new describe block** at the end (before the closing `});` of the root `describe('Internal Routes', ...)`) called `describe('Pub/Sub vs Direct preview consistency', () => { ... })`. Add this test:
   - **Test: `it('produces the same preview output for identical input via Pub/Sub and direct HTTP', ...)`**
     - Define input: `{ actionId: 'action-consistency', userId: 'user-456', text: 'Lunch with Monika tomorrow at 2pm', currentDate: '2025-01-14' }`.
     - **First call (direct HTTP):** Send `POST /internal/calendar/preview` with the input directly as body, with `x-internal-auth` header. Store the response body as `directBody`.
     - **Reset the preview repository** by calling `fakeCalendarPreviewRepository.reset()` to clear stored previews so the second call creates a fresh preview.
     - **Second call (Pub/Sub):** Encode the same input as base64 and wrap in Pub/Sub format. Send `POST /internal/calendar/generate-preview` with `from: 'noreply@google.com'`. Store the response body as `pubsubBody`.
     - Assert both responses have `statusCode` 200.
     - Assert `directBody.data.preview.status` equals `'ready'`.
     - Assert `pubsubBody.data.status` equals `'ready'`.
     - Assert `directBody.data.preview.summary` equals the fake extraction default summary (`'Test Event'`).
     - **Note:** The response shapes differ: direct returns `{ preview: { ...fullPreview } }`, Pub/Sub returns `{ previewId, status }`. So you can only compare the fields that overlap: `status` should both be `'ready'`.

5. **Inside the `describe('POST /internal/calendar/generate-preview', ...)` block**, add one more test:
   - **Test: `it('returns 500 for unknown error code from handleCalendarError in generate-preview', ...)`**
     - This test is actually N/A because `generate-preview` does not call `handleCalendarError` — it calls `reply.fail('DOWNSTREAM_ERROR', ...)` directly at line 326. So **skip this test** — the generate-preview endpoint does not use `handleCalendarError`. This is a key observation: the `handleCalendarError` in `internalRoutes.ts` is only used by the `process-action` endpoint (line 181). The preview endpoints use inline error handling. Document this in a comment if helpful.

6. **Inside the `describe('POST /internal/calendar/process-action', ...)` block**, add one more test:
   - **Test: `it('returns 500 for unrecognized error code from handleCalendarError', ...)`**
     - This requires making `processCalendarAction` return an error with a code that is NOT `NOT_CONNECTED` or `TOKEN_ERROR`. Set up fakes so the use case returns an `INTERNAL_ERROR`:
       - Set `fakeProcessedActionRepository.setGetByActionIdResult(err({ code: 'INTERNAL_ERROR', message: 'DB connection lost' }))`.
     - Send `POST /internal/calendar/process-action` with valid payload and `x-internal-auth` header.
     - Assert `response.statusCode` is `500`.
     - Assert `body.error.code` is `'DOWNSTREAM_ERROR'`.
     - Assert `body.error.message` is `'DB connection lost'`.
     - **Note:** You need to import `err` from `@intexuraos/common-core`. Check the existing imports — `err` is already imported at line 6.

### Files to Create

- None

### Files to Modify

- `apps/calendar-agent/src/__tests__/routes/internalRoutes.test.ts` — Add 5 new test cases (NOT_CONNECTED from process-action, empty text in Pub/Sub, extra fields in Pub/Sub, consistency check, unrecognized error code), plus one new describe block.

### Test Requirements

- [ ] Test: `returns 403 for NOT_CONNECTED error from process-action` — verifies handleCalendarError NOT_CONNECTED branch in internalRoutes.ts line 50-53
- [ ] Test: `returns 200 for empty/missing optional fields in decoded message` — verifies robustness of Pub/Sub decode
- [ ] Test: `handles message with extra unknown fields gracefully` — verifies Pub/Sub decode doesn't fail on extra fields
- [ ] Test: `produces the same preview output for identical input via Pub/Sub and direct HTTP` — verifies behavioral consistency
- [ ] Test: `returns 500 for unrecognized error code from handleCalendarError` — verifies the fallback path at internalRoutes.ts lines 58-59

### Acceptance Criteria

- [ ] All 5 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked calendar-agent` passes

---

## TASK: CL-1

### Context

`calendarRoutes.ts` is 1,065 lines containing 7 route handlers across 3 logical groups (calendar events CRUD, free/busy, failed events), plus 3 helper functions and 1 error handler. This task splits the file into focused modules for maintainability.

### Pre-conditions

- [ ] Read `apps/calendar-agent/src/routes/calendarRoutes.ts` (full file)
- [ ] Read `apps/calendar-agent/src/server.ts` (lines 174-175 for route registration)
- [ ] Read `apps/calendar-agent/src/services.ts` for `ServiceContainer` type
- [ ] Read `apps/calendar-agent/src/__tests__/calendarRoutes.test.ts` (full file)
- [ ] Run `pnpm run verify:workspace:tracked calendar-agent` to confirm all tests pass before starting

### Steps

1. **Create** `apps/calendar-agent/src/routes/calendarErrorHandler.ts`:
   - Move the `handleCalendarError` function (lines 69-91 of `calendarRoutes.ts`) into this file.
   - Export it as a named export: `export async function handleCalendarError(...)`.
   - Import `type { FastifyReply } from 'fastify'`.
   - This exact same function is duplicated in `internalRoutes.ts` (lines 46-60) but with fewer branches (no NOT_FOUND, no INVALID_REQUEST). For now, only extract the one from `calendarRoutes.ts`. CL-2 will address the deduplication.

2. **Create** `apps/calendar-agent/src/routes/calendarHelpers.ts`:
   - Move the three helper functions: `buildListEventsOptions` (lines 93-100), `buildCreateEventInput` (lines 102-112), `buildUpdateEventInput` (lines 114-123).
   - Move the interface types they depend on: `ListEventsQuery` (lines 27-33), `EventParams` (lines 35-37), `CalendarIdQuery` (lines 39-41), `CreateEventBody` (lines 43-51), `UpdateEventBody` (lines 53-61), `FreeBusyBody` (lines 63-67).
   - Export all functions and interfaces as named exports.
   - Import domain types: `import type { ListEventsInput, CreateEventInput, UpdateEventInput } from '../domain/index.js';`

3. **Create** `apps/calendar-agent/src/routes/eventRoutes.ts`:
   - This file contains the 5 event CRUD routes: `GET /calendar/events`, `GET /calendar/events/:eventId`, `POST /calendar/events`, `PATCH /calendar/events/:eventId`, `DELETE /calendar/events/:eventId`.
   - Import from new files: `import { handleCalendarError } from './calendarErrorHandler.js';` and `import { buildListEventsOptions, buildCreateEventInput, buildUpdateEventInput, type ListEventsQuery, type EventParams, type CalendarIdQuery, type CreateEventBody, type UpdateEventBody } from './calendarHelpers.js';`
   - Import from domain: `import { listEvents, getEvent, createEvent, updateEvent, deleteEvent, type ListEventsRequest, type GetEventRequest, type CreateEventRequest, type UpdateEventRequest, type DeleteEventRequest } from '../domain/index.js';`
   - Import from services: `import { getServices } from '../services.js';`
   - Import from common: `import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';`
   - Import Fastify types: `import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';`
   - Export as `export const eventRoutes: FastifyPluginCallback = (fastify, _opts, done) => { ... done(); };`
   - Copy the exact route handler implementations from `calendarRoutes.ts` lines 126-671.

4. **Create** `apps/calendar-agent/src/routes/freeBusyRoutes.ts`:
   - This file contains the single FreeBusy route: `POST /calendar/freebusy`.
   - Import similarly to eventRoutes but only what's needed: `handleCalendarError`, `type FreeBusyBody`, domain's `getFreeBusy, type GetFreeBusyRequest`, services, common-http, fastify types.
   - Export as `export const freeBusyRoutes: FastifyPluginCallback = (fastify, _opts, done) => { ... done(); };`
   - Copy the exact handler from `calendarRoutes.ts` lines 673-782.

5. **Create** `apps/calendar-agent/src/routes/failedEventRoutes.ts`:
   - This file contains the 3 failed event routes: `GET /calendar/failed-events`, `DELETE /calendar/failed-events/:id`, `POST /calendar/failed-events/:id/retry`.
   - Import `handleCalendarError` (though note: the failed-events routes don't use it — they use inline error handling. Still import if the retry route uses `createEvent` which could call it. Actually, on re-reading: the retry route calls `createEvent` directly but handles errors inline with status 422. So `handleCalendarError` is NOT needed here).
   - Import domain: `createEvent, type CreateEventInput, type FailedEventFilters`.
   - Define local interfaces: `FailedEventsQuery` (line 784-786), `FailedEventParams` (lines 882-884).
   - Export as `export const failedEventRoutes: FastifyPluginCallback = (fastify, _opts, done) => { ... done(); };`
   - Copy the exact handlers from `calendarRoutes.ts` lines 788-947 and 949-1061.

6. **Update** `apps/calendar-agent/src/routes/calendarRoutes.ts`:
   - Replace the entire file with a barrel that re-registers all sub-route files:

   ```typescript
   /**
    * Calendar API routes — barrel that registers all sub-route plugins.
    */
   import type { FastifyPluginCallback } from 'fastify';
   import { eventRoutes } from './eventRoutes.js';
   import { freeBusyRoutes } from './freeBusyRoutes.js';
   import { failedEventRoutes } from './failedEventRoutes.js';

   export const calendarRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
     void fastify.register(eventRoutes);
     void fastify.register(freeBusyRoutes);
     void fastify.register(failedEventRoutes);
     done();
   };
   ```

   - **IMPORTANT:** `server.ts` line 174 already does `await app.register(calendarRoutes)` — this remains unchanged since the export name `calendarRoutes` is preserved.

7. **Do NOT modify** `apps/calendar-agent/src/server.ts`. The barrel export maintains backward compatibility.

8. **Do NOT modify** any test files. All tests inject against routes by URL, not by module import. Since the route URLs remain identical, all tests should pass unchanged.

9. **Run** `pnpm run verify:workspace:tracked calendar-agent` to confirm everything passes.

### Files to Create

- `apps/calendar-agent/src/routes/calendarErrorHandler.ts` — shared error handler function
- `apps/calendar-agent/src/routes/calendarHelpers.ts` — builder functions and route interface types
- `apps/calendar-agent/src/routes/eventRoutes.ts` — 5 event CRUD route handlers
- `apps/calendar-agent/src/routes/freeBusyRoutes.ts` — 1 FreeBusy route handler
- `apps/calendar-agent/src/routes/failedEventRoutes.ts` — 3 failed event route handlers

### Files to Modify

- `apps/calendar-agent/src/routes/calendarRoutes.ts` — Replace with barrel module that registers sub-route plugins

### Test Requirements

- [ ] All existing tests in `calendarRoutes.test.ts` pass unchanged
- [ ] All existing tests in `internalRoutes.test.ts` pass unchanged

### Acceptance Criteria

- [ ] `calendarRoutes.ts` is reduced to ~15 lines (barrel only)
- [ ] Each new route file is under 350 lines
- [ ] `calendarErrorHandler.ts` contains only the `handleCalendarError` function
- [ ] `calendarHelpers.ts` contains only the builder functions and interface types
- [ ] No route URL or HTTP method changes
- [ ] No changes to `server.ts`
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked calendar-agent` passes

---

## TASK: CL-2

### Context

`internalRoutes.ts` (575 lines) has three issues: (1) a local `handleCalendarError` (lines 46-60) that is a subset of the one in `calendarRoutes.ts` (lines 69-91), (2) the Pub/Sub generate-preview endpoint (lines 194-339) and direct HTTP preview endpoint (lines 448-571) share nearly identical core logic — both call `generateCalendarPreview` with the same deps, the only differences are auth handling, input decoding, and response shape, (3) the Pub/Sub message decoding pattern could be extracted. **IMPORTANT:** If CL-1 has been completed first, `calendarErrorHandler.ts` already exists. If not, this task must create it.

### Pre-conditions

- [ ] Read `apps/calendar-agent/src/routes/internalRoutes.ts` (full file)
- [ ] Read `apps/calendar-agent/src/__tests__/routes/internalRoutes.test.ts` (full file)
- [ ] Check whether `apps/calendar-agent/src/routes/calendarErrorHandler.ts` already exists (from CL-1). If it does, read it.
- [ ] Read `apps/calendar-agent/src/__tests__/fakes.ts`

### Steps

1. **Handle `calendarErrorHandler.ts` depending on CL-1 status:**
   - **If CL-1 was already completed:** `calendarErrorHandler.ts` exists with the full 5-branch version (NOT_CONNECTED, TOKEN_ERROR, NOT_FOUND, INVALID_REQUEST, fallback). The `internalRoutes.ts` only needs NOT_CONNECTED, TOKEN_ERROR, and fallback — but the extra branches (NOT_FOUND, INVALID_REQUEST) are harmless no-ops for internal routes since those error codes are never returned by `processCalendarAction`. Simply import and use the shared handler.
   - **If CL-1 was NOT completed:** Create `apps/calendar-agent/src/routes/calendarErrorHandler.ts` with the full 5-branch version from `calendarRoutes.ts` lines 69-91. This is the superset — it handles all cases that either calendarRoutes or internalRoutes needs.

2. **Update** `apps/calendar-agent/src/routes/internalRoutes.ts`:
   - **Remove** the local `handleCalendarError` function (lines 46-60).
   - **Add import:** `import { handleCalendarError } from './calendarErrorHandler.js';` at the top of the file (after the existing imports).
   - All call sites that use `handleCalendarError` (line 181 in process-action) remain unchanged since the import provides the same function signature.

3. **Extract a shared preview generation helper.** Create a new function inside `internalRoutes.ts` (or in a separate file `apps/calendar-agent/src/routes/previewHelper.ts` — prefer keeping it in `internalRoutes.ts` to minimize file count since it's only used there):
   - Define a helper function at the top of `internalRoutes.ts` (after imports, before the `internalRoutes` export):

   ```typescript
   async function executeGeneratePreview(
     input: { actionId: string; userId: string; text: string; currentDate: string },
     request: FastifyRequest,
     reply: FastifyReply
   ): Promise<unknown> {
     const { actionId, userId, text, currentDate } = input;

     request.log.info(
       { actionId, userId, textLength: text.length },
       'internal/generateCalendarPreview: processing preview request'
     );

     const services = getServices();

     const result = await generateCalendarPreview(
       { actionId, userId, text, currentDate },
       {
         calendarActionExtractionService: services.calendarActionExtractionService,
         calendarPreviewRepository: services.calendarPreviewRepository,
         logger: request.log,
       }
     );

     if (!result.ok) {
       request.log.error(
         { actionId, error: result.error },
         'internal/generateCalendarPreview: preview generation failed'
       );
       return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
     }

     return result;
   }
   ```

   - **Update Pub/Sub handler** (lines 256-338): After successful auth check and message decoding, replace lines 303-337 with:

   ```typescript
   const generateResult = await executeGeneratePreview(
     { actionId, userId, text, currentDate },
     request,
     reply
   );

   // If executeGeneratePreview already sent an error reply, return
   if (reply.sent) {
     return;
   }

   // Type narrow: result is successful
   const okResult = generateResult as { ok: true; value: { preview: { status: string } } };

   request.log.info(
     { messageId: message.messageId, actionId, status: okResult.value.preview.status },
     'internal/generateCalendarPreview: complete'
   );

   return await reply.ok({
     previewId: actionId,
     status: okResult.value.preview.status,
   });
   ```

   - **Wait — this approach introduces type complexity.** A simpler, cleaner approach: keep the two handlers mostly as-is, but extract just the duplicated service-call + error-handling block into a helper. Let me revise:

   **Revised approach — extract only the `generateCalendarPreview` call + error handling into a shared function:**

   ```typescript
   async function callGeneratePreview(
     input: { actionId: string; userId: string; text: string; currentDate: string },
     logger: import('@intexuraos/common-core').Logger
   ): Promise<
     Result<
       { preview: import('../domain/index.js').CalendarPreview },
       import('../domain/index.js').CalendarError
     >
   > {
     const services = getServices();
     return await generateCalendarPreview(input, {
       calendarActionExtractionService: services.calendarActionExtractionService,
       calendarPreviewRepository: services.calendarPreviewRepository,
       logger,
     });
   }
   ```

   **Actually, even simpler:** The duplication is really just 3 lines of service lookup. The real value is extracting the Pub/Sub decode. Let me re-analyze what's truly duplicated.

   **Revised final approach (minimal, safe):**

   a. **Step 2a**: Remove local `handleCalendarError`, import from `calendarErrorHandler.ts`. (Already described above.)

   b. **Step 2b**: Extract Pub/Sub message decoding into a helper function at the top of `internalRoutes.ts`:

   ```typescript
   function decodePubSubMessage<T>(
     data: string,
     logger: { error: (obj: object, msg: string) => void },
     messageId: string
   ): T | null {
     try {
       const decoded = Buffer.from(data, 'base64').toString('utf-8');
       return JSON.parse(decoded) as T;
     } catch {
       logger.error({ messageId }, 'decodePubSubMessage: failed to decode message');
       return null;
     }
   }
   ```

   Replace lines 290-301 in the Pub/Sub handler with:

   ```typescript
   const messageData = decodePubSubMessage<GeneratePreviewMessage>(
     message.data,
     request.log,
     message.messageId
   );
   if (messageData === null) {
     reply.status(400);
     return await reply.fail('INVALID_REQUEST', 'Invalid message format');
   }
   ```

   c. **Step 2c**: Extract the shared service resolution + `generateCalendarPreview` call into a helper:

   ```typescript
   import type { Result } from '@intexuraos/common-core';
   import type { CalendarError, CalendarPreview } from '../domain/index.js';

   // (add Result to the import from common-core, add CalendarError and CalendarPreview to domain import)

   interface GeneratePreviewInput {
     actionId: string;
     userId: string;
     text: string;
     currentDate: string;
   }

   async function callGeneratePreview(
     input: GeneratePreviewInput,
     logger: Parameters<typeof generateCalendarPreview>[1]['logger']
   ): Promise<Result<{ preview: CalendarPreview }, CalendarError>> {
     const services = getServices();
     return await generateCalendarPreview(input, {
       calendarActionExtractionService: services.calendarActionExtractionService,
       calendarPreviewRepository: services.calendarPreviewRepository,
       logger,
     });
   }
   ```

   Replace the duplicated blocks in both handlers:

   **In Pub/Sub handler (lines 310-337)**, replace:

   ```typescript
   const services = getServices();
   const result = await generateCalendarPreview(
     { actionId, userId, text, currentDate },
     {
       calendarActionExtractionService: services.calendarActionExtractionService,
       calendarPreviewRepository: services.calendarPreviewRepository,
       logger: request.log,
     }
   );
   ```

   with:

   ```typescript
   const result = await callGeneratePreview({ actionId, userId, text, currentDate }, request.log);
   ```

   **In Direct HTTP handler (lines 545-554)**, replace:

   ```typescript
   const services = getServices();
   const result = await generateCalendarPreview(
     { actionId, userId, text, currentDate },
     {
       calendarActionExtractionService: services.calendarActionExtractionService,
       calendarPreviewRepository: services.calendarPreviewRepository,
       logger: request.log,
     }
   );
   ```

   with:

   ```typescript
   const result = await callGeneratePreview({ actionId, userId, text, currentDate }, request.log);
   ```

   The rest of each handler (error handling, logging, response shape) remains handler-specific because the response formats differ.

4. **If CL-1 was completed**, also update `apps/calendar-agent/src/routes/calendarRoutes.ts` (or the split files `eventRoutes.ts`, `freeBusyRoutes.ts`, `failedEventRoutes.ts`) to import `handleCalendarError` from `./calendarErrorHandler.js` instead of defining it inline. If the barrel approach from CL-1 was used and `handleCalendarError` was already extracted, this step is already done.

5. **Run** `pnpm run verify:workspace:tracked calendar-agent` to confirm everything passes.

### Files to Create

- `apps/calendar-agent/src/routes/calendarErrorHandler.ts` — **Only if CL-1 was not completed first.** Contains the shared `handleCalendarError` function (5-branch version from calendarRoutes.ts lines 69-91).

### Files to Modify

- `apps/calendar-agent/src/routes/internalRoutes.ts` — Remove local `handleCalendarError` (lines 46-60), import shared version, extract `decodePubSubMessage` helper, extract `callGeneratePreview` helper, update both preview handlers to use the new helpers. Add `Result` to common-core import, add `CalendarError, CalendarPreview` to domain import if not already present.
- `apps/calendar-agent/src/routes/calendarRoutes.ts` (or the split files from CL-1) — Import `handleCalendarError` from `./calendarErrorHandler.js` instead of defining it locally, **only if CL-1 was not completed first** (if CL-1 was completed, this is already done).

### Test Requirements

- [ ] All existing tests in `internalRoutes.test.ts` pass unchanged (22 tests)
- [ ] All existing tests in `calendarRoutes.test.ts` pass unchanged

### Acceptance Criteria

- [ ] `handleCalendarError` exists in exactly one place: `calendarErrorHandler.ts`
- [ ] No duplicate `handleCalendarError` function in `calendarRoutes.ts` or `internalRoutes.ts`
- [ ] `decodePubSubMessage` helper is used by the Pub/Sub handler
- [ ] `callGeneratePreview` helper is used by both preview endpoints
- [ ] `internalRoutes.ts` is reduced by approximately 20-30 lines
- [ ] No route URL or HTTP method changes
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked calendar-agent` passes
