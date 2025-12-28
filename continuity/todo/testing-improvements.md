# Testing Improvements Backlog

Created: 2025-12-28
Status: TODO

## Overview

This document tracks test coverage gaps identified during coverage analysis. Current branch coverage is **85.14%** (threshold: 90%). These tasks describe tests that can be added to improve coverage.

---

## Priority 1: Route Error Handling Tests

### Task 1.1: Auth Service - Device Routes Tests
**File:** `apps/auth-service/src/routes/deviceRoutes.ts`
**Uncovered Lines:** 94, 207, 317
**Effort:** Medium

Add tests for:
- [ ] Device registration validation failures
- [ ] Device update error responses
- [ ] Device deletion edge cases

**Test file:** `apps/auth-service/src/__tests__/deviceRoutes.test.ts`

---

### Task 1.2: Auth Service - OAuth Routes Tests
**File:** `apps/auth-service/src/routes/oauthRoutes.ts`
**Uncovered Lines:** 137, 164, 181-182
**Effort:** Medium

Add tests for:
- [ ] OAuth callback error handling
- [ ] Token exchange failures
- [ ] State validation errors

**Test file:** `apps/auth-service/src/__tests__/oauthRoutes.test.ts`

---

### Task 1.3: Notion Service - Notification Routes Tests
**File:** `apps/notion-service/src/routes/notificationRoutes.ts`
**Uncovered Lines:** 73, 104, 117, 184, 250
**Effort:** Medium

Add tests for:
- [ ] Notification creation validation errors
- [ ] Notification retrieval failures
- [ ] Notification update error paths
- [ ] Authorization failures

**Test file:** `apps/notion-service/src/__tests__/notificationRoutes.test.ts`

---

### Task 1.4: Notion Service - Webhook Routes Tests
**File:** `apps/notion-service/src/routes/webhookRoutes.ts`
**Uncovered Lines:** 61
**Effort:** Low

Add tests for:
- [ ] Webhook validation error responses

**Test file:** `apps/notion-service/src/__tests__/webhookRoutes.test.ts`

---

### Task 1.5: Mobile Notifications - Route Error Tests
**Files:**
- `notificationRoutes.ts` (line 85)
- `statusRoutes.ts` (line 85)
- `webhookRoutes.ts` (lines 130-134)

**Effort:** Low

Add tests for:
- [ ] Notification listing repository errors
- [ ] Status check repository errors
- [ ] Webhook processing error branches

**Test file:** `apps/mobile-notifications-service/src/__tests__/routes.test.ts`

---

## Priority 2: WhatsApp Service Route Tests

### Task 2.1: WhatsApp - Mapping Routes Tests
**File:** `apps/whatsapp-service/src/routes/mappingRoutes.ts`
**Branch Coverage:** 55.55%
**Uncovered Lines:** 146-158, 232, 305
**Effort:** High

Add tests for:
- [ ] Phone mapping creation errors
- [ ] Phone mapping update failures
- [ ] Phone mapping deletion edge cases
- [ ] Validation error responses

**Test file:** `apps/whatsapp-service/src/__tests__/routes/mappingRoutes.test.ts`

---

### Task 2.2: WhatsApp - Message Routes Tests
**File:** `apps/whatsapp-service/src/routes/messageRoutes.ts`
**Branch Coverage:** 80%
**Uncovered Lines:** 134, 454, 544, 569
**Effort:** High

Add tests for:
- [ ] Message sending validation errors
- [ ] Media message error handling
- [ ] Reply message failures
- [ ] Rate limiting responses

**Test file:** `apps/whatsapp-service/src/__tests__/routes/messageRoutes.test.ts`

---

### Task 2.3: WhatsApp - Webhook Routes Tests
**File:** `apps/whatsapp-service/src/routes/webhookRoutes.ts`
**Branch Coverage:** 76.84%
**Uncovered Lines:** 263, 457, 623-630
**Effort:** High

Add tests for:
- [ ] Webhook signature validation failures
- [ ] Unknown message type handling
- [ ] Status update processing errors
- [ ] Error recovery paths

**Test file:** `apps/whatsapp-service/src/__tests__/routes/webhookRoutes.test.ts`

---

## Priority 3: Use Case Error Path Tests

### Task 3.1: WhatsApp - Process Audio Message Tests
**File:** `apps/whatsapp-service/src/domain/inbox/usecases/processAudioMessage.ts`
**Uncovered Lines:** 84, 222-225
**Effort:** Medium

Add tests for:
- [ ] Transcription service failure handling
- [ ] Audio format validation errors
- [ ] Storage upload failures

**Test file:** `apps/whatsapp-service/src/__tests__/usecases/processAudioMessage.test.ts`

---

