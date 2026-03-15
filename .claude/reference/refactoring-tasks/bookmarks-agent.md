# Refactoring Tasks — bookmarks-agent

I now have a complete understanding of the codebase. Let me note one critical finding: the `vitest.config.ts` at root level **excludes** `**/server.ts` from coverage (line 90). This means BK-COV-1 (server.ts tests) won't affect coverage metrics -- the tests would be for correctness only, not coverage. Let me verify this is understood and produce the output.

Here are the detailed task instructions:

---

## TASK: BK-COV-1 -- Add tests for server.ts buildServer + health check

### Context

`server.ts` is excluded from coverage in `vitest.config.ts` (line 90: `'**/server.ts'`), so these tests are for correctness verification only. The `buildServer()` function is already called in `testUtils.ts` via `setupTestContext()`, and route tests implicitly exercise it. These tests verify the health check endpoint, OpenAPI endpoint, and CORS headers explicitly.

### Pre-conditions

- [ ] Read `apps/bookmarks-agent/src/server.ts` (already read above)
- [ ] Read `apps/bookmarks-agent/src/__tests__/testUtils.ts` to understand the test setup pattern
- [ ] Confirm `server.ts` is excluded from coverage in root `vitest.config.ts` line 90

### Steps

1. Create new file `apps/bookmarks-agent/src/__tests__/server.test.ts`
2. Import `describe, it, expect` from `./testUtils.js` and `setupTestContext` from `./testUtils.js`
3. Use `setupTestContext()` which already calls `buildServer()`, sets up fakes, and registers `beforeEach`/`afterEach`
4. Write test cases exactly as specified below

### Files to Create

- `apps/bookmarks-agent/src/__tests__/server.test.ts` -- Tests for buildServer, health check, CORS, and OpenAPI

### Files to Modify

- None

### Test Requirements

