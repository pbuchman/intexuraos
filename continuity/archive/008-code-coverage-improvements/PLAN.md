# Execution Plan — Code Coverage Improvements

## Overview

**Goal**: Remove revoked exclusions from `vitest.config.ts` and achieve ≥90% coverage across all metrics (lines, branches, functions, statements) for 25 files totaling ~3,637 lines.

**Approach**: Test the actual infra implementations by mocking their external dependencies (Firestore SDK, GCS SDK, Pub/Sub SDK, Notion SDK, fetch API).

---

## Phase 1: Prerequisites

### Task 1.0: Create Shared Firestore Mock Utility

**File**: `packages/common/src/__tests__/firestoreMock.ts`
**Lines**: ~100
**Description**: Create a reusable mock for `getFirestore()` that returns a fake Firestore instance with controllable behavior.

```
- Mock collection(), doc(), get(), set(), update(), delete(), where(), orderBy(), limit(), startAfter()
- Support for error injection
- Export from packages/common for use across all services
```

### Task 1.1: Update vitest.config.ts (Requires Permission)

**File**: `vitest.config.ts`
**Description**: Remove the following exclusions:

- `**/infra/**`
- `**/notion.ts`
- `**/whatsappClient.ts`
- `**/workers/**`
- `**/usecases/extractLinkPreviews.ts`
- `**/statusRoutes.ts`

**Note**: Coverage will initially fail. Tests must be added before CI passes.

---

## Phase 2: Pure Unit Tests (No External Deps)

### Task 2.1: Test encryption.ts

**File**: `apps/user-service/src/__tests__/encryption.test.ts`
**Target**: `apps/user-service/src/infra/firestore/encryption.ts` (91 lines)
**Strategy**: Pure unit tests
**Test cases**:

1. `encryptToken()` returns base64 string in correct format (iv:authTag:ciphertext)
2. `decryptToken()` decrypts what `encryptToken()` produces
3. `decryptToken()` throws on malformed input
4. `decryptToken()` throws on tampered ciphertext (auth tag mismatch)
5. `generateEncryptionKey()` returns valid base64 key of correct length
6. Environment variable key is used when set
7. Dev fallback key is used when env var missing

### Task 2.2: Test extractLinkPreviews.ts

**File**: `apps/whatsapp-service/src/__tests__/usecases/extractLinkPreviews.test.ts`
**Target**: `apps/whatsapp-service/src/domain/inbox/usecases/extractLinkPreviews.ts` (186 lines)
**Strategy**: Use existing `FakeLinkPreviewFetcherPort` and `FakeWhatsAppMessageRepository`
**Test cases**:

1. No URLs in text → skips processing, logs info
2. Single URL → fetches preview, updates message with completed state
3. Multiple URLs (up to 3) → fetches all in parallel
4. More than 3 URLs → only processes first 3
5. Duplicate URLs → deduplicates before processing
6. All fetches fail → updates message with failed state
7. Partial failures → includes successful previews only
8. Unexpected error during fetch → catches and stores error state
9. URL extraction regex handles various formats (http, https, query params)

### Task 2.3: Test thumbnailGenerator.ts

**File**: `apps/whatsapp-service/src/__tests__/infra/thumbnailGenerator.test.ts`
**Target**: `apps/whatsapp-service/src/infra/media/thumbnailGenerator.ts` (72 lines)
**Strategy**: Use real sharp library with sample image buffers
**Test cases**:

1. Portrait image → resizes to max 256px height
2. Landscape image → resizes to max 256px width
3. Square image → resizes correctly
4. Already small image → still processes correctly
5. Invalid image buffer → returns error with VALIDATION_ERROR
6. Corrupted buffer → returns error with INTERNAL_ERROR

---

## Phase 3: External API Mocks (fetch-based)

### Task 3.1: Test whatsappClient.ts

**File**: `apps/whatsapp-service/src/__tests__/infra/whatsappClient.test.ts`
**Target**: `apps/whatsapp-service/src/whatsappClient.ts` (210 lines)
**Strategy**: Mock global `fetch` with nock
**Test cases**:

1. `sendWhatsAppMessage()` success → returns messageId
2. `sendWhatsAppMessage()` with contextMessageId → includes context in payload
3. `sendWhatsAppMessage()` HTTP error → returns error message
4. `sendWhatsAppMessage()` network error → returns error message
5. `getMediaUrl()` success → returns MediaUrlResponse
6. `getMediaUrl()` HTTP error → returns error
7. `downloadMedia()` success → returns buffer
8. `downloadMedia()` timeout → returns timeout error
9. `downloadMedia()` HTTP error → returns error

### Task 3.2: Test openGraphFetcher.ts

**File**: `apps/whatsapp-service/src/__tests__/infra/openGraphFetcher.test.ts`
**Target**: `apps/whatsapp-service/src/infra/linkpreview/openGraphFetcher.ts` (240 lines)
**Strategy**: Mock fetch with nock
**Test cases**:

1. Valid OG meta tags → extracts title, description, image, siteName
2. Missing OG tags with fallback → uses <title>, meta description
3. Invalid URL → returns INVALID_URL error
4. Network timeout → returns TIMEOUT error
5. HTTP error (4xx, 5xx) → returns FETCH_FAILED error
6. Invalid HTML → returns PARSE_ERROR or partial result
7. Relative image URLs → resolves to absolute
8. Large response → truncates before parsing

### Task 3.3: Test auth0/client.ts

**File**: `apps/user-service/src/__tests__/infra/auth0Client.test.ts`
**Target**: `apps/user-service/src/infra/auth0/client.ts` (135 lines)
**Strategy**: Mock fetch with nock
**Test cases**:

1. `refreshAccessToken()` success → returns RefreshResult with all fields
2. `refreshAccessToken()` invalid_grant → returns INVALID_GRANT error
3. `refreshAccessToken()` other Auth0 error → returns appropriate error code
4. `refreshAccessToken()` network error → returns NETWORK_ERROR
5. `loadAuth0Config()` with valid env vars → returns config
6. `loadAuth0Config()` with missing env vars → returns null

### Task 3.4: Test speechmatics/adapter.ts

**File**: `apps/whatsapp-service/src/__tests__/infra/speechmaticsAdapter.test.ts`
**Target**: `apps/whatsapp-service/src/infra/speechmatics/adapter.ts` (288 lines)
**Strategy**: Mock fetch with nock for Speechmatics API
**Test cases**:

1. `submitJob()` success → returns job ID
2. `submitJob()` API error → returns appropriate error
3. `pollJobStatus()` pending → returns pending status
4. `pollJobStatus()` completed → returns completed with transcript URL
5. `pollJobStatus()` failed → returns failed status
6. `getTranscript()` success → returns transcript text
7. Full workflow: submit → poll → get transcript

---

## Phase 4: SDK Mocks (Firestore, GCS, Pub/Sub)

### Task 4.1: Test Firestore Repositories (7 files)

For each repository, create tests using the shared Firestore mock:

**4.1.1**: `apps/user-service/src/__tests__/infra/authTokenRepository.test.ts`

- Target: `authTokenRepository.ts` (162 lines)
- Test cases: saveTokens, getTokenMetadata, getRefreshToken, deleteTokens, error paths

**4.1.2**: `apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts`

- Target: `firestoreNotificationRepository.ts` (210 lines)
- Test cases: save, findById, findByUserIdPaginated (with cursor), delete, deleteByUserId

**4.1.3**: `apps/mobile-notifications-service/src/__tests__/infra/firestoreSignatureConnectionRepository.test.ts`

- Target: `firestoreSignatureConnectionRepository.ts` (189 lines)
- Test cases: save, findBySignatureHash, findByUserId, delete, deleteByUserId, existsByUserId

**4.1.4**: `apps/notion-service/src/__tests__/infra/notionConnectionRepository.test.ts`

- Target: `notionConnectionRepository.ts` (142 lines)
- Test cases: saveNotionConnection, getNotionConnection, getNotionToken, isNotionConnected, disconnectNotion

**4.1.5**: `apps/promptvault-service/src/__tests__/infra/notionConnectionRepository.test.ts`

- Target: `notionConnectionRepository.ts` (142 lines)
- Note: This is a duplicate of 4.1.4. Consider refactoring to shared module.

**4.1.6**: `apps/whatsapp-service/src/__tests__/infra/messageRepository.test.ts`

