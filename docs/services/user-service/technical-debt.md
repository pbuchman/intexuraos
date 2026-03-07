# User Service - Technical Debt

**Last Updated:** 2026-03-07
**Analysis Run:** [2026-03-07 entry](../../documentation-runs.md)

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

1. **Microsoft OAuth** - For calendar/email integration with Outlook
2. **Notion OAuth** - For notes sync

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

### Transcription Expansion

1. **Additional providers** - Only Speechmatics is supported today; Whisper and other providers could be added
2. **Per-language preferences** - Allow users to select different providers for different languages

---

## SRP Violations

| File                          | Lines | Issue                                        | Suggestion                                  |
| ----------------------------- | ----- | -------------------------------------------- | ------------------------------------------- |
| `src/routes/llmKeysRoutes.ts` | 585   | Handles GET, PATCH, POST, DELETE in one file | Acceptable: routes are cohesive by resource |

The `llmKeysRoutes.ts` file is large but all routes are cohesive around the LLM keys resource. Splitting would scatter related logic across files without clear benefit.

---

## Code Duplicates

### Acknowledged Pattern: LlmValidatorImpl

The `LlmValidatorImpl.ts` (256 lines) contains similar code blocks for each provider (5 providers x 2 methods = 10 similar blocks). This is intentional for:

- Clear debugging (each provider's logic is isolated)
- Easy addition of new providers
- Provider-specific error handling

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
- **Settings management**: CRUD operations tested including transcription preferences
- **Encryption**: AES-256-GCM encryption/decryption tested
- **Internal endpoints**: Auth validation and all 6 endpoints tested
- **Default model**: Validation, provider key check, and cascade clearing tested
- **Google OAuth**: Full flow (initiate, callback, status, disconnect) tested
- **GitHub OAuth**: Full flow (initiate, callback, status, disconnect) tested

### Test Files

| Test File                               | Coverage Area                                 |
| --------------------------------------- | --------------------------------------------- |
| `configRoutes.test.ts`                  | Auth0 config endpoint                         |
| `deviceRoutes.test.ts`                  | Device code flow (start + poll)               |
| `tokenRoutes.test.ts`                   | Token refresh                                 |
| `firebaseRoutes.test.ts`                | Firebase token exchange                       |
| `frontendRoutes.test.ts`                | Login/logout/me endpoints                     |
| `oauthRoutes.test.ts`                   | OAuth2 token/authorize (ChatGPT Actions)      |
| `oauthConnectionRoutes.test.ts`         | Google OAuth connection management            |
| `gitHubOAuthConnectionRoutes.test.ts`   | GitHub OAuth connection management            |
| `settingsRoutes.test.ts`                | User settings + default model + transcription |
| `llmKeysRoutes.test.ts`                 | LLM key CRUD + test                           |
| `internalRoutes.test.ts`                | Service-to-service endpoints (6)              |
| `formatLlmError.test.ts`                | Provider error parsing                        |
| `encryption.test.ts`                    | AES-256-GCM encrypt/decrypt                   |
| `auth0Client.test.ts`                   | Auth0 SDK wrapper                             |
| `authTokenRepository.test.ts`           | Firestore token storage                       |
| `userSettingsRepository.test.ts`        | Firestore settings storage                    |
| `oauthConnectionRepository.test.ts`     | Firestore OAuth storage                       |
| `googleOAuthClient.test.ts`             | Google OAuth client                           |
| `gitHubOAuthClient.test.ts`             | GitHub OAuth client                           |
| `llmValidator.test.ts`                  | LLM key validation (5 providers)              |
| `maskApiKey.test.ts`                    | Key masking utility                           |

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

### Dash0 OpenTelemetry Integration (2026-02-16)

**Change:** Added `@intexuraos/infra-otel` dependency and preloaded it via `node --import ./dist/otel-register.js` in the Dockerfile. Exports traces, metrics, and structured logs to Dash0 via OTLP/HTTP. No-op when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is unset, so local and test environments are unaffected.

---

## Resolved Issues

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
| -       | No distributed tracing or metrics                   | Added Dash0 OTel via `infra-otel` preload module          |
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
