# User Service - Technical Debt

**Last Updated:** 2026-02-22
**Analysis Run:** [2026-02-22 entry](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 1     | Low      |
| Code Duplicates     | 1     | Low      |
| Deprecations        | 0     | -        |
| **Total**           | **2** | Low      |

---

## Future Plans

### Additional OAuth Providers

Currently only Google OAuth is implemented. Planned additions:

1. **Microsoft OAuth** - For calendar/email integration with Outlook
2. **GitHub OAuth** - For developer-focused features and code integration
3. **Notion OAuth** - For notes sync

### Enhanced API Key Features

1. **Usage analytics** - Track API call volume and costs per user per provider
2. **Key rotation** - Automatic key expiration warnings and renewal prompts
3. **Budget alerts** - Warn users when approaching provider spending limits
4. **Rate limiting** - Per-user or per-key request limits to prevent abuse

### Authentication Enhancements

1. **Multi-factor authentication** - Optional 2FA via Auth0
2. **Session management** - View and revoke active sessions
3. **Passwordless email magic links** - Alternative to device code flow

### Error Formatting Improvements

1. **Perplexity-specific parsing** - Currently falls through to generic parser
2. **Zai-specific parsing** - Currently falls through to generic parser
3. **Structured error responses** - Include error codes alongside messages

---

## SRP Violations

| File                                  | Lines | Issue                                         | Suggestion                                   |
| ------------------------------------- | ----- | --------------------------------------------- | -------------------------------------------- |
| `src/routes/llmKeysRoutes.ts`         | 569   | Handles GET, PATCH, POST, DELETE in one file  | Acceptable: routes are cohesive by resource  |

The `llmKeysRoutes.ts` file is large but all routes are cohesive around the LLM keys resource. Splitting would scatter related logic across files without clear benefit.

---

## Code Duplicates

### Acknowledged Pattern: LlmValidatorImpl

The `LlmValidatorImpl.ts` (256 lines) contains similar code blocks for each provider (5 providers x 2 methods = 10 similar blocks). This is intentional for:

- Clear debugging (each provider's logic is isolated)
- Easy addition of new providers
- Provider-specific error handling

Not considered actionable debt as the pattern is explicit and maintainable.

---

## Test Coverage

### Current Status

Comprehensive test coverage across all layers with 100% branch coverage enforcement:

- **formatLlmError()**: 100% branch coverage with 35+ test cases
- **Authentication flows**: Device code, refresh, OAuth fully tested
- **Settings management**: CRUD operations tested
- **Encryption**: AES-256-GCM encryption/decryption tested
- **Internal endpoints**: Auth validation and all 4 endpoints tested
- **Default model**: Validation and persistence tested

### Test Files

| Test File                             | Coverage Area                             |
| ------------------------------------- | ----------------------------------------- |
| `configRoutes.test.ts`                | Auth0 config endpoint                     |
| `deviceRoutes.test.ts`                | Device code flow (start + poll)           |
| `tokenRoutes.test.ts`                 | Token refresh                             |
| `firebaseRoutes.test.ts`              | Firebase token exchange                   |
| `frontendRoutes.test.ts`              | Login/logout/me endpoints                 |
| `oauthRoutes.test.ts`                 | OAuth2 token/authorize (ChatGPT Actions)  |
| `oauthConnectionRoutes.test.ts`       | Google OAuth connection management        |
| `settingsRoutes.test.ts`              | User settings + default model             |
| `llmKeysRoutes.test.ts`               | LLM key CRUD + test                       |
| `internalRoutes.test.ts`              | Service-to-service endpoints              |
| `formatLlmError.test.ts`              | Provider error parsing                    |
| `encryption.test.ts`                  | AES-256-GCM encrypt/decrypt               |
| `auth0Client.test.ts`                 | Auth0 SDK wrapper                         |
| `authTokenRepository.test.ts`         | Firestore token storage                   |
| `userSettingsRepository.test.ts`      | Firestore settings storage                |
| `oauthConnectionRepository.test.ts`   | Firestore OAuth storage                   |
| `googleOAuthClient.test.ts`           | Google OAuth client                       |
| `llmValidator.test.ts`                | LLM key validation (5 providers)          |
| `maskApiKey.test.ts`                  | Key masking utility                       |

---

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found in production code.

---

## TODO/FIXME Comments

### None Detected

No TODO, FIXME, HACK, or XXX comments found in the codebase.

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Recent Changes

### v3.1.0 (2026-02-22)

Release version bump only. No functional changes to user-service code.

### v3.0.0 (2026-02-19)

Release version bump only. No functional changes to user-service code.

### Dash0 OpenTelemetry Integration (2026-02-16)

**Change:** Added `@intexuraos/infra-otel` dependency and preloaded it via `node --import ./dist/otel-register.js` in the Dockerfile. Exports traces, metrics, and structured logs to Dash0 via OTLP/HTTP. No-op when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is unset, so local and test environments are unaffected.

**Files changed:**

- `apps/user-service/Dockerfile`
- `apps/user-service/package.json`

### Default Model Selector (2026-02-08)

**Change:** Added `PATCH /users/:uid/settings` endpoint that accepts `{ defaultModel: string }` and persists user LLM preferences to Firestore. Validates the model against `isFastModel()` from `@intexuraos/llm-contract`. Services call the internal `/internal/users/:uid/settings` endpoint to read `llmPreferences.defaultModel` at request time. The `GET /users/:uid/settings/llm-keys` response was also extended to include `defaultModel` as a convenience field.

**Files changed:**

- `apps/user-service/src/routes/settingsRoutes.ts`
- `apps/user-service/src/__tests__/settingsRoutes.test.ts`
- `apps/user-service/src/__tests__/fakes.ts`

### Dev-Mode Log Formatting (2026-02-16)

**Change:** Improved PM2 log readability in development environments with structured formatting.

### Standardized Response Contract and Sentry Logger Migration (2026-02-08)

**Problem:** Internal endpoints used ad-hoc response formats (`{ error: 'Unauthorized' }`, `{ error: message, code: errorCode }`) with manual `reply.status()` calls instead of the standardized response contract.

**Fix:** All internal endpoints migrated to use `reply.ok(data)` and `reply.fail(code, message)`. Error codes standardized: `CONFIGURATION_ERROR` -> `MISCONFIGURED`, `CONNECTION_NOT_FOUND` -> `NOT_FOUND`, `TOKEN_REFRESH_FAILED` -> `DOWNSTREAM_ERROR`. HTTP status codes corrected: misconfiguration errors return 503 instead of 500, downstream failures return 502 instead of 500. Delete endpoints return `reply.ok({})` instead of `reply.ok(undefined)`.

**Files changed:**

- `apps/user-service/src/routes/internalRoutes.ts`
- `apps/user-service/src/routes/llmKeysRoutes.ts`
- `apps/user-service/src/routes/oauthConnectionRoutes.ts`
- `apps/user-service/src/routes/oauthRoutes.ts`
- `apps/user-service/src/__tests__/internalRoutes.test.ts`
- `apps/user-service/src/__tests__/oauthConnectionRoutes.test.ts`

**Impact:** All internal endpoints now return `{ success: true, data: ... }` or `{ success: false, error: { code, message } }` consistently.

### Auth0 Namespaced JWT Claims (2026-02-08)

**Problem:** Auth0 Actions add user profile claims under a custom namespace (`https://intexuraos.cloud/email`) for API audience tokens. The `/auth/me` endpoint only read bare claims, causing missing profile data.

**Fix:** `frontendRoutes.ts` now tries namespaced claims first, then falls back to bare claims for ID tokens.

**Files changed:**

- `apps/user-service/src/routes/frontendRoutes.ts`

### Sentry-Enabled Logger Migration (2026-02-08)

**Problem:** Direct `pino()` logger usage bypassed Sentry error tracking integration.

**Fix:** Replaced `pino()` with `createAppLogger()` from `@intexuraos/infra-sentry` in `services.ts`.

**Files changed:**

- `apps/user-service/src/services.ts`

### 100% Coverage Enforcement (Phase 3) (2026-02-01)

**Problem:** Strict 100% branch coverage enforcement required coverage annotations for unreachable branches.

**Fix:** Added categorized `v8 ignore` annotations for TypeScript type narrowing, schema validation, test infrastructure, and source map alignment issues across route files and domain logic.

**Files changed:**

- `apps/user-service/src/routes/deviceRoutes.ts`
- `apps/user-service/src/routes/frontendRoutes.ts`
- `apps/user-service/src/routes/oauthConnectionRoutes.ts`
- `apps/user-service/src/routes/tokenRoutes.ts`
- `apps/user-service/src/domain/settings/formatLlmError.ts`
- `apps/user-service/src/infra/firestore/encryption.ts`

### v2.0.0 (2026-01-24)

### INT-199: Fixed Misleading API Key Error for 429 Rate Limit Responses

**Problem:** When LLM providers returned 429 (rate limit) errors, the generic error parser was incorrectly matching "api_key" patterns in the error message before checking for rate limit patterns. This led to misleading error messages like "The API key for this provider is invalid or expired" when the actual issue was a rate limit.

**Fix:** Reordered `parseGenericError()` to check rate limit patterns (429, rate_limit, quota exceeded, too many requests) BEFORE API key patterns. Error precedence is now:

1. Rate limit patterns -> "Rate limit exceeded. Please try again later."
2. API key patterns -> "The API key for this provider is invalid or expired"
3. Other patterns (timeout, network, connection)
4. Truncate long messages

**Files changed:**

- `apps/user-service/src/domain/settings/formatLlmError.ts`
- `apps/user-service/src/__tests__/domain/settings/formatLlmError.test.ts`

**Impact:** Users now see correct error messages when rate limited, avoiding confusion about key validity.

### INT-170: Improved Test Coverage

**Changes:** Added comprehensive test cases for `formatLlmError()` covering:

- All Anthropic error patterns (credit balance, rate limit, overloaded)
- All Gemini error patterns (API_KEY_INVALID, API_KEY_NOT_FOUND, PERMISSION_DENIED, RESOURCE_EXHAUSTED)
- OpenAI rate limit parsing with token counts
- Generic fallback patterns with correct precedence
- Edge cases (malformed JSON, empty messages, long messages)

**Test file:** `apps/user-service/src/__tests__/domain/settings/formatLlmError.test.ts`

---

## Resolved Issues

### 2026-02-16 to 2026-02-22

| Issue | Description                        | Resolution                                               |
| ----- | ---------------------------------- | -------------------------------------------------------- |
| -     | No distributed tracing or metrics  | Added Dash0 OTel via `infra-otel` preload module         |
| -     | No per-user default model setting  | Added `PATCH /users/:uid/settings` with model validation |
| -     | PM2 log output hard to read in dev | Improved dev-mode log formatting                         |

### 2026-02-08

| Issue   | Description                                         | Resolution                                                       |
| ------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| -       | Internal endpoints used ad-hoc response formats     | Migrated all to `reply.ok()` / `reply.fail()` response contract  |
| -       | Missing profile data from Auth0 namespaced claims   | Added namespace-aware JWT claims reading with bare fallback      |
| -       | Logger bypassed Sentry error tracking               | Migrated from `pino()` to `createAppLogger()`                    |
| INT-408 | Undeclared env vars used without REQUIRED_ENV entry | Added 3 missing env vars to REQUIRED_ENV                         |
| INT-427 | 100% coverage enforcement required v8 ignore annots | Added categorized v8 ignore annotations across route/domain code |

### v2.0.0 - 2026-01-24

| Issue   | Description                                       | Resolution                                  |
| ------- | ------------------------------------------------- | ------------------------------------------- |
| INT-199 | Rate limit errors shown as invalid key errors     | Reordered error pattern matching precedence |
| INT-170 | Missing test coverage for formatLlmError patterns | Added 35+ test cases, 100% branch coverage  |

---

## Related

- [Features](features.md) -- User-facing documentation
- [Technical](technical.md) -- Developer reference
- [Documentation Run Log](../../documentation-runs.md)