- [ ] Test: `buildServer returns a Fastify instance with expected routes` -- After `ctx.app.ready()`, call `ctx.app.printRoutes()` or check that `ctx.app` is not null and has `.inject()` method. Verify key routes exist by injecting requests to `/health`, `/bookmarks`, `/internal/bookmarks`, `/internal/bookmarks/pubsub/enrich`, and `/internal/bookmarks/pubsub/summarize` (just check they don't return 404 "route not found")
- [ ] Test: `GET /health returns 200 with health response structure` -- Inject `GET /health`. Assert `statusCode === 200`. Parse body. Assert `body.status` is one of `['ok', 'degraded', 'down']`. Assert `body.serviceName === 'bookmarks-agent'`. Assert `body.version === '0.0.4'`. Assert `body.timestamp` is a valid ISO date string. Assert `body.checks` is an array with length >= 1. Assert response header `x-health-duration-ms` exists and is a numeric string.
- [ ] Test: `GET /health returns checks array with secrets check` -- Inject `GET /health`. Assert `body.checks` contains an object with `name: 'secrets'` and `status: 'ok'` (since `REQUIRED_SECRETS` is empty array `[]`)
- [ ] Test: `CORS headers are present on responses` -- Inject `OPTIONS /bookmarks` with `Origin: https://example.com` header and `Access-Control-Request-Method: GET`. Assert response includes `access-control-allow-origin` header. Note: the CORS config uses `origin: true` so any origin should be reflected back.
- [ ] Test: `GET /openapi.json returns OpenAPI spec` -- Inject `GET /openapi.json`. Assert `statusCode === 200`. Assert content-type includes `application/json`. Parse body. Assert `body.openapi` starts with `'3.1'`. Assert `body.info.title === 'bookmarks-agent'`. Assert `body.info.version === '0.0.4'`.
- [ ] Test: `GET /docs returns Swagger UI` -- Inject `GET /docs`. Assert response is not 404 (should be 200 or 302 redirect to `/docs/`).

### Acceptance Criteria

- [ ] All new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes

---

## TASK: BK-COV-2 -- Add tests for internalRoutes.ts enrichPublisher + bookmark status

### Context

The existing `internalRoutes.test.ts` covers most branches but is missing specific verification of: (1) the enrichPublisher being called with correct event shape after successful create, (2) creating a bookmark with explicit `status: 'draft'`, (3) verifying `ogFetchedAt` is set to a timestamp when `ogFetchStatus` changes to `'processed'`, and (4) the force-refresh endpoint returning the updated bookmark with full OG data. These are coverage gaps in the route handler logic at lines 220-233 (enrichPublisher call verification), line 202 (status param passthrough), and the `ogFetchedAt` timestamp mapping in `updateBookmarkInternal`.

### Pre-conditions

- [ ] Read `apps/bookmarks-agent/src/routes/internalRoutes.ts` lines 220-233 (enrichPublisher call)
- [ ] Read `apps/bookmarks-agent/src/__tests__/internalRoutes.test.ts`
- [ ] Read `apps/bookmarks-agent/src/__tests__/fakeEnrichPublisher.ts` to understand `publishedEvents` array

### Steps

1. Open `apps/bookmarks-agent/src/__tests__/internalRoutes.test.ts`
2. Add new test cases to existing describe blocks as specified below

### Files to Create

- None

### Files to Modify

- `apps/bookmarks-agent/src/__tests__/internalRoutes.test.ts` -- Add new test cases inside existing describe blocks

### Test Requirements

- [ ] Test (inside `POST /internal/bookmarks`): `publishes enrich event with correct shape after successful create` -- Create a bookmark via POST. Assert `response.statusCode === 201`. Then access `ctx.enrichPublisher.publishedEvents`. Assert it has length 1. Assert `publishedEvents[0].type === 'bookmarks.enrich'`. Assert `publishedEvents[0].bookmarkId` matches the returned `body.data.id`. Assert `publishedEvents[0].userId === 'user-1'`. Assert `publishedEvents[0].url === 'https://example.com'`.
- [ ] Test (inside `POST /internal/bookmarks`): `creates bookmark with draft status when status param is provided` -- POST with `status: 'draft'` in payload. Assert `response.statusCode === 201`. Assert `body.data.bookmark.status === 'draft'`.
- [ ] Test (inside `PATCH /internal/bookmarks/:id`): `sets ogFetchedAt when ogPreview is provided` -- Create a bookmark. PATCH it with `ogPreview: {...}` and `ogFetchStatus: 'processed'`. Assert `body.data.ogFetchedAt` is not null and is a valid ISO date string. Then PATCH same bookmark with only `title: 'New Title'` (no ogPreview). Assert `body.data.ogFetchedAt` is still the same value (not changed by title-only update).
- [ ] Test (inside `POST /internal/bookmarks/:id/force-refresh`): `returns updated bookmark with ogFetchedAt timestamp after successful refresh` -- Create a bookmark. Call force-refresh. Assert `body.data.ogFetchedAt` is not null and is a valid ISO date string. Assert `body.data.ogFetchStatus === 'processed'`.

### Acceptance Criteria

- [ ] All new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes

---

## TASK: BK-COV-3 -- Add tests for pubsubRoutes.ts auth + error classification

### Context

The existing `pubsubRoutes.test.ts` covers PubSub push from Google (`from: 'noreply@google.com'`), auth failures, and transient vs permanent errors. Missing test coverage: (1) verifying that `from` header with a non-Google value falls through to internal auth check, (2) verifying enrichBookmark failure path returns 200 (not error), (3) verifying the summarize endpoint with storage error during findById. These exercise lines 62-79 and 182-199 auth logic more thoroughly, and line 114-127 error handling.

### Pre-conditions

- [ ] Read `apps/bookmarks-agent/src/routes/pubsubRoutes.ts` lines 62-79 (enrich auth) and 182-199 (summarize auth)
- [ ] Read `apps/bookmarks-agent/src/__tests__/pubsubRoutes.test.ts`

### Steps

1. Open `apps/bookmarks-agent/src/__tests__/pubsubRoutes.test.ts`
2. Add new test cases to existing describe blocks as specified below

### Files to Create

- None

### Files to Modify

- `apps/bookmarks-agent/src/__tests__/pubsubRoutes.test.ts` -- Add new test cases

### Test Requirements

- [ ] Test (inside `POST /internal/bookmarks/pubsub/enrich`): `rejects non-Google from header without internal auth` -- Send request with `from: 'attacker@evil.com'` (no `x-internal-auth`). Assert `statusCode === 401`. This verifies lines 63-78: the `isPubSubPush` check requires exactly `'noreply@google.com'`, so any other `from` value falls through to `validateInternalAuth`.
- [ ] Test (inside `POST /internal/bookmarks/pubsub/enrich`): `returns 200 when enrichBookmark use-case fails with storage error` -- Create a bookmark. Then `ctx.bookmarkRepository.simulateMethodError('update', { code: 'STORAGE_ERROR', message: 'DB error' })`. Send valid enrich event. Assert `statusCode === 200` and `body === { success: true }`. This verifies line 114-126: enrichment failure still returns 200 (ack to PubSub).
- [ ] Test (inside `POST /internal/bookmarks/pubsub/summarize`): `rejects non-Google from header without internal auth` -- Same as enrich: send with `from: 'attacker@evil.com'`. Assert `statusCode === 401`.
- [ ] Test (inside `POST /internal/bookmarks/pubsub/summarize`): `returns 200 when bookmark findById fails with storage error` -- `ctx.bookmarkRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' })`. Send valid summarize event. Assert `statusCode === 200` and `body === { success: true }`. This verifies lines 239-253: non-transient errors return 200.

### Acceptance Criteria

- [ ] All new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes

---

## TASK: BK-1 -- Extract image proxy from bookmarkRoutes.ts

### Context

`bookmarkRoutes.ts` is 662 lines. Lines 529-659 contain an image proxy endpoint (`GET /images/proxy`) that is conceptually separate from bookmark CRUD. This endpoint has no auth, no bookmark domain logic, and uses `fetch()` directly. It should be extracted into its own route file with an adapter behind a port interface.

### Pre-conditions

- [ ] Read `apps/bookmarks-agent/src/routes/bookmarkRoutes.ts` lines 529-662
- [ ] Read `apps/bookmarks-agent/src/__tests__/bookmarkRoutes.test.ts` -- `GET /images/proxy` tests (lines 1031-1174)
- [ ] Read `apps/bookmarks-agent/src/server.ts` to see route registration

### Steps

1. Create port interface file `apps/bookmarks-agent/src/domain/ports/imageProxy.ts`:

   ```typescript
   export interface ImageProxyError {
     code: 'INVALID_URL' | 'NOT_AN_IMAGE' | 'FETCH_FAILED' | 'TIMEOUT' | 'PROXY_ERROR';
     message: string;
     httpStatus: number;
   }

   export interface ImageProxyResult {
     buffer: Buffer;
     contentType: string;
   }

   export interface ImageProxyPort {
     proxyImage(
       url: string
     ): Promise<{ ok: true; value: ImageProxyResult } | { ok: false; error: ImageProxyError }>;
   }
   ```

2. Create infra adapter `apps/bookmarks-agent/src/infra/imageProxy/fetchImageProxy.ts`:
   - Move the `fetch()` logic from `bookmarkRoutes.ts` lines 599-657 into a function that implements `ImageProxyPort`
   - Handle URL validation (`decodeURIComponent`, protocol check) inside the adapter
   - Handle the AbortController timeout (10s)
   - Handle content-type validation (must start with `image/`)
   - Return `ImageProxyResult` on success, `ImageProxyError` on failure
   - Map error conditions: invalid URL -> `httpStatus: 400`, non-http protocol -> `httpStatus: 400`, fetch failure -> upstream status, non-image -> `httpStatus: 400`, timeout -> `httpStatus: 504`, network error -> `httpStatus: 500`

3. Create route file `apps/bookmarks-agent/src/routes/imageProxyRoutes.ts`:
   - Export `imageProxyRoutes` as `FastifyPluginCallback`
   - Register `GET /images/proxy` with the same schema as current (lines 530-566)
   - Get `imageProxy` from `getServices()`
   - Call `imageProxy.proxyImage(encodedUrl)` -- note: pass the raw query param, let the port handle decoding
   - On success: set headers (`Content-Type`, `Cache-Control: public, max-age=86400`, `Access-Control-Allow-Origin: *`) and send buffer
   - On error: send the error response with `reply.status(error.httpStatus).send({ success: false, error: { code: error.code, message: error.message } })`

4. Create fake `apps/bookmarks-agent/src/__tests__/fakeImageProxy.ts`:
   - Implement `ImageProxyPort`
   - Default: return `{ ok: true, value: { buffer: Buffer.from('fake-image'), contentType: 'image/jpeg' } }`
   - `setNextResult(result)` and `setNextError(error)` methods

5. Modify `apps/bookmarks-agent/src/services.ts`:
   - Add `imageProxy: ImageProxyPort` to `ServiceContainer` interface
   - Add `imageProxy` creation in `initServices()` using `createFetchImageProxy()` from the adapter
   - Import the new port and adapter

6. Modify `apps/bookmarks-agent/src/server.ts`:
   - Add `import { imageProxyRoutes } from './routes/imageProxyRoutes.js'`
   - Add `await app.register(imageProxyRoutes)` after the other route registrations

7. Modify `apps/bookmarks-agent/src/routes/bookmarkRoutes.ts`:
   - Remove lines 529-659 (the entire `GET /images/proxy` route handler)
   - Remove the `nock` import if it was only used for image proxy tests (check -- it isn't imported in bookmarkRoutes.ts)

8. Modify `apps/bookmarks-agent/src/__tests__/testUtils.ts`:
   - Add `FakeImageProxy` to `TestContext` interface
   - Instantiate `FakeImageProxy` in `beforeEach`
   - Add `imageProxy: context.imageProxy` to the `setServices()` call

9. Move image proxy tests from `apps/bookmarks-agent/src/__tests__/bookmarkRoutes.test.ts` (lines 1031-1174) to new `apps/bookmarks-agent/src/__tests__/imageProxyRoutes.test.ts`:
   - Rewrite tests to NOT use `nock` -- instead use `ctx.imageProxy.setNextResult()` and `ctx.imageProxy.setNextError()` for different scenarios
   - URL validation tests (invalid URL, non-http URL) should still pass since the route handler itself does URL validation before calling the port, OR the port does it (design choice: keep URL validation in the port adapter)
   - Keep the same test names and assertions where possible

10. Remove the moved tests from `bookmarkRoutes.test.ts` and remove the `nock` import and `afterEach(() => { nock.cleanAll() })` if no longer needed.

### Files to Create

- `apps/bookmarks-agent/src/domain/ports/imageProxy.ts` -- Port interface for image proxying
- `apps/bookmarks-agent/src/infra/imageProxy/fetchImageProxy.ts` -- Fetch-based adapter implementing ImageProxyPort
- `apps/bookmarks-agent/src/routes/imageProxyRoutes.ts` -- Fastify route plugin for image proxy
- `apps/bookmarks-agent/src/__tests__/fakeImageProxy.ts` -- In-memory fake for tests
- `apps/bookmarks-agent/src/__tests__/imageProxyRoutes.test.ts` -- Moved and adapted image proxy tests

### Files to Modify

- `apps/bookmarks-agent/src/services.ts` -- Add `imageProxy: ImageProxyPort` to ServiceContainer
- `apps/bookmarks-agent/src/server.ts` -- Register imageProxyRoutes
- `apps/bookmarks-agent/src/routes/bookmarkRoutes.ts` -- Remove image proxy route (lines 529-659)
- `apps/bookmarks-agent/src/__tests__/testUtils.ts` -- Add FakeImageProxy to test context
- `apps/bookmarks-agent/src/__tests__/bookmarkRoutes.test.ts` -- Remove image proxy tests (lines 1031-1174), remove `nock` import and `afterEach` cleanup

### Test Requirements

- [ ] Test: `returns proxied image with correct headers` -- via FakeImageProxy returning success
- [ ] Test: `returns 400 for missing url parameter` -- schema validation (no port call)
- [ ] Test: `returns 400 for invalid URL format` -- port returns INVALID_URL error with httpStatus 400
- [ ] Test: `returns 400 for non-http URL` -- port returns INVALID_URL error with httpStatus 400
- [ ] Test: `returns 400 for non-image content type` -- port returns NOT_AN_IMAGE error
- [ ] Test: `returns upstream error status on fetch failure` -- port returns FETCH_FAILED error
- [ ] Test: `returns 504 on timeout` -- port returns TIMEOUT error with httpStatus 504
- [ ] Test: `returns 500 on network error` -- port returns PROXY_ERROR error with httpStatus 500
- [ ] Test: `defaults to image/jpeg when content-type header is missing` -- port returns contentType `image/jpeg`

### Acceptance Criteria

- [ ] `bookmarkRoutes.ts` no longer contains image proxy code
- [ ] Image proxy tests pass using fakes (no `nock` dependency for image proxy)
- [ ] All existing bookmark CRUD tests pass unchanged
- [ ] All existing image proxy test scenarios are covered
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes

---

## TASK: BK-2 -- Move enrich publishing into createBookmark use-case

### Context

In `internalRoutes.ts` lines 220-233, after `createBookmark()` succeeds, the route handler calls `enrichPublisher.publishEnrichBookmark()`. This is domain logic leaking into the route layer. The publish-after-create logic should be part of the `createBookmark` use-case. The public `bookmarkRoutes.ts` POST `/bookmarks` (line 242) does NOT publish enrich events -- only internal creates do. This means the enrichPublisher should be an **optional** dependency of `createBookmark`.

### Pre-conditions

- [ ] Read `apps/bookmarks-agent/src/routes/internalRoutes.ts` lines 194-241
- [ ] Read `apps/bookmarks-agent/src/domain/usecases/createBookmark.ts`
- [ ] Read `apps/bookmarks-agent/src/routes/bookmarkRoutes.ts` lines 234-267 (public create -- no enrich publish)
- [ ] Read `apps/bookmarks-agent/src/infra/pubsub/enrichPublisher.ts` for `EnrichPublisher` interface

### Steps

1. Modify `apps/bookmarks-agent/src/domain/usecases/createBookmark.ts`:
   - Add optional `enrichPublisher?: EnrichPublisher` to `CreateBookmarkDeps`
   - Import `EnrichPublisher` from `../../infra/pubsub/enrichPublisher.js`
   - After successful `bookmarkRepository.create()` (line 42-48), if `deps.enrichPublisher !== undefined`, call:

     ```typescript
     const publishResult = await deps.enrichPublisher.publishEnrichBookmark({
       type: 'bookmarks.enrich',
       bookmarkId: result.value.id,
       userId: input.userId,
       url: input.url,
     });

     if (!publishResult.ok) {
       deps.logger.warn(
         { bookmarkId: result.value.id, error: publishResult.error },
         'Failed to publish enrichment event'
       );
     }
     ```

   - The publish failure should NOT change the result -- the bookmark is still created successfully (same behavior as current route handler)

2. Modify `apps/bookmarks-agent/src/routes/internalRoutes.ts`:
   - In the POST `/internal/bookmarks` handler (line 193), add `enrichPublisher` to destructured `getServices()`:
     Change `const { bookmarkRepository } = getServices();` to `const { bookmarkRepository, enrichPublisher } = getServices();`
   - Pass `enrichPublisher` to `createBookmark()` call:
     ```typescript
     const result = await createBookmark(
       { bookmarkRepository, enrichPublisher, logger: request.log },
       { ... }
     );
     ```
   - Remove lines 220-233 (the manual `enrichPublisher.publishEnrichBookmark()` call and its error handling)
   - The rest of the handler remains: `bookmarkId = result.value.id`, `bookmarkUrl`, `reply.status(201)`, `reply.ok(...)`

3. Verify `apps/bookmarks-agent/src/routes/bookmarkRoutes.ts` does NOT pass `enrichPublisher` to `createBookmark()` (line 242-253) -- it should remain as-is, with no enrichPublisher, so public creates do NOT trigger enrichment.

### Files to Create

- None

### Files to Modify

- `apps/bookmarks-agent/src/domain/usecases/createBookmark.ts` -- Add optional enrichPublisher dep and publish logic
- `apps/bookmarks-agent/src/routes/internalRoutes.ts` -- Pass enrichPublisher to createBookmark, remove manual publish call

### Test Requirements

- [ ] Existing test `creates a bookmark with valid internal auth` still passes (enrichPublisher now called inside use-case)
- [ ] Existing test `creates bookmark successfully even when enrich publish fails` still passes
- [ ] Existing test `publishes enrich event with correct shape after successful create` (from BK-COV-2) still passes
- [ ] All public bookmark route tests pass (no enrichPublisher should be called)
- [ ] Add unit test in a new file or extend existing: `createBookmark publishes enrich event when enrichPublisher is provided` -- Call `createBookmark` directly with a `FakeEnrichPublisher`. Assert event published.
- [ ] Add unit test: `createBookmark does not publish when enrichPublisher is not provided` -- Call without enrichPublisher. Assert no crash.
- [ ] Add unit test: `createBookmark succeeds even when enrichPublisher fails` -- Set `FakeEnrichPublisher.setNextError()`. Assert bookmark is still returned successfully.

### Acceptance Criteria

- [ ] The enrichPublisher call is no longer in `internalRoutes.ts`
- [ ] The enrichPublisher call is inside `createBookmark` use-case, only when `enrichPublisher` is provided
- [ ] Public bookmark creation does NOT trigger enrichment
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes

---

## TASK: BK-3 -- Extract OpenAPI config from server.ts

### Context

`server.ts` lines 28-138 contain a large `buildOpenApiOptions()` function that returns OpenAPI schema configuration (component schemas, server URLs, security schemes, tags). This is static configuration that clutters the server setup. It should be extracted to a separate config file. Note: `server.ts` is excluded from coverage, so this is purely a readability/maintainability refactor.

### Pre-conditions

- [ ] Read `apps/bookmarks-agent/src/server.ts` lines 28-138

### Steps

1. Create `apps/bookmarks-agent/src/openapi.config.ts`:
   - Move the `buildOpenApiOptions()` function (lines 28-138) to this file
   - Export it as a named export: `export function buildOpenApiOptions(): FastifyDynamicSwaggerOptions`
   - Import `type FastifyDynamicSwaggerOptions` from `@fastify/swagger`
   - Also export constants `SERVICE_NAME = 'bookmarks-agent'` and `SERVICE_VERSION = '0.0.4'` from this file

2. Modify `apps/bookmarks-agent/src/server.ts`:
   - Remove lines 28-138 (the `buildOpenApiOptions` function)
   - Remove `const SERVICE_NAME = 'bookmarks-agent'` and `const SERVICE_VERSION = '0.0.4'` (lines 23-24)
   - Remove `import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger'` (line 2) if no longer used
   - Add `import { buildOpenApiOptions, SERVICE_NAME, SERVICE_VERSION } from './openapi.config.js'`
   - Everything else remains the same -- `buildOpenApiOptions()` is still called on line 166, `SERVICE_NAME`/`SERVICE_VERSION` are still used in health check (line 231)

### Files to Create

- `apps/bookmarks-agent/src/openapi.config.ts` -- OpenAPI configuration with buildOpenApiOptions, SERVICE_NAME, SERVICE_VERSION

### Files to Modify

- `apps/bookmarks-agent/src/server.ts` -- Remove OpenAPI config, import from new module

### Test Requirements

- [ ] No new tests needed (static config, no logic, excluded from coverage via `**/server.ts` pattern)
- [ ] All existing tests pass unchanged (buildServer still works identically)

### Acceptance Criteria

- [ ] `server.ts` no longer contains OpenAPI schema definitions
- [ ] `server.ts` is approximately 100 lines shorter
- [ ] `openapi.config.ts` contains all OpenAPI configuration
- [ ] `SERVICE_NAME` and `SERVICE_VERSION` are exported from `openapi.config.ts`
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes

---

## TASK: BK-4 -- Deduplicate PubSub auth/decode in pubsubRoutes.ts

### Context

`pubsubRoutes.ts` has identical auth logic duplicated at lines 62-79 (enrich) and 182-199 (summarize), and identical Base64 decode logic at lines 81-96 (enrich) and 201-216 (summarize). Both blocks check for `from: 'noreply@google.com'` header, fall through to `validateInternalAuth`, then decode the PubSub message body. These should be extracted into shared utility functions.

### Pre-conditions

- [ ] Read `apps/bookmarks-agent/src/routes/pubsubRoutes.ts` -- full file

### Steps

1. Create `apps/bookmarks-agent/src/routes/pubsubHelpers.ts`:
   - Import `validateInternalAuth` from `@intexuraos/common-http`
   - Import `FastifyRequest, FastifyReply` from `fastify`
   - Export function `authenticatePubSub(request: FastifyRequest, reply: FastifyReply): Promise<boolean>`:

     ```typescript
     export async function authenticatePubSub(
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
         request.log.warn({ reason: authResult.reason }, `Internal auth failed for ${request.url}`);
         await reply.fail('UNAUTHORIZED', `Internal auth failed for ${request.url}`);
         return false;
       }

       return true;
     }
     ```

     Returns `true` if authenticated, `false` if reply already sent with 401.

   - Export function `decodePubSubMessage<T>(request: FastifyRequest, expectedType: string): T | null`:

     ```typescript
     interface PubSubPushMessage {
       message: {
         data: string;
         messageId: string;
         publishTime: string;
       };
       subscription: string;
     }

     export function decodePubSubMessage<T extends { type: string }>(
       request: FastifyRequest
     ): { data: T; messageId: string } | null {
       const body = request.body as PubSubPushMessage;

       try {
         const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
         const eventData = JSON.parse(decoded) as T;
         return { data: eventData, messageId: body.message.messageId };
       } catch {
         request.log.error(
           { messageId: body.message.messageId },
           'Failed to decode PubSub message'
         );
         return null;
       }
     }
     ```

2. Modify `apps/bookmarks-agent/src/routes/pubsubRoutes.ts`:
   - Import `authenticatePubSub, decodePubSubMessage` from `./pubsubHelpers.js`
   - Remove `import { validateInternalAuth } from '@intexuraos/common-http'` (no longer used directly)
   - Remove the `PubSubPushMessage` interface (moved to helpers)
   - Replace lines 62-79 in enrich handler with:
     ```typescript
     const isAuthenticated = await authenticatePubSub(request, reply);
     if (!isAuthenticated) return;
     ```
   - Replace lines 81-96 in enrich handler with:

     ```typescript
     const decoded = decodePubSubMessage<EnrichBookmarkEvent>(request);
     if (decoded === null) {
       return await reply.ok({});
     }

     const parsedType = decoded.data.type as string;
     if (parsedType !== 'bookmarks.enrich') {
       request.log.warn({ type: parsedType }, 'Unexpected event type');
       return await reply.ok({});
     }

     const eventData = decoded.data;
     ```

     Then use `decoded.messageId` instead of `body.message.messageId` in the log statement at lines 98-105.

   - Apply the same pattern to the summarize handler (lines 182-216):
     Replace auth block with `authenticatePubSub`, replace decode block with `decodePubSubMessage<SummarizeBookmarkEvent>`, check type `'bookmarks.summarize'`.

3. Adjust the warning messages: the current code has endpoint-specific messages like `'Internal auth failed for pubsub/enrich endpoint'` and `'Internal auth failed for pubsub/summarize endpoint'`. The helper uses `request.url` which will produce `/internal/bookmarks/pubsub/enrich` or `/internal/bookmarks/pubsub/summarize`. This is acceptable but slightly different. If strict message matching is needed in tests, parameterize the helper or accept the new format.

### Files to Create

- `apps/bookmarks-agent/src/routes/pubsubHelpers.ts` -- Shared PubSub auth and decode utilities

### Files to Modify

- `apps/bookmarks-agent/src/routes/pubsubRoutes.ts` -- Use shared helpers instead of inline auth/decode

### Test Requirements

- [ ] All existing `pubsubRoutes.test.ts` tests pass unchanged (the behavior is identical)
- [ ] Note: test assertions check `statusCode` not log messages, so the slightly different warning message format is fine
- [ ] Optionally add unit tests for `pubsubHelpers.ts` functions directly, but this is not required since route tests already exercise all branches

### Acceptance Criteria

- [ ] No duplicated auth or decode logic in `pubsubRoutes.ts`
- [ ] `pubsubHelpers.ts` contains `authenticatePubSub` and `decodePubSubMessage`
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes

---

## TASK: BK-5 -- Add ImageProxyPort interface

### Context

This task is a **subset** of BK-1. If BK-1 is being done, skip this task. If BK-1 is NOT being done (e.g., deferred), this task creates just the port interface without the full extraction. The image proxy in `bookmarkRoutes.ts` uses raw `fetch()` inline. This task adds the port interface definition only, as a preparatory step.

### Pre-conditions

- [ ] Confirm BK-1 is NOT being done in the same batch (otherwise skip this task entirely)
- [ ] Read `apps/bookmarks-agent/src/routes/bookmarkRoutes.ts` lines 529-659

### Steps

1. Create `apps/bookmarks-agent/src/domain/ports/imageProxy.ts`:

   ```typescript
   import type { Result } from '@intexuraos/common-core';

   export interface ImageProxyError {
     code: 'INVALID_URL' | 'NOT_AN_IMAGE' | 'FETCH_FAILED' | 'TIMEOUT' | 'PROXY_ERROR';
     message: string;
     httpStatus: number;
   }

   export interface ImageProxyResult {
     buffer: Buffer;
     contentType: string;
   }

   export interface ImageProxyPort {
     proxyImage(url: string): Promise<Result<ImageProxyResult, ImageProxyError>>;
   }
   ```

### Files to Create

- `apps/bookmarks-agent/src/domain/ports/imageProxy.ts` -- Port interface for image proxying

### Files to Modify

- None

### Test Requirements

- [ ] No tests needed (type-only file, excluded from coverage via `**/domain/**/ports/**` pattern)

### Acceptance Criteria

- [ ] Port interface file exists at the specified path
- [ ] The interface matches the error codes used in the current inline implementation
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes

---

## TASK: BK-6 -- Fix infra/summary/index.ts exports

### Context

`apps/bookmarks-agent/src/infra/summary/index.ts` currently exports `createWebAgentSummaryClient` and `WebAgentSummaryClientConfig` from `./webAgentSummaryClient.js`. However, `services.ts` imports directly from `./infra/summary/webAgentSummaryClient.js` (line 19), bypassing the barrel file. The barrel file should re-export everything that consumers need, and `services.ts` should import from the barrel.

### Pre-conditions

- [ ] Read `apps/bookmarks-agent/src/infra/summary/index.ts` (4 lines)
- [ ] Read `apps/bookmarks-agent/src/infra/summary/webAgentSummaryClient.ts` -- check what it exports
- [ ] Read `apps/bookmarks-agent/src/services.ts` line 19 -- verify it bypasses barrel

### Steps

1. Verify the current barrel `infra/summary/index.ts` already exports `createWebAgentSummaryClient` and `type WebAgentSummaryClientConfig`. The barrel content matches what `services.ts` needs.

2. Modify `apps/bookmarks-agent/src/services.ts`:
   - Change line 19 from:
     ```typescript
     import { createWebAgentSummaryClient } from './infra/summary/webAgentSummaryClient.js';
     ```
     to:
     ```typescript
     import { createWebAgentSummaryClient } from './infra/summary/index.js';
     ```
   - This uses the barrel file as intended.

3. Check if any other file imports directly from `webAgentSummaryClient.ts` bypassing the barrel. Search for `infra/summary/webAgentSummaryClient` across the app. If found, update those imports too.

### Files to Create

- None

### Files to Modify

- `apps/bookmarks-agent/src/services.ts` -- Change import to use barrel file

### Test Requirements

- [ ] No new tests needed (import path change only, same runtime behavior)
- [ ] All existing tests pass unchanged

### Acceptance Criteria

- [ ] `services.ts` imports from `./infra/summary/index.js` instead of `./infra/summary/webAgentSummaryClient.js`
- [ ] No files import directly from `webAgentSummaryClient.ts` (all go through the barrel)
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- bookmarks-agent` passes
