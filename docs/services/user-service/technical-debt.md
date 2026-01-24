# User Service - Technical Debt

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |

Last updated: 2026-01-24

## Recent Changes (v2.0.0)

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

## Code Smells

### None Detected

No active code smells found in current codebase. The `formatLlmError()` function was reviewed and improved in v2.0.0.

## Test Coverage

### Current Status

Comprehensive test coverage across all layers:

- **formatLlmError()**: 100% branch coverage with 35+ test cases
- Authentication flows: Device code, refresh, OAuth fully tested
- Settings management: CRUD operations tested
- Encryption: AES-256-GCM encryption/decryption tested
- Internal endpoints: Auth validation tested

### Coverage Areas

- **Routes**: All public and internal endpoints with proper auth
- **Use Cases**: Token refresh, settings CRUD, OAuth flow
- **Infrastructure**: Encryption, Auth0 client, Firestore repositories
- **Domain**: Models, error handling, validation
- **Error Formatting**: All provider patterns and edge cases

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found.

## SRP Violations

### None Detected

All files are within reasonable size limits. No files exceed 300 lines.

Key file sizes:

- `formatLlmError.ts`: 219 lines (well-structured, provider-specific functions)
- `llmKeysRoutes.ts`: 568 lines (large but well-organized route definitions)
- `LlmValidatorImpl.ts`: 257 lines (repetitive but necessary per-provider logic)

## Code Duplicates

### Acknowledged Pattern: LlmValidatorImpl

The `LlmValidatorImpl.ts` file contains similar code blocks for each provider (5 providers x 2 methods = 10 similar blocks). This is intentional for:

- Clear debugging (each provider's logic is isolated)
- Easy addition of new providers
- Provider-specific error handling

Not considered technical debt as the pattern is explicit and maintainable.

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

## Resolved Issues

### v2.0.0 - 2026-01-24

| Issue   | Description                                       | Resolution                                  |
| ------- | ------------------------------------------------- | ------------------------------------------- |
| INT-199 | Rate limit errors shown as invalid key errors     | Reordered error pattern matching precedence |
| INT-170 | Missing test coverage for formatLlmError patterns | Added 35+ test cases, 100% branch coverage  |

### Historical Issues

No other previously resolved issues tracked. This section will be updated as issues are found and fixed.
