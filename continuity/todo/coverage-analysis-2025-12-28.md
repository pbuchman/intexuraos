# Code Coverage Analysis Report

**Generated:** 2025-12-28
**Current Coverage:** Lines 96.65%, Branches 90.11%, Functions 98.45%, Statements 97.26%
**Thresholds:** Lines 90%, Branches 90%, Functions 90%, Statements 90%

---

## Executive Summary

Coverage is **above all thresholds**. The remaining uncovered code falls into three categories:

1. **Defensive/Unreachable Code** — Should be excluded from coverage
2. **External Service Edge Cases** — Hard to test, low ROI
3. **Testable Gaps** — Can be improved with targeted tests

---

## Files with Incomplete Coverage

| File                   | Lines  | Branches | Uncovered Lines | Category                       |
| ---------------------- | ------ | -------- | --------------- | ------------------------------ |
| `auth0/client.ts`      | 100%   | 90.9%    | 102-108         | External service               |
| `encryption.ts`        | 97.14% | 92.3%    | 70              | Defensive                      |
| `deviceRoutes.ts`      | 95.52% | 85.71%   | 94, 207         | Defensive (Fastify validation) |
| `httpClient.ts`        | 100%   | 83.33%   | 43              | Testable                       |
| `oauthRoutes.ts`       | 94.73% | 94.23%   | 95-96           | Testable                       |
| `tokenRoutes.ts`       | 94.59% | 86.36%   | 83, 134         | Defensive                      |
| `statusRoutes.ts`      | 100%   | 91.66%   | 85              | Testable                       |
| `notionApi.ts`         | 94.11% | 70.83%   | 52              | External service               |
| `promptRoutes.ts`      | 82.05% | 63.88%   | multiple        | Testable                       |
| `signature.ts`         | 91.66% | 100%     | 64              | Defensive                      |
| `publisher.ts`         | 100%   | 50%      | 16              | Config                         |
| `sender.ts`            | 94.73% | 100%     | 27              | Testable                       |
| `messageRoutes.ts`     | 90.9%  | 86.66%   | multiple        | Testable                       |
| `shared.ts` (whatsapp) | 96.03% | 93.24%   | multiple        | Testable                       |
| `webhookRoutes.ts`     | 99.3%  | 84.21%   | 177             | Testable                       |
| `jwt.ts`               | 93.1%  | 81.25%   | 80, 87          | External library edge case     |
| `transcribeAudio.ts`   | 100%   | 78.12%   | multiple        | Complex async                  |

---

## Category 1: Recommend EXCLUSION from Coverage

These are defensive/unreachable code paths that cannot be reasonably tested:

### 1.1 Fastify Schema Validation Guards

**Files:** `deviceRoutes.ts:94,207`, `tokenRoutes.ts:134`
**Reason:** Fastify JSON Schema validation runs BEFORE route handler. These `handleValidationError` calls are defensive code that only executes if Fastify validation is bypassed (impossible in normal operation).

### 1.2 Buffer/Crypto Defensive Checks

**Files:** `signature.ts:64`, `encryption.ts:70`
**Reason:** `Buffer.from(hex, 'hex')` and crypto operations never throw for valid input; these are defensive guards against theoretical edge cases.

### 1.3 Jose Library Edge Cases

**Files:** `jwt.ts:80,87`, `fastifyAuthPlugin.ts:86`
**Reason:** Jose errors always have `.message` property. These guards handle theoretical library behavior changes.

### 1.4 External Service Non-JSON Response

**Files:** `auth0/client.ts:102-108`, `notionApi.ts:52`
**Reason:** Auth0/Notion always returns JSON. These guards handle server misconfiguration or proxy errors that can't be simulated in unit tests.

### 1.5 Environment Config Logging

**Files:** `publisher.ts:16`
**Reason:** `process.env['NODE_ENV'] === 'test'` branch for suppressing logs in tests.

---

## Category 2: TESTABLE - Issues to Create

### Issue 1: PromptVault Routes Coverage

**File:** `apps/promptvault-service/src/routes/promptRoutes.ts`
**Current:** 82.05% lines, 63.88% branches
**Uncovered:** 98, 281, 397, 517

**Test cases needed:**

