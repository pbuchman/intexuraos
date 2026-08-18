# User Service - Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** [2026-04-22 entry](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 1     | Low      |
| Code Duplicates     | 2     | Low      |
| Deprecations        | 0     | -        |
| **Total**           | **3** | Low      |

---

## Future Plans

### Additional OAuth Providers

Currently Google and GitHub OAuth are implemented. Planned additions:

1. **Microsoft OAuth** — For calendar/email integration with Outlook
2. **Notion OAuth** — For notes sync

### Enhanced API Key Features

1. **Usage analytics** — Track API call volume and costs per user per provider
2. **Key rotation** — Automatic key expiration warnings and renewal prompts
3. **Budget alerts** — Warn users when approaching provider spending limits
4. **Rate limiting** — Per-user or per-key request limits to prevent abuse

### Authentication Enhancements

1. **Multi-factor authentication** — Optional 2FA via Auth0
2. **Session management** — View and revoke active sessions
3. **Passwordless email magic links** — Alternative to device code flow

### Error Formatting Improvements

1. **OpenRouter-specific parsing** — Currently falls through to generic parser; could add OpenRouter-specific error patterns
2. **Perplexity-specific parsing** — Currently falls through to generic parser
3. **Structured error responses** — Include error codes alongside messages

### Transcription Expansion

1. **Additional providers** — Only Speechmatics is supported today; Whisper and other providers could be added
2. **Per-language preferences** — Allow users to select different providers for different languages

---

## SRP Violations

| File                          | Lines | Issue                                        | Suggestion                                  |
| ----------------------------- | ----- | -------------------------------------------- | ------------------------------------------- |
| `src/routes/llmKeysRoutes.ts` | 608   | Handles GET, PATCH, POST, DELETE in one file | Acceptable: routes are cohesive by resource |

The `llmKeysRoutes.ts` file is large but all routes are cohesive around the LLM keys resource. Splitting would scatter related logic across files without clear benefit.

---

## Code Duplicates

### Acknowledged Pattern: LlmValidatorImpl

`LlmValidatorImpl.ts` now validates only OpenRouter. Historical provider error parsing remains for readable legacy diagnostics, not active key configuration.