### Task 3.2: WhatsApp - Process Webhook Tests
**File:** `apps/whatsapp-service/src/domain/inbox/usecases/processWhatsAppWebhook.ts`
**Uncovered Lines:** 184, 298, 332, 355
**Effort:** High

Add tests for:
- [ ] Unknown webhook event types
- [ ] Partial event processing failures
- [ ] Event deduplication edge cases
- [ ] Repository error handling

**Test file:** `apps/whatsapp-service/src/__tests__/processWhatsAppWebhook.test.ts`

---

### Task 3.3: WhatsApp - Transcribe Audio Tests
**File:** `apps/whatsapp-service/src/domain/inbox/usecases/transcribeAudio.ts`
**Uncovered Lines:** 396-405
**Effort:** Medium

Add tests for:
- [ ] Transcription retry logic
- [ ] Timeout handling
- [ ] Service unavailable responses

**Test file:** `apps/whatsapp-service/src/__tests__/usecases/transcribeAudio.test.ts`

---

### Task 3.4: WhatsApp - Extract Link Previews Tests
**File:** `apps/whatsapp-service/src/domain/inbox/usecases/extractLinkPreviews.ts`
**Uncovered Lines:** 169
**Effort:** Low

Add tests for:
- [ ] Open Graph fetch timeout
- [ ] Invalid HTML response handling

**Test file:** `apps/whatsapp-service/src/__tests__/usecases/extractLinkPreviews.test.ts`

---

### Task 3.5: WhatsApp - Process Image Message Tests
**File:** `apps/whatsapp-service/src/domain/inbox/usecases/processImageMessage.ts`
**Uncovered Lines:** 288
**Effort:** Low

Add tests for:
- [ ] Image processing fallback paths

**Test file:** `apps/whatsapp-service/src/__tests__/usecases/processImageMessage.test.ts`

---

## Priority 4: Infrastructure Tests

### Task 4.1: Auth Service - HTTP Client Tests
**File:** `apps/auth-service/src/routes/httpClient.ts`
**Uncovered Lines:** 26-43
**Effort:** Medium

Add tests for:
- [ ] Request timeout handling
- [ ] Network error responses
- [ ] Retry logic

**Test file:** `apps/auth-service/src/__tests__/httpClient.test.ts`

---

### Task 4.2: WhatsApp - Firestore Repository Tests
**Files:**
- `whatsappWebhookEventRepository.ts` (lines 174, 213, 241, 252)
- `whatsappMessageRepository.ts` (line 39)
- `phoneMappingRepository.ts` (line 83)

**Effort:** Medium

Add tests for:
- [ ] Firestore error handling in event storage
- [ ] Message retrieval failures
- [ ] Phone mapping lookup errors

**Test file:** `apps/whatsapp-service/src/__tests__/infra/repositories.test.ts`

---

### Task 4.3: WhatsApp - Link Preview Fetcher Tests
**File:** `apps/whatsapp-service/src/infra/linkpreview/openGraphFetcher.ts`
**Uncovered Lines:** 137, 154-157, 234
**Effort:** Medium

Add tests for:
- [ ] HTML parsing edge cases
- [ ] Meta tag extraction failures
- [ ] Malformed HTML handling

**Test file:** `apps/whatsapp-service/src/__tests__/infra/openGraphFetcher.test.ts`

---

## Excluded from Testing (Documented Justification)

The following items should be excluded from coverage with documented justification rather than adding tests:

### Defensive/Unreachable Code
- `tokenRoutes.ts:134` — Unreachable after `isErr()` check
- `signature.ts:64` — `Buffer.from(hex)` never throws
- `encryption.ts:70` — Defensive data integrity check
- `fastifyAuthPlugin.ts:86` — All jose errors have `.message`
- `jwt.ts:80,87` — Jose library edge cases

### External Service Error Paths
- `auth0/client.ts:102-108` — Auth0 non-JSON response
- `notionApi.ts:52` — Notion API errors
- `thumbnailGenerator.ts:47` — Sharp library errors

### Firestore Defensive Checks
- `firestoreSignatureConnectionRepository.ts:81,120` — `noUncheckedIndexedAccess` guards

---

## Effort Estimates

| Priority | Tasks | Total Effort |
|----------|-------|--------------|
| P1: Route Error Handling | 5 tasks | ~3-4 hours |
| P2: WhatsApp Routes | 3 tasks | ~6-8 hours |
| P3: Use Case Errors | 5 tasks | ~4-5 hours |
| P4: Infrastructure | 3 tasks | ~3-4 hours |

**Total estimated effort:** 16-21 hours

---

## Implementation Notes

1. Each task should be done as a separate PR
2. Run `npm run test:coverage` after each task to verify improvement
3. Update this document when tasks are completed
4. Consider adding coverage exclusions for items in "Excluded from Testing" section first to establish baseline