- Token not found error path
- Config not found error path
- Notion API error handling
- Page not found scenarios

**Effort:** Medium (2-3 hours)

---

### Issue 2: WhatsApp Message Routes Coverage

**File:** `apps/whatsapp-service/src/routes/messageRoutes.ts`
**Current:** 90.9% lines, 86.66% branches
**Uncovered:** 116, 228, 318, 434

**Test cases needed:**

- Invalid message ID format
- User mapping not found
- Media URL resolution failures
- Pagination edge cases

**Effort:** Medium (2-3 hours)

---

### Issue 3: WhatsApp Shared Utilities Coverage

**File:** `apps/whatsapp-service/src/routes/shared.ts`
**Current:** 96.03% lines, 93.24% branches
**Uncovered:** 113, 341, 374, 404

**Test cases needed:**

- Response builder edge cases
- Error mapping completeness
- Schema validation branches

**Effort:** Low (1 hour)

---

### Issue 4: Transcribe Audio Branch Coverage

**File:** `apps/whatsapp-service/src/domain/inbox/usecases/transcribeAudio.ts`
**Current:** 100% lines, 78.12% branches
**Uncovered:** 169, 299-349, 419

**Test cases needed:**

- Transcription timeout handling
- Partial response scenarios
- Retry logic edge cases

**Effort:** Medium (2 hours)

---

### Issue 5: OAuth Routes Error Handling

**File:** `apps/user-service/src/routes/oauthRoutes.ts`
**Current:** 94.73% lines, 94.23% branches
**Uncovered:** 95-96

**Test cases needed:**

- Auth0 not configured scenario
- Invalid grant type handling

**Effort:** Low (30 minutes)

---

### Issue 6: Status Routes Repository Error

**File:** `apps/mobile-notifications-service/src/routes/statusRoutes.ts`
**Current:** 100% lines, 91.66% branches
**Uncovered:** 85

**Test cases needed:**

- Repository error propagation

**Effort:** Low (30 minutes)

---

### Issue 7: WhatsApp Webhook Routes Branch

**File:** `apps/whatsapp-service/src/routes/webhookRoutes.ts`
**Current:** 99.3% lines, 84.21% branches
**Uncovered:** 177

**Test cases needed:**

- Webhook type validation edge case

**Effort:** Low (30 minutes)

---

### Issue 8: WhatsApp Sender Function Coverage

**File:** `apps/whatsapp-service/src/infra/whatsapp/sender.ts`
**Current:** 94.73% lines, 100% branches
**Uncovered:** 27

**Test cases needed:**

- Message send error handling

**Effort:** Low (30 minutes)

---

### Issue 9: HTTP Client Branch Coverage

**File:** `apps/user-service/src/routes/httpClient.ts`
**Current:** 100% lines, 83.33% branches
**Uncovered:** 43

**Test cases needed:**

- Response parsing error branch

**Effort:** Low (30 minutes)

---

## Recommended Exclusions for vitest.config.ts

Add these inline comments to `vitest.config.ts` coverage exclusions:

```typescript
// JUSTIFIED: Defensive code after Fastify JSON Schema validation (unreachable)
// deviceRoutes.ts:94,207, tokenRoutes.ts:134

// JUSTIFIED: Buffer/crypto operations never throw for valid input
// signature.ts:64, encryption.ts:70

// JUSTIFIED: Jose library errors always have .message property
// jwt.ts:80,87, fastifyAuthPlugin.ts:86

// JUSTIFIED: Auth0/Notion always returns JSON, guards for proxy/server errors
// auth0/client.ts:102-108, notionApi.ts:52
```

---

## Effort Summary

| Priority | Issues                                                      | Total Effort |
| -------- | ----------------------------------------------------------- | ------------ |
| High     | 2 (promptRoutes, messageRoutes)                             | 4-6 hours    |
| Medium   | 2 (transcribeAudio, oauthRoutes)                            | 2.5 hours    |
| Low      | 5 (shared, statusRoutes, webhookRoutes, sender, httpClient) | 2.5 hours    |

**Total estimated effort:** 9-11 hours

---

## Next Steps

1. Apply recommended exclusions to `vitest.config.ts` (Category 1)
2. Create GitHub issues for Category 2 items
3. Prioritize based on risk and effort