- Clear debugging (each provider's logic is isolated)
- Easy addition of new providers
- Provider-specific error handling

OpenRouter's `validateKey` method differs from the others (uses `/api/v1/key` instead of `generate()`), which justifies the per-provider approach.

Not considered actionable debt as the pattern is explicit and maintainable.

### Acknowledged Pattern: OAuth Use Case Pairs

The Google and GitHub OAuth use cases (`exchangeOAuthCode.ts` / `exchangeGitHubOAuthCode.ts`, `initiateOAuthFlow.ts` / `initiateGitHubOAuthFlow.ts`, `disconnectProvider.ts` / `disconnectGitHubProvider.ts`) share similar structure with provider-specific differences (e.g., GitHub stores username instead of email, GitHub tokens never expire). This duplication is intentional for:

- Provider-specific behavior (GitHub has no refresh tokens, uses far-future expiry)
- Independent evolution of each provider's flow
- Clear debugging isolation

Could potentially be abstracted into a base class if more providers are added.

---

## Test Coverage

### Current Status

Comprehensive test coverage across all layers with 100% branch coverage enforcement:

- **formatLlmError()**: 100% branch coverage with 35+ test cases
- **Authentication flows**: Device code, refresh, OAuth fully tested
- **Settings management**: CRUD operations tested including transcription, timezone, default model, and fallback model preferences
- **Encryption**: AES-256-GCM encryption/decryption tested
- **Internal endpoints**: Auth validation and all 6 endpoints tested
- **Default + fallback model**: Validation, provider key check, cascade clearing (both full and fallback-only) tested
- **Google OAuth**: Full flow (initiate, callback, status, disconnect) tested
- **GitHub OAuth**: Full flow (initiate, callback, status, disconnect) tested
- **OpenRouter**: Key validation and testing routes tested
- **Timezone**: Setting, validation, and internal endpoint return tested

### Test Files

| Test File                               | Coverage Area                                               |
| --------------------------------------- | ----------------------------------------------------------- |
| `configRoutes.test.ts`                  | Auth0 config endpoint                                       |
| `deviceRoutes.test.ts`                  | Device code flow (start + poll)                             |
| `tokenRoutes.test.ts`                   | Token refresh                                               |
| `firebaseRoutes.test.ts`                | Firebase token exchange                                     |
| `frontendRoutes.test.ts`                | Login/logout/me endpoints                                   |
| `oauthRoutes.test.ts`                   | OAuth2 token/authorize (ChatGPT Actions)                    |
| `oauthConnectionRoutes.test.ts`         | Google OAuth connection management                          |
| `gitHubOAuthConnectionRoutes.test.ts`   | GitHub OAuth connection management                          |
| `settingsRoutes.test.ts`                | User settings + default/fallback model + transcription + tz |
| `llmKeysRoutes.test.ts`                 | OpenRouter key CRUD, test, access source, legacy guards      |
| `internalRoutes.test.ts`                | Service-to-service endpoints (6)                            |
| `formatLlmError.test.ts`                | Provider error parsing                                      |
| `encryption.test.ts`                    | AES-256-GCM encrypt/decrypt                                 |
| `auth0Client.test.ts`                   | Auth0 SDK wrapper                                           |
| `authTokenRepository.test.ts`           | Firestore token storage                                     |
| `userSettingsRepository.test.ts`        | Firestore settings storage                                  |
| `oauthConnectionRepository.test.ts`     | Firestore OAuth storage                                     |
| `googleOAuthClient.test.ts`             | Google OAuth client                                         |
| `gitHubOAuthClient.test.ts`             | GitHub OAuth client                                         |
| `llmValidator.test.ts`                  | OpenRouter key validation                                   |
| `maskApiKey.test.ts`                    | Key masking utility                                         |

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

### v3.6.0 (2026-04-22)

**Change:** Added fallback model selection to LLM preferences (INT-1362, PRs #1793, #1789). Users can set an optional `fallbackModel` alongside the `defaultModel`. The platform automatically retries with the fallback when the primary model is unavailable. Validation ensures fallback differs from default, both are eligible models, and both have API keys configured. Cascade deletion clears the fallback independently if only the fallback provider's key is deleted.

**Change:** Centralized LLM pricing removal (INT-1387, PR #1831). Replaced the `app-settings-service` pricing dependency with `HttpInternalAuthUsageSink` that reports usage to `llm-usage-service`. The service no longer fails to start if pricing data is unavailable.

**Change:** Made `promptType` required in all `generate()` calls (INT-1392). LLM validation and testing now pass a semantic `promptType` for usage tracking.

**Change:** Model validation renamed from `isFastModel()` to `isDefaultEligibleModel()`, broadening the set of models eligible for default and fallback selection.

**Files changed:**
- `apps/user-service/src/domain/settings/models/UserSettings.ts` (fallbackModel field)
- `apps/user-service/src/routes/settingsRoutes.ts` (fallback validation + isDefaultEligibleModel)
- `apps/user-service/src/routes/llmKeysRoutes.ts` (fallbackModel in response + cascade clearing)
- `apps/user-service/src/routes/internalRoutes.ts` (fallbackModel in internal settings response)
- `apps/user-service/src/services.ts` (HttpInternalAuthUsageSink wiring, llm-pricing removal)
- `apps/user-service/src/infra/llm/LlmValidatorImpl.ts` (promptType in generate calls)
- `apps/user-service/src/infra/firestore/userSettingsRepository.ts` (fallback persistence + clearLlmPreferences)

---

### v3.5.0 (2026-04-07)

**Change:** Added OpenRouter as a fifth LLM provider (INT-1011, PRs #1443, #1461). OpenRouter key validation uses a lightweight `/api/v1/key` endpoint instead of a model call, making validation free of token cost. The `or:` prefix on OpenRouter model identifiers is stripped before API calls. All existing key management routes (GET/PATCH/DELETE/test) now support `openrouter` as a provider. Internal `/llm-keys` endpoint returns an additional `openrouter` field.

**Change:** Added timezone preference to user settings (INT-1126). New `PATCH /users/:uid/settings/timezone` endpoint validates IANA timezone strings via `Intl.supportedValuesOf('timeZone')`. Internal `GET /internal/users/:uid/settings` now returns `timezone` alongside existing preferences.

**Files changed:**
- `apps/user-service/src/infra/llm/LlmValidatorImpl.ts` (OpenRouter validation + testing)
- `apps/user-service/src/domain/settings/models/UserSettings.ts` (OpenRouter key + timezone field)
- `apps/user-service/src/routes/llmKeysRoutes.ts` (OpenRouter in key management routes)
- `apps/user-service/src/routes/internalRoutes.ts` (OpenRouter key + timezone in response)
- `apps/user-service/src/routes/settingsRoutes.ts` (timezone endpoint)
- `apps/user-service/src/services.ts` (OpenRouter pricing + validation wiring)
- `apps/user-service/src/infra/firestore/userSettingsRepository.ts` (OpenRouter + timezone persistence)

---

### v3.4.0 (2026-03-22)

**Change:** Removed unnecessary v8-ignore annotations and standardized the remaining ones across OAuth route files (INT-988, PR #1330). This was part of a monorepo-wide cleanup that affected user-service's `oauthConnectionRoutes.ts` and `gitHubOAuthConnectionRoutes.ts`. No functional changes.

---

### v3.3.0 Release (2026-03-15)

**Change:** Release v3.3.0. No functional changes to user-service code.

---

### INT-797: v8-ignore Replacement with Real Tests (2026-03-10)

**Change:** Replaced v8-ignore blocks in user-service route files with real test coverage. The `isTranscriptionProvider` branch that was previously protected by a schema enum is now covered via runtime type guard testing. Reduced v8-ignore annotation count in route files.

**Files changed:**
- `apps/user-service/src/__tests__/` (multiple route test files updated)
- `apps/user-service/src/routes/settingsRoutes.ts`

---

### GitHub OAuth Integration (2026-03-01)

**Change:** Added full GitHub OAuth support: initiate flow, exchange code for tokens, check connection status, disconnect, and revoke. GitHub-specific behavior: tokens never expire (far-future expiry `9999-12-31`), no refresh logic, stores GitHub username in the `email` field of OAuthConnection.

**New internal endpoints:**
- `GET /internal/users/:uid/oauth/github/token` - Returns stored GitHub access token for code-agent
- `GET /internal/users/by-github-username/:username` - Finds user by GitHub username (used for GitHub webhook routing)

**Files added:**
- `apps/user-service/src/routes/gitHubOAuthConnectionRoutes.ts`
- `apps/user-service/src/__tests__/gitHubOAuthConnectionRoutes.test.ts`
- `apps/user-service/src/domain/oauth/usecases/initiateGitHubOAuthFlow.ts`
- `apps/user-service/src/domain/oauth/usecases/exchangeGitHubOAuthCode.ts`
- `apps/user-service/src/domain/oauth/usecases/disconnectGitHubProvider.ts`
- `apps/user-service/src/domain/oauth/ports/GitHubOAuthClient.ts`
- `apps/user-service/src/infra/github/gitHubOAuthClient.ts`
- `apps/user-service/src/__tests__/infra/gitHubOAuthClient.test.ts`

### Transcription Preferences (2026-03-06)

**Change:** Added `PATCH /users/:uid/settings/transcription` endpoint for setting user transcription provider preference. Added `TranscriptionPreferences` to `UserSettings` model. Added `isTranscriptionProvider()` runtime type guard. Internal `GET /internal/users/:uid/settings` now returns `transcriptionPreferences` alongside `llmPreferences`.

**Files changed:**
- `apps/user-service/src/routes/settingsRoutes.ts`
- `apps/user-service/src/domain/settings/models/UserSettings.ts`
- `apps/user-service/src/routes/internalRoutes.ts`

### INT-571: Default Model API Key Validation (2026-02-22)

**Change:** `PATCH /users/:uid/settings` now validates that the user has an API key configured for the default model's provider before accepting the change. Deleting an LLM API key cascades to clear `defaultModel` if the current default belongs to the deleted provider.

**Files changed:**
- `apps/user-service/src/routes/settingsRoutes.ts`
- `apps/user-service/src/routes/llmKeysRoutes.ts`

### v3.1.0 (2026-02-22)

Release version bump only. No functional changes to user-service code.

### v3.0.0 (2026-02-19)

Release version bump only. No functional changes to user-service code.

## Resolved Issues

### 2026-04-22

| Issue    | Description                                             | Resolution                                                                      |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| INT-1387 | Service failed to start if pricing data was unavailable | Replaced app-settings-service pricing dependency with async usage sink          |
| -        | isFastModel() too restrictive for model eligibility     | Replaced with isDefaultEligibleModel() to broaden eligible default/fallback set |

### 2026-03-19

| Issue   | Description                                             | Resolution                                                             |
| ------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| INT-988 | Unnecessary v8-ignore annotations in OAuth route files  | Removed unnecessary annotations, standardized wording on remainder     |

### 2026-03-10 to 2026-03-15

| Issue   | Description                                                | Resolution                                                                   |
| ------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| INT-797 | v8-ignore blocks in route files lacked real test coverage  | Replaced v8-ignore annotations with real tests across user-service routes    |
| -       | isTranscriptionProvider branch uncoverable via schema enum | Removed schema enum constraint; branch now covered by runtime type guard     |

### 2026-03-01 to 2026-03-07

| Issue | Description                                   | Resolution                                                |
| ----- | --------------------------------------------- | --------------------------------------------------------- |
| -     | No GitHub OAuth integration                   | Added full GitHub OAuth with routes, use cases, and infra |
| -     | No transcription provider preferences         | Added transcription preference endpoint and model         |
| -     | GitHub OAuth previously listed as future plan | Implemented and shipped                                   |

### 2026-02-16 to 2026-02-22

| Issue   | Description                                         | Resolution                                                |
| ------- | --------------------------------------------------- | --------------------------------------------------------- |
| INT-571 | Default model accepted without checking API key     | Added provider key validation and cascade clearing        |
| -       | No per-user default model setting                   | Added `PATCH /users/:uid/settings` with model validation  |
| -       | PM2 log output hard to read in dev                  | Improved dev-mode log formatting                          |

### 2026-02-08

| Issue   | Description                                         | Resolution                                                       |
| ------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| -       | Internal endpoints used ad-hoc response formats     | Migrated all to `reply.ok()` / `reply.fail()` response contract  |
| -       | Missing profile data from Auth0 namespaced claims   | Added namespace-aware JWT claims reading with bare fallback      |
| -       | Logger bypassed Sentry error tracking               | Migrated from `pino()` to `createAppLogger()`                    |
| INT-408 | Undeclared env vars used without REQUIRED_ENV entry | Added 3 missing env vars to REQUIRED_ENV                         |
| INT-427 | 100% coverage enforcement required v8 ignore annots | Added categorized v8 ignore annotations across route/domain code |

### 2026-01-24

| Issue   | Description                                       | Resolution                                  |
| ------- | ------------------------------------------------- | ------------------------------------------- |
| INT-199 | Rate limit errors shown as invalid key errors     | Reordered error pattern matching precedence |
| INT-170 | Missing test coverage for formatLlmError patterns | Added 35+ test cases, 100% branch coverage  |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