- Target: `messageRepository.ts` (257 lines)
- Test cases: save, findById, findByUserId (paginated), updateTranscription, updateLinkPreview, delete

**4.1.7**: `apps/whatsapp-service/src/__tests__/infra/userMappingRepository.test.ts`

- Target: `userMappingRepository.ts` (169 lines)
- Test cases: save, findByPhone, findByUserId, delete

**4.1.8**: `apps/whatsapp-service/src/__tests__/infra/webhookEventRepository.test.ts`

- Target: `webhookEventRepository.ts` (112 lines)
- Test cases: save, findById, updateStatus

### Task 4.2: Test GCS Adapter

**File**: `apps/whatsapp-service/src/__tests__/infra/mediaStorageAdapter.test.ts`
**Target**: `apps/whatsapp-service/src/infra/gcs/mediaStorageAdapter.ts` (149 lines)
**Strategy**: Mock @google-cloud/storage
**Test cases**:

1. `upload()` success → returns gcsPath
2. `upload()` error → returns PERSISTENCE_ERROR
3. `uploadThumbnail()` success → returns gcsPath with \_thumb suffix
4. `delete()` success → returns ok
5. `delete()` with ignoreNotFound → succeeds even if file missing
6. `getSignedUrl()` success → returns URL
7. `getSignedUrl()` with custom TTL

### Task 4.3: Test Pub/Sub Publisher

**File**: `apps/whatsapp-service/src/__tests__/infra/publisher.test.ts`
**Target**: `apps/whatsapp-service/src/infra/pubsub/publisher.ts` (57 lines)
**Strategy**: Mock @google-cloud/pubsub
**Test cases**:

1. `publish()` success → returns message ID
2. `publish()` error → returns PUBLISH_ERROR
3. Event serialization is correct

### Task 4.4: Test Cleanup Worker

**File**: `apps/whatsapp-service/src/__tests__/infra/cleanupWorker.test.ts`
**Target**: `apps/whatsapp-service/src/workers/cleanupWorker.ts` (189 lines)
**Strategy**: Mock @google-cloud/pubsub subscription
**Test cases**:

1. `start()` sets up subscription listener
2. `start()` when already running → no-op
3. `stop()` closes subscription
4. Message handler parses event and calls mediaStorage.delete()
5. Invalid message → nacks and logs error
6. mediaStorage.delete() failure → nacks message
7. Subscription error → logs error

---

## Phase 5: Notion SDK Mocks

### Task 5.1: Test packages/common/src/notion.ts

**File**: `packages/common/src/__tests__/notion.test.ts` (extend existing)
**Target**: `packages/common/src/notion.ts` (175 lines)
**Strategy**: Mock @notionhq/client
**Test cases** (may already exist, verify and add missing):

1. `mapNotionError()` maps Unauthorized
2. `mapNotionError()` maps ObjectNotFound
3. `mapNotionError()` maps RateLimited
4. `mapNotionError()` maps ValidationError
5. `mapNotionError()` maps unknown errors to INTERNAL_ERROR
6. `createNotionClient()` without logger → returns basic client
7. `createNotionClient()` with logger → returns client with logging fetch
8. Logging fetch logs requests and responses
9. Logging fetch logs errors

### Task 5.2: Test notion-service/infra/notion/notionApi.ts

**File**: `apps/notion-service/src/__tests__/infra/notionApi.test.ts`
**Target**: `apps/notion-service/src/infra/notion/notionApi.ts` (96 lines)
**Strategy**: Mock createNotionClient
**Test cases**:

1. `validateNotionToken()` valid → returns ok(true)
2. `validateNotionToken()` invalid (UNAUTHORIZED) → returns ok(false)
3. `validateNotionToken()` other error → returns err
4. `getPageWithPreview()` success → returns page data with blocks
5. `getPageWithPreview()` page not found → returns NOT_FOUND error
6. Title extraction from various property names

### Task 5.3: Test promptvault-service/infra/notion/promptApi.ts

**File**: `apps/promptvault-service/src/__tests__/infra/promptApi.test.ts`
**Target**: `apps/promptvault-service/src/infra/notion/promptApi.ts` (471 lines)
**Strategy**: Mock createNotionClient + mock Firestore (for getUserContext)
**Test cases**:

1. `createPrompt()` success → creates page with code blocks
2. `createPrompt()` with long content → splits into chunks
3. `createPrompt()` not connected → returns NOT_CONNECTED
4. `getPrompt()` success → returns prompt with joined content
5. `getPrompt()` not found → returns NOT_FOUND
6. `listPrompts()` success → returns paginated prompts
7. `updatePrompt()` success → archives old blocks, creates new
8. `deletePrompt()` success → archives page
9. Text chunking respects paragraph boundaries
10. Text joining handles multiple code blocks

---

## Phase 6: Adapter Wrappers

### Task 6.1: Test thumbnailAdapter.ts

**File**: `apps/whatsapp-service/src/__tests__/infra/thumbnailAdapter.test.ts`
**Target**: `apps/whatsapp-service/src/infra/media/thumbnailAdapter.ts` (36 lines)
**Strategy**: This is a thin wrapper, test via integration or skip if covered by thumbnailGenerator tests

### Task 6.2: Test cloudApiAdapter.ts

**File**: `apps/whatsapp-service/src/__tests__/infra/cloudApiAdapter.test.ts`
**Target**: `apps/whatsapp-service/src/infra/whatsapp/cloudApiAdapter.ts` (78 lines)
**Strategy**: Mock whatsappClient functions
**Test cases**:

1. `getMediaUrl()` delegates to whatsappClient
2. `downloadMedia()` delegates to whatsappClient
3. Error mapping from whatsappClient responses

### Task 6.3: Test sender.ts

**File**: `apps/whatsapp-service/src/__tests__/infra/sender.test.ts`
**Target**: `apps/whatsapp-service/src/infra/whatsapp/sender.ts` (80 lines)
**Strategy**: Mock whatsappClient functions
**Test cases**:

1. `sendMessage()` delegates to sendWhatsAppMessage
2. `sendMessage()` with reply context
3. Error mapping from whatsappClient responses

---

## Phase 7: Verification & Cleanup

### Task 7.1: Run Full Coverage

```bash
npm run test -- --coverage
```

### Task 7.2: Update Coverage Thresholds (Requires Permission)

If all tests pass with ≥90% coverage, update `vitest.config.ts` thresholds:

- branches: 90 (currently 81)

### Task 7.3: Update .github/copilot-instructions.md (Requires Permission)

Add coverage enforcement rules per original orchestration task.

### Task 7.4: Archive Continuity Directory

Move `continuity/008-code-coverage-improvements/` to `continuity/archive/`

---

## Execution Order (Optimized for Dependencies)

1. **Task 1.0**: Firestore mock utility (prerequisite for many tests)
2. **Task 2.1-2.3**: Pure unit tests (no dependencies)
3. **Task 3.1-3.4**: Fetch-based API mocks
4. **Task 4.1-4.4**: SDK mocks (Firestore, GCS, Pub/Sub)
5. **Task 5.1-5.3**: Notion SDK mocks
6. **Task 6.1-6.3**: Adapter wrappers
7. **Task 1.1**: Remove vitest exclusions (after tests ready)
8. **Task 7.1-7.4**: Verification and cleanup

---

## Estimated Effort

| Phase     | Tasks  | Est. Test Files | Est. Test Cases | Est. Hours |
| --------- | ------ | --------------- | --------------- | ---------- |
| 1         | 2      | 1               | 0               | 1          |
| 2         | 3      | 3               | ~25             | 3          |
| 3         | 4      | 4               | ~35             | 4          |
| 4         | 9      | 9               | ~60             | 8          |
| 5         | 3      | 3               | ~25             | 4          |
| 6         | 3      | 3               | ~10             | 2          |
| 7         | 4      | 0               | 0               | 1          |
| **Total** | **28** | **23**          | **~155**        | **~23**    |

---

## Risks & Mitigations

1. **Risk**: Firestore mock complexity
   **Mitigation**: Start with simple mock, extend as needed

2. **Risk**: Notion SDK internal changes break mocks
   **Mitigation**: Mock at createNotionClient level, not deep internals

3. **Risk**: Coverage still below 90% after all tests
   **Mitigation**: Identify remaining uncovered lines, add edge case tests

4. **Risk**: Test flakiness due to timing
   **Mitigation**: Use deterministic mocks, avoid real timeouts
