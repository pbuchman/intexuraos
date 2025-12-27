# Coverage Improvement Ledger

## Session Log

### 2024-12-27 — Session Start

**Phase 0: Initialization**
- ✅ Read `.github/copilot-instructions.md` (442 lines)
- ✅ Read `vitest.config.ts` (104 lines)
- ✅ Confirmed constraints and revoked exclusions
- ✅ Created continuity directory `008-code-coverage-improvements`
- ✅ Completed full file inventory and line counts
- ✅ Identified existing fakes that can be reused

**Baseline Coverage (before exclusion removal):**

| Metric     | Value  | Target | Status |
|------------|--------|--------|--------|
| Lines      | 90%    | 90%    | ✅     |
| Branches   | 81.74% | 90%    | ❌     |
| Functions  | 97.61% | 90%    | ✅     |
| Statements | 90.6%  | 90%    | ✅     |

**Current thresholds in vitest.config.ts:**
- lines: 90
- branches: 81
- functions: 90
- statements: 89

---

## Complete File Inventory

### Files Under Revoked Exclusions (25 files, ~3,637 lines total)

#### `**/infra/**` Pattern (20 files, 2,976 lines)

| # | Service | File | Lines | Test Strategy |
|---|---------|------|-------|---------------|
| 1 | auth-service | `infra/auth0/client.ts` | 135 | Mock fetch, test token refresh flow |
| 2 | auth-service | `infra/firestore/authTokenRepository.ts` | 162 | Mock Firestore via @intexuraos/common |
| 3 | auth-service | `infra/firestore/encryption.ts` | 91 | Pure unit tests (no mocks needed) |
| 4 | mobile-notifications | `infra/firestore/firestoreNotificationRepository.ts` | 210 | Mock Firestore |
| 5 | mobile-notifications | `infra/firestore/firestoreSignatureConnectionRepository.ts` | 189 | Mock Firestore |
| 6 | notion-service | `infra/firestore/notionConnectionRepository.ts` | 142 | Mock Firestore |
| 7 | notion-service | `infra/notion/notionApi.ts` | 96 | Mock Notion client |
| 8 | promptvault-service | `infra/firestore/notionConnectionRepository.ts` | 142 | Mock Firestore (duplicate of notion-service) |
| 9 | promptvault-service | `infra/notion/promptApi.ts` | 471 | Mock Notion client + mock Firestore |
| 10 | whatsapp-service | `infra/firestore/messageRepository.ts` | 257 | Mock Firestore |
| 11 | whatsapp-service | `infra/firestore/userMappingRepository.ts` | 169 | Mock Firestore |
| 12 | whatsapp-service | `infra/firestore/webhookEventRepository.ts` | 112 | Mock Firestore |
| 13 | whatsapp-service | `infra/gcs/mediaStorageAdapter.ts` | 149 | Mock @google-cloud/storage |
| 14 | whatsapp-service | `infra/linkpreview/openGraphFetcher.ts` | 240 | Mock fetch |
| 15 | whatsapp-service | `infra/media/thumbnailAdapter.ts` | 36 | Mock ThumbnailGenerator |
| 16 | whatsapp-service | `infra/media/thumbnailGenerator.ts` | 72 | Real sharp tests with sample images |
| 17 | whatsapp-service | `infra/pubsub/publisher.ts` | 57 | Mock @google-cloud/pubsub |
| 18 | whatsapp-service | `infra/speechmatics/adapter.ts` | 288 | Mock fetch for Speechmatics API |
| 19 | whatsapp-service | `infra/whatsapp/cloudApiAdapter.ts` | 78 | Mock whatsappClient functions |
| 20 | whatsapp-service | `infra/whatsapp/sender.ts` | 80 | Mock whatsappClient functions |

#### Other Revoked Exclusions (5 files, 661 lines)

| # | Pattern | File | Lines | Test Strategy |
|---|---------|------|-------|---------------|
| 21 | `**/notion.ts` | `packages/common/src/notion.ts` | 175 | Mock @notionhq/client, test error mapping |
| 22 | `**/whatsappClient.ts` | `apps/whatsapp-service/src/whatsappClient.ts` | 210 | Mock fetch for Graph API |
| 23 | `**/workers/**` | `apps/whatsapp-service/src/workers/cleanupWorker.ts` | 189 | Mock @google-cloud/pubsub |
| 24 | `**/extractLinkPreviews.ts` | `apps/whatsapp-service/src/domain/inbox/usecases/extractLinkPreviews.ts` | 186 | Use existing fakes |
| 25 | `**/statusRoutes.ts` | `apps/mobile-notifications-service/src/routes/statusRoutes.ts` | 101 | ✅ **Already has tests** (created this session) |

---

## Existing Test Infrastructure

### Fakes Available (15 fake classes)

| Fake Class | Service | Can Test |
|------------|---------|----------|
| `FakeAuth0Client` | auth-service | auth0/client.ts indirectly |
| `FakeAuthTokenRepository` | auth-service | routes (not infra directly) |
| `FakeEventPublisher` | whatsapp-service | pubsub/publisher.ts indirectly |
| `FakeLinkPreviewFetcherPort` | whatsapp-service | extractLinkPreviews.ts |
| `FakeMediaStorage` | whatsapp-service | gcs/mediaStorageAdapter.ts indirectly |
| `FakeMessageSender` | whatsapp-service | whatsapp/sender.ts indirectly |
| `FakeNotificationRepository` | mobile-notifications | routes (not infra directly) |
| `FakeNotionConnectionRepository` | promptvault/notion | notionConnectionRepository.ts indirectly |
| `FakeSignatureConnectionRepository` | mobile-notifications | routes (not infra directly) |
| `FakeSpeechTranscriptionPort` | whatsapp-service | speechmatics/adapter.ts indirectly |
| `FakeThumbnailGeneratorPort` | whatsapp-service | media/thumbnailAdapter.ts indirectly |
| `FakeWhatsAppCloudApiPort` | whatsapp-service | cloudApiAdapter.ts indirectly |
| `FakeWhatsAppMessageRepository` | whatsapp-service | routes (not infra directly) |
| `FakeWhatsAppUserMappingRepository` | whatsapp-service | routes (not infra directly) |
| `FakeWhatsAppWebhookEventRepository` | whatsapp-service | routes (not infra directly) |

### Test Utilities Available

| Service | File | Capabilities |
|---------|------|--------------|
| promptvault-service | `__tests__/testUtils.ts` | JWKS server, createToken() |
| whatsapp-service | `__tests__/testUtils.ts` | JWKS server, createToken(), setupTestContext() |
| notion-service | `__tests__/testUtils.ts` | JWKS server, createToken() |
| mobile-notifications | `__tests__/testUtils.ts` | ✅ **Created this session** |

---

## State

- **Done**: Phase 0 (initialization), File inventory, Analysis
- **Now**: Awaiting plan approval
- **Next**: Execute approved plan

---

## Open Questions for User

1. **Firestore mocking strategy**: Mock `getFirestore()` from `@intexuraos/common` vs. create fake Firestore? The former tests the actual implementation, the latter is simpler.

2. **Scope clarification**: Files 8 (`promptvault-service/infra/firestore/notionConnectionRepository.ts`) is a **duplicate** of file 6 (`notion-service/infra/firestore/notionConnectionRepository.ts`). Should this be refactored to a shared module first, or tested as-is?

3. **Priority ordering**: Should I optimize for quick wins first, or tackle hardest files first?
